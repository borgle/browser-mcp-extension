/**
 * Chrome DevTools Protocol（chrome.debugger）封装。
 *
 * 使用场景：需要“真实浏览器输入”或网络层能力的工具（鼠标点击/滚动、输入序列回放、
 * 网络拦截、原生文件注入）都建立在 CDP 之上。
 *
 * 生命周期策略：
 *   - 首次使用时 attach（1.3），attach 前先 detach 一次，避免上次异常退出的残留会话；
 *   - attach 后做一次 Runtime.evaluate 探活，会话失效就重建；
 *   - 命令执行期间计数 in-flight，空闲 90 秒且没有命令在飞就自动 detach，
 *     这样不会长期占用调试器（Chrome 顶部会显示“正在调试此标签页”）。
 */

/** CDP 命令 / 探活超时 */
export class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/** 空闲多久自动 detach */
const IDLE_DETACH_MS = 90000;
/** sendCommand 的超时 */
const COMMAND_TIMEOUT_MS = 15000;
/** 会话探活超时 */
const PROBE_TIMEOUT_MS = 5000;

/** 已 attach 的标签页 */
const attachedTabs = new Set();
/** 每个标签页正在飞行的 CDP 命令数（>0 时不 detach） */
const inFlightCommands = new Map();
/** 每个标签页的空闲 detach 定时器 */
const idleTimers = new Map();

/** 给 Promise 加超时（不取消底层命令，只让调用方拿到 TimeoutError） */
export function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function clearInFlight(tabId) {
  inFlightCommands.delete(tabId);
}

function clearIdleTimer(tabId) {
  const timer = idleTimers.get(tabId);
  if (timer !== undefined) {
    clearTimeout(timer);
    idleTimers.delete(tabId);
  }
}

/** attach 调试器（已 attach 则直接返回；不做探活） */
export async function attachDebugger(tabId) {
  if (attachedTabs.has(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // 没有残留会话是正常情况
  }
  await chrome.debugger.attach({ tabId }, '1.3');
  attachedTabs.add(tabId);
}

/** 空闲后自动 detach；期间又有命令则顺延 */
function scheduleIdleDetach(tabId) {
  clearIdleTimer(tabId);
  idleTimers.set(
    tabId,
    setTimeout(() => {
      idleTimers.delete(tabId);
      if (hasInFlightCommands(tabId)) scheduleIdleDetach(tabId);
      else void detachDebugger(tabId);
    }, IDLE_DETACH_MS),
  );
}

function hasInFlightCommands(tabId) {
  return (inFlightCommands.get(tabId) ?? 0) > 0;
}

function incrementInFlight(tabId) {
  inFlightCommands.set(tabId, (inFlightCommands.get(tabId) ?? 0) + 1);
}

function decrementInFlight(tabId) {
  const remaining = (inFlightCommands.get(tabId) ?? 0) - 1;
  if (remaining > 0) inFlightCommands.set(tabId, remaining);
  else inFlightCommands.delete(tabId);
}

/** 主动 detach（工具结束时也可调用） */
export async function detachDebugger(tabId) {
  clearIdleTimer(tabId);
  clearInFlight(tabId);
  if (attachedTabs.has(tabId)) {
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
      // 已经断开
    }
    attachedTabs.delete(tabId);
  }
}

/** 确保调试器可用：attach → 探活 → 失败则重建 → 安排空闲 detach */
export async function ensureDebugger(tabId) {
  await attachDebugger(tabId);
  try {
    await withTimeout(
      chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression: '1' }),
      PROBE_TIMEOUT_MS,
      '会话探测未回应',
    );
  } catch {
    // 会话已失效（例如页面崩溃/重启）：重建
    attachedTabs.delete(tabId);
    await chrome.debugger.detach({ tabId }).catch(() => {});
    await chrome.debugger.attach({ tabId }, '1.3');
    attachedTabs.add(tabId);
  }
  scheduleIdleDetach(tabId);
}

/** 是否已 attach */
export function isDebuggerAttached(tabId) {
  return attachedTabs.has(tabId);
}

/**
 * 发送 CDP 命令（要求已 attach）。
 * @param {number} tabId
 * @param {string} method 如 `Input.dispatchMouseEvent`
 * @param {object} [params]
 */
export async function sendCommand(tabId, method, params) {
  if (!attachedTabs.has(tabId)) throw new Error(`Tab ${tabId} 未附加调试器，请先调用 start`);
  incrementInFlight(tabId);
  try {
    return await withTimeout(
      chrome.debugger.sendCommand({ tabId }, method, params),
      COMMAND_TIMEOUT_MS,
      `CDP 命令 ${method} 超过 ${COMMAND_TIMEOUT_MS}ms 未回应`,
    );
  } finally {
    decrementInFlight(tabId);
    if (attachedTabs.has(tabId)) scheduleIdleDetach(tabId);
  }
}

/** 页面关闭 / 调试器被外部断开时清理状态 */
export function trackDebuggerLifecycle() {
  chrome.tabs.onRemoved.addListener((tabId) => {
    attachedTabs.delete(tabId);
    clearIdleTimer(tabId);
    clearInFlight(tabId);
    onTabGone?.(tabId);
  });
  chrome.debugger.onDetach.addListener((source) => {
    if (!source.tabId) return;
    attachedTabs.delete(source.tabId);
    clearIdleTimer(source.tabId);
    clearInFlight(source.tabId);
    onTabGone?.(source.tabId);
  });
}

/** 由上层（network-intercept / input-sequence）注册的清理钩子 */
let onTabGone = null;
export function setTabCleanupHook(hook) {
  onTabGone = hook;
}

/**
 * 输入事件“没得到浏览器回应”的冷却表：
 * 某些页面在特定时刻会吞掉 CDP 输入事件，触发后 60 秒内不再向该标签页发输入，
 * 避免工具一直卡在同一个坑里。
 */
const inputStallAt = new Map();
const INPUT_STALL_COOLDOWN_MS = 60000;

export function markInputStall(tabId, at = Date.now()) {
  inputStallAt.set(tabId, at);
}

export function clearInputStall(tabId) {
  inputStallAt.delete(tabId);
}

/** 剩余冷却时间（ms），0 表示可以正常发送输入 */
export function inputStallRemainingMs(tabId, now = Date.now()) {
  const at = inputStallAt.get(tabId);
  if (at === undefined) return 0;
  const remaining = at + INPUT_STALL_COOLDOWN_MS - now;
  if (remaining <= 0) {
    inputStallAt.delete(tabId);
    return 0;
  }
  return remaining;
}

/** 先确保调试器可用，再执行需要 CDP 的操作 */
export async function withDebugger(tabId, task) {
  await ensureDebugger(tabId);
  return task();
}

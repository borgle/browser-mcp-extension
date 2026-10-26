/**
 * browser_input_sequence：按时间表回放一串 CDP 输入事件（鼠标 + 键盘 + 文本）。
 *
 * 参数：events 必填，非空数组（≤4000），每项：
 *   { type, after?, x?, y?, button?, clickCount?, modifiers?, deltaX?, deltaY?,
 *     key?, code?, text?, windowsVirtualKeyCode? }
 *   type: mouseMoved | mousePressed | mouseReleased | mouseWheel | keyDown | keyUp |
 *         rawKeyDown | char | insertText
 *   after: 距上一个事件的等待毫秒（累计不得超过 180000ms）
 *
 * 为什么需要它：一次性下发完整轨迹，比“逐个工具调用”更接近真人操作，
 * 也避免每次调用之间被 MCP/网络抖动拉开时间间隔。
 *
 * 失败保护：
 *   - 若某个事件以超时结束，会记 60 秒冷却（同标签页不再下发输入）；
 *   - 中途失败时补发 mouseReleased，避免页面停在“按住不放”的状态。
 */
import { BaseTool } from './base.js';
import {
  TimeoutError,
  clearInputStall,
  ensureDebugger,
  inputStallRemainingMs,
  markInputStall,
  sendCommand,
} from '../cdp.js';
import { sleep } from '../utils.js';

/** CDP 鼠标事件类型 */
const MOUSE_EVENT_TYPES = new Set(['mouseMoved', 'mousePressed', 'mouseReleased', 'mouseWheel']);
/** CDP 键盘事件类型 */
const KEY_EVENT_TYPES = new Set(['keyDown', 'keyUp', 'rawKeyDown', 'char']);
/** 事件条数 / 累计等待上限 */
const MAX_EVENTS = 4000;
const MAX_TOTAL_DELAY_MS = 180000;

/** CDP 的 buttons 位掩码 */
function buttonsMask(button) {
  switch (button) {
    case 'left':
      return 1;
    case 'right':
      return 2;
    case 'middle':
      return 4;
    default:
      return 0;
  }
}

/** 工具入参 → CDP {method, params} */
function toCdpCommand(event) {
  if (MOUSE_EVENT_TYPES.has(event.type)) {
    const params = { type: event.type, x: event.x ?? 0, y: event.y ?? 0 };
    if (event.type === 'mouseWheel') {
      params.deltaX = event.deltaX ?? 0;
      params.deltaY = event.deltaY ?? 0;
    } else {
      params.button = event.button ?? 'none';
      params.buttons = event.type === 'mousePressed' ? buttonsMask(event.button) : 0;
      if (event.clickCount !== undefined) params.clickCount = event.clickCount;
    }
    if (event.modifiers !== undefined) params.modifiers = event.modifiers;
    return { method: 'Input.dispatchMouseEvent', params };
  }

  if (event.type === 'insertText') {
    return { method: 'Input.insertText', params: { text: event.text ?? '' } };
  }

  if (KEY_EVENT_TYPES.has(event.type)) {
    const params = { type: event.type };
    if (event.text !== undefined) params.text = event.text;
    if (event.key !== undefined) params.key = event.key;
    if (event.code !== undefined) params.code = event.code;
    if (event.windowsVirtualKeyCode !== undefined) {
      params.windowsVirtualKeyCode = event.windowsVirtualKeyCode;
      params.nativeVirtualKeyCode = event.windowsVirtualKeyCode;
    }
    if (event.modifiers !== undefined) params.modifiers = event.modifiers;
    return { method: 'Input.dispatchKeyEvent', params };
  }

  throw new Error(`Unsupported input event type: ${event.type}`);
}

/** 入参校验（提前失败，别中途炸） */
function validateEvents(events) {
  if (!Array.isArray(events) || events.length === 0) throw new Error('events must be a non-empty array');
  if (events.length > MAX_EVENTS) throw new Error(`Event count ${events.length} exceeds the limit of ${MAX_EVENTS}`);

  let totalDelay = 0;
  events.forEach((event, index) => {
    if (!event || typeof event.type !== 'string') throw new Error(`Event ${index} is missing type`);
    if (!MOUSE_EVENT_TYPES.has(event.type) && !KEY_EVENT_TYPES.has(event.type) && event.type !== 'insertText') {
      throw new Error(`Unsupported event type at index ${index}: ${event.type}`);
    }
    if (event.after !== undefined) {
      if (!Number.isFinite(event.after) || event.after < 0) {
        throw new Error(`Invalid after value at event ${index}: ${event.after}`);
      }
      totalDelay += event.after;
    }
    if (MOUSE_EVENT_TYPES.has(event.type) && (!Number.isFinite(event.x) || !Number.isFinite(event.y))) {
      throw new Error(`Mouse event ${index} is missing valid x/y`);
    }
  });
  if (totalDelay > MAX_TOTAL_DELAY_MS) {
    throw new Error(`Cumulative wait ${totalDelay}ms exceeds the limit of ${MAX_TOTAL_DELAY_MS}ms`);
  }
}

export class InputSequenceTool extends BaseTool {
  name = 'browser_input_sequence';

  async execute(args) {
    try {
      validateEvents(args?.events);
    } catch (err) {
      return this.createErrorResult(err instanceof Error ? err.message : 'Invalid event timeline');
    }

    try {
      const tab = await this.getTargetTab(args.tabId);
      if (!tab?.id) return this.createErrorResult('Could not find the target tab');
      const tabId = tab.id;

      const cooldownMs = inputStallRemainingMs(tabId);
      if (cooldownMs > 0) {
        return this.createErrorResult(
          `The browser did not acknowledge recent input events on tab ${tabId}. Wait ${Math.ceil(cooldownMs / 1000)} seconds before sending more.`,
        );
      }

      await ensureDebugger(tabId);

      let dispatched = 0;
      let pendingRelease = null;
      try {
        for (const [index, event] of args.events.entries()) {
          if (event.after) await sleep(event.after);
          const { method, params } = toCdpCommand(event);
          try {
            await sendCommand(tabId, method, params);
          } catch (err) {
            // CDP 命令超时说明会话可能已经麻了：记冷却，别继续砸输入
            if (err instanceof TimeoutError) markInputStall(tabId);
            const reason = err instanceof Error ? err.message : String(err);
            throw new Error(`Event ${index + 1}/${args.events.length} (${event.type}) failed: ${reason}`);
          }
          dispatched += 1;
          if (event.type === 'mousePressed') {
            pendingRelease = { ...params, type: 'mouseReleased', buttons: 0 };
          } else if (event.type === 'mouseReleased') {
            pendingRelease = null;
          }
        }
      } catch (err) {
        // 中途失败先把鼠标松开，避免页面卡在按下状态
        if (pendingRelease) await sendCommand(tabId, 'Input.dispatchMouseEvent', pendingRelease).catch(() => {});
        throw err;
      }

      clearInputStall(tabId);
      return this.createTextResult(JSON.stringify({ success: true, tabId, dispatched }));
    } catch (err) {
      return this.createErrorResult(err instanceof Error ? err.message : 'Input event replay failed');
    }
  }
}

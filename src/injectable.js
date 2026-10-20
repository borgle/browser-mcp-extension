/**
 * 页面注入的公共部分：
 * - 记录每个标签页注入过的世界（MAIN / ISOLATED），换脚本前先清理旧注入；
 * - 把“函数体”包装成可在页面里 `new Function` 执行的源码串。
 *
 * 为什么要清理：inject-bridge.js 会在 ISOLATED world 上装一个 window 事件桥，
 * 重复注入会叠加监听器；background 每次注入前先发 cleanup 让上一次的桥卸载。
 */
import { INJECT_ACTION, INJECT_MSG } from './constants.js';

/** tabId -> { tabId, world, injectedAt } */
const injectedTabs = new Map();

/** 记录某标签页当前注入的世界 */
export function rememberInjection(tabId, world) {
  injectedTabs.set(tabId, { tabId, world, injectedAt: Date.now() });
}

/** 该标签页是否注入过 */
export function hasInjection(tabId) {
  return injectedTabs.has(tabId);
}

/** 让页面里的注入桥自行卸载（失败无所谓，注入脚本可能已经不在了） */
export async function cleanupInjection(tabId) {
  if (!injectedTabs.has(tabId)) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: INJECT_MSG.CLEANUP });
  } catch {
    // 页面已导航 / 没有监听器：忽略
  } finally {
    injectedTabs.delete(tabId);
  }
}

/** 标签关闭时顺手清掉记录，避免 Map 泄漏 */
export function trackInjectedTabRemoval() {
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (injectedTabs.has(tabId)) injectedTabs.delete(tabId);
  });
}

/**
 * 生成在页面里执行的源码。
 *
 * 页面环境没有打包器的 async/await → generator 转换，所以这里把 `__async`
 * 辅助函数一起塞进源码串里；调用方在页面侧用 `new Function('args', src)(args)` 执行。
 * 传入非函数时原样返回（调用方可能已经给的是源码字符串）。
 */
export function toInjectableSource(input) {
  if (typeof input !== 'function') return input;
  return `
      // Helper function for async/await transformation
      const __async = (__this, __arguments, generator) => {
        return new Promise((resolve, reject) => {
          var fulfilled = (value) => {
            try {
              step(generator.next(value));
            } catch (e) {
              reject(e);
            }
          };
          var rejected = (value) => {
            try {
              step(generator.throw(value));
            } catch (e) {
              reject(e);
            }
          };
          var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
          step((generator = generator.apply(__this, __arguments)).next());
        });
      };

      // Execute the function
      const __fn = ${input.toString()};
      return __fn(args);
    `;
}

/**
 * 在 MAIN world 执行代码：把源码交给 inject-bridge（ISOLATED）→ main-world-executor（MAIN），
 * 结果与错误通过回执带回来。
 *
 * 回执约定：
 *   - chrome.runtime.lastError → 抛错（页面没监听器 / 框架被销毁）
 *   - 无回执 → 视为 undefined
 *   - response.error → 抛错（桥自身的错误）
 *   - data.success === false → 抛错，并尽量保留页面错误的 name/stack
 *   - 其余 → 返回 data.result
 */
export function runCodeInMainWorld(tabId, source, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Script execution timeout')), timeoutMs);
    chrome.tabs.sendMessage(
      tabId,
      {
        type: INJECT_MSG.EXECUTE_SCRIPT,
        targetWorld: 'MAIN',
        action: INJECT_ACTION.EXECUTE_CODE,
        code: source,
        args,
      },
      (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response) {
          resolve(undefined);
          return;
        }
        if (response.error) {
          reject(new Error(response.error.message || 'Execution failed'));
          return;
        }
        const data = response.data;
        if (!data) {
          resolve(undefined);
          return;
        }
        if (data.success === false) {
          const pageError = data.error || {};
          const error = new Error(pageError.message || 'Execution failed');
          if (pageError.name) error.name = pageError.name;
          if (pageError.stack) error.stack = pageError.stack;
          reject(error);
          return;
        }
        resolve(data.result);
      },
    );
  });
}

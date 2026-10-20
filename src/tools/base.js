/**
 * 所有浏览器工具的基类。
 *
 * 统一约定：
 * - 子类实现 `name`（暴露给 MCP 的工具名）与 `async execute(args)`；
 * - 返回值形如 `{ content: [{ type: 'text'|'error', text }], isError }`，
 *   后端会把它原样包进 MCP `tools/call` 的结果里；
 * - 出错一律走 `createErrorResult()`，不要 throw（execute 抛错会被注册表兜住，
 *   但那样拿不到具体工具上下文）。
 */
import { ERR } from '../constants.js';
import { getTabWithGrace } from '../tabs.js';

export class BaseTool {
  /** @type {string} */
  name = 'unnamed';

  /**
   * 在指定标签页里执行一段函数（默认 ISOLATED world，即扩展的隔离环境）。
   * @param {number} tabId
   * @param {Function} func 会被序列化后注入执行，参数由 args 传入
   * @param {unknown[]} [args]
   * @param {'ISOLATED'|'MAIN'} [world] 需要读页面自己的 JS 全局时用 MAIN
   */
  async executeInTab(tabId, func, args, world) {
    const results = await chrome.scripting
      .executeScript({ target: { tabId }, func, args: args || [], ...(world ? { world } : {}) })
      .catch((err) => {
        throw new Error(err && err.message ? err.message : 'Script execution failed');
      });
    if (!results || results.length === 0) throw new Error('Script execution failed');
    const injection = results[0];
    // 注入的函数抛错时，Chrome 会把错误放在 error 里而不是 reject；1.7.3 直接读 result，
    // 于是失败被静默成 undefined（实测：ISOLATED 世界 new Function 被 MV3 CSP 拦掉时就是这样）。
    if (injection?.error) throw new Error(describeInjectionError(injection.error));
    return injection.result;
  }

  /** 当前窗口的活动标签 */
  async getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab;
  }

  /**
   * 定位工具要操作的标签页：传了 tabId 就用它，否则用活动标签。
   * 标签不存在时返回 undefined（调用方转成错误结果）。
   */
  async getTargetTab(tabId) {
    // 传了 tabId 就等一小会儿（新建标签可能还没出现在 tabs.get 里），查不到返回 undefined
    if (tabId !== undefined) return (await getTabWithGrace(tabId)) ?? undefined;
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab;
  }

  /** 统一的失败结果 */
  createErrorResult(message) {
    return { content: [{ type: 'error', text: message }], isError: true };
  }

  /** 统一的成功结果（text 通常是 JSON 字符串） */
  createTextResult(text) {
    return { content: [{ type: 'text', text }], isError: false };
  }

  /**
   * 轮询等待选择器命中（100ms 一次）。
   * 页面正在导航时 executeScript 会报错，这里吞掉继续轮询——多数工具都这么用；
   * 需要“执行出错即失败”的工具（如 browser_extract_data）请自行实现严格版本。
   */
  async waitForSelector(tabId, selector, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      try {
        if (await this.executeInTab(tabId, (sel) => document.querySelector(sel) !== null, [selector])) {
          return true;
        }
      } catch {
        // 忽略，等下一次轮询
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }
}

/** `Invalid arguments provided` 前缀 + 具体字段。 */
export function invalidArgs(message) {
  return { content: [{ type: 'error', text: `${ERR.invalidArgs}: ${message}` }], isError: true };
}

/** 把 chrome.scripting 注入结果里的 error 字段整理成可读文案 */
export function describeInjectionError(error) {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    if (typeof error.message === 'string' && error.message) return error.message;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return 'Script execution failed';
}

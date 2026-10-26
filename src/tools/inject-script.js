/**
 * browser_inject_script：在页面主环境（MAIN world）执行任意 JavaScript。
 * 工具名与服务端 abm_server/mcp_tools.py 的注册必须保持同步。
 *
 * 参数：
 *   code     必填，函数体源码；可在里面用 `args` 访问传入的参数
 *   args     传给代码的参数对象
 *   tabId    目标标签页；缺省用当前活动标签
 *
 * 执行方式：
 *   优先注入 inject-bridge.js(ISOLATED) + main-world-executor.js(MAIN)，
 *   再由 ISOLATED 通过 CustomEvent 把源码交给 MAIN 执行（页面里的函数/变量才可见）。
 *
 * 页面 CSP 兜底：
 *   MAIN world 的 `new Function` 受页面 CSP 约束；`script-src` 不含 'unsafe-eval'
 *   时会抛 EvalError（实测：New Function 被 CSP 拒绝）。这时改用扩展已有的
 *   chrome.debugger → Runtime.evaluate 在同一个 MAIN world 执行，执行完立即 detach。
 *   只有 CSP 错误才走兜底，正常页面不会附加调试器。
 *
 * 为什么不再支持 ISOLATED：
 *   MV3 的隔离世界 CSP 禁止 eval / new Function，agent 传来的源码串无法在 ISOLATED
 *   里执行。ISOLATED 只保留给扩展内部的桥文件注入，不执行任意源码。
 *
 * 返回值统一为 JSON 字符串（结果不可序列化时退化为 String，最差返回 "null"）。
 */
import { BaseTool, invalidArgs } from './base.js';
import { ERR, EXECUTION_WORLD } from '../constants.js';
import {
  cleanupInjection,
  rememberInjection,
  toInjectableSource,
  runCodeInMainWorld,
} from '../injectable.js';
import {
  detachDebugger,
  ensureDebugger,
  isDebuggerAttached,
  sendCommand,
} from '../cdp.js';

/** MAIN world 执行等待上限 */
const EXECUTE_TIMEOUT_MS = 30000;

/** MAIN 里的 new Function 被页面 CSP 拒绝时，错误名是 EvalError，消息含 CSP/unsafe-eval */
export function isCspEvalError(error) {
  if (!error) return false;
  const message = String(error.message ?? '');
  if (error.name === 'EvalError' && /content security policy|unsafe-eval/i.test(message)) {
    return true;
  }
  return /content security policy/i.test(message) && /unsafe-eval/i.test(message);
}

/** 把函数体源码包成 CDP 可直接求值的表达式；args 作为形参传入。 */
export function buildCdpExpression(code, args) {
  return `(async function(args) {\n'use strict';\n${code}\n})(${JSON.stringify(args ?? {})})`;
}

/** CDP 的 exceptionDetails → Error，尽量保留页面错误的 name/message/stack。 */
export function cdpErrorFromException(exceptionDetails) {
  const exception = exceptionDetails?.exception ?? {};
  const description = exception.description || exceptionDetails?.text || 'Execution failed';
  const firstLine = String(description).split('\n')[0];
  const separator = firstLine.indexOf(': ');
  const name = exception.className || (separator > 0 ? firstLine.slice(0, separator) : 'Error');
  const message = separator > 0 ? firstLine.slice(separator + 2) : firstLine;
  const error = new Error(message);
  error.name = name;
  error.stack = String(description);
  return error;
}

export class InjectScriptTool extends BaseTool {
  name = 'browser_inject_script';

  async execute(args) {
    try {
      const { code, world, args: codeArgs, tabId } = args;
      if (!code) return invalidArgs('Code is required');
      if (world && world !== EXECUTION_WORLD.MAIN) {
        return invalidArgs(
          'browser_inject_script only supports the MAIN world; MV3 isolated worlds cannot execute arbitrary source strings',
        );
      }

      // tabId 必须是数字；否则退回活动标签
      let targetTabId = tabId;
      if (typeof targetTabId !== 'number') {
        const activeTab = await this.getActiveTab();
        if (!activeTab || !activeTab.id) return this.createErrorResult(ERR.pageLoadTimeout);
        targetTabId = activeTab.id;
      }
      if (typeof targetTabId !== 'number') return this.createErrorResult(ERR.pageLoadTimeout);

      const result = await this.executeInMainWorld(targetTabId, code, codeArgs);
      return this.createTextResult(this.serializeResult(result));
    } catch (err) {
      return this.createErrorResult(`${ERR.toolFailed}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** MAIN world：先清掉上一次注入的桥，再注入桥 + 执行器，最后把源码交给 MAIN */
  async executeInMainWorld(tabId, code, codeArgs) {
    await cleanupInjection(tabId);
    const source = toInjectableSource(code);

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['inject-scripts/inject-bridge.js'],
      world: EXECUTION_WORLD.ISOLATED,
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['inject-scripts/main-world-executor.js'],
      world: EXECUTION_WORLD.MAIN,
    });

    let result;
    try {
      result = await runCodeInMainWorld(tabId, source, codeArgs, EXECUTE_TIMEOUT_MS);
    } catch (error) {
      if (!isCspEvalError(error)) throw error;
      result = await this.executeInMainWorldViaCdp(tabId, code, codeArgs);
    }
    rememberInjection(tabId, EXECUTION_WORLD.MAIN);
    return result;
  }

  /**
   * MAIN world 的 CSP 兜底：通过 CDP 在当前页面上下文求值。
   * 只在本工具自己附加调试器时 detach，避免打断 network-intercept 等已有会话。
   */
  async executeInMainWorldViaCdp(tabId, code, codeArgs) {
    const wasAttached = isDebuggerAttached(tabId);
    try {
      await ensureDebugger(tabId);
      const response = await sendCommand(tabId, 'Runtime.evaluate', {
        expression: buildCdpExpression(code, codeArgs),
        awaitPromise: true,
        returnByValue: true,
        allowUnsafeEvalBlockedByCSP: true,
      });
      if (response?.exceptionDetails) {
        throw cdpErrorFromException(response.exceptionDetails);
      }
      return response?.result?.value;
    } finally {
      if (!wasAttached) await detachDebugger(tabId).catch(() => {});
    }
  }

  /** 结果 → JSON 字符串；循环引用等序列化失败时退回字符串形式 */
  serializeResult(value) {
    try {
      return JSON.stringify(value ?? null);
    } catch {
      try {
        return JSON.stringify(String(value));
      } catch {
        return 'null';
      }
    }
  }
}

/**
 * browser_read_page_data：读取 window 上某个点分路径的值。
 *
 * 参数：path 必填，如 `__INITIAL_STATE__.note.noteId`；tabId 可选
 * 实现：复用 browser_inject_script 在 MAIN world 里取值，因此能读到页面自己的变量；
 *       结果会做一次 JSON 往返，循环引用会被降级成字符串。
 *
 * 返回 `{ path, value, type }`（缩进 2 的 JSON 字符串）。
 */
import { BaseTool, invalidArgs } from './base.js';
import { ERR, EXECUTION_WORLD } from '../constants.js';
import { InjectScriptTool } from './inject-script.js';

/** 在页面 MAIN world 里按点分路径取值的源码 */
const READ_PATH_SOURCE = `
          let value = window;
          const keys = args.path.split('.');

          for (const key of keys) {
            if (key && value != null) {
              value = value[key];
            } else {
              return undefined;
            }
          }

          // Handle circular references and functions
          try {
            return JSON.parse(JSON.stringify(value));
          } catch (e) {
            return String(value);
          }
        `;

export class ReadPageDataTool extends BaseTool {
  name = 'browser_read_page_data';

  constructor() {
    super();
    // 复用注入工具的 MAIN world 执行能力
    this.injectTool = new InjectScriptTool();
  }

  async execute(args) {
    try {
      const { path, tabId } = args;
      if (!path) return invalidArgs('Path is required');

      const targetTab =
        tabId === undefined ? await this.getActiveTab() : await this.getTargetTab(tabId);
      const injected = await this.injectTool.execute({
        code: READ_PATH_SOURCE,
        world: EXECUTION_WORLD.MAIN,
        args: { path },
        tabId: targetTab?.id,
      });

      if (injected.isError) {
        const errorText = injected.content.find((item) => item.type === 'error')?.text;
        return this.createErrorResult(`${ERR.toolFailed}: ${errorText || 'Failed to read page data'}`);
      }

      const first = injected.content[0];
      if (!first || first.type !== 'text') return this.createErrorResult('Invalid response from page script');

      let value;
      try {
        value = JSON.parse(first.text ?? 'null');
      } catch (err) {
        return this.createErrorResult(`${ERR.toolFailed}: ${err.message || 'Unable to parse result'}`);
      }

      return this.createTextResult(JSON.stringify({ path, value, type: typeof value }, null, 2));
    } catch (err) {
      return this.createErrorResult(`${ERR.toolFailed}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

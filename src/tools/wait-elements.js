/**
 * browser_wait_elements：等待页面出现至少 count 个匹配元素。
 *
 * 参数：selector(必填) / count(必填，非负数) / timeout(默认 60s) / checkInterval(默认 500ms) / tabId
 * 超时返回错误，成功返回实际数量与耗时，方便判断渲染进度。
 */
import { BaseTool } from './base.js';

export class WaitElementsTool extends BaseTool {
  name = 'browser_wait_elements';

  async execute(args) {
    const { selector, count, timeout = 60000, checkInterval = 500 } = args;
    if (!selector) return this.createErrorResult('selector 参数必填');
    if (count === undefined || count < 0) return this.createErrorResult('count 参数必填且必须为非负数');

    try {
      const tab = await this.getTargetTab(args.tabId);
      if (!tab?.id) return this.createErrorResult('无法找到目标标签页');
      const tabId = tab.id;
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeout) {
        try {
          const actual = await this.executeInTab(
            tabId,
            (sel) => document.querySelectorAll(sel).length,
            [selector],
          );
          if (actual >= count) {
            return this.createTextResult(
              JSON.stringify({
                success: true,
                selector,
                expectedCount: count,
                actualCount: actual,
                elapsed: Date.now() - startedAt,
              }),
            );
          }
        } catch {
          // 页面正在导航：忽略本次，继续轮询
        }
        await new Promise((resolve) => setTimeout(resolve, checkInterval));
      }

      return this.createErrorResult(`等待元素超时: 期望 ${count} 个 "${selector}"，超时时间 ${timeout}ms`);
    } catch (err) {
      return this.createErrorResult(err instanceof Error ? err.message : '等待元素失败');
    }
  }
}

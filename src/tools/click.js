/**
 * browser_click：点击页面元素。
 *
 * 参数：
 *   selector       必填
 *   text           按可见文本筛选（取第一个文本完全相等或包含的元素）
 *   waitClickable  是否校验可见性（display/visibility），默认 true
 *   timeout        等待元素出现的超时，默认 30s
 *   tabId          目标标签页，缺省用活动标签
 * 返回 { success, selector, text }。
 */
import { BaseTool } from './base.js';

export class ClickTool extends BaseTool {
  name = 'browser_click';

  async execute(args) {
    const { selector, text, timeout = 30000, waitClickable = true } = args;
    if (!selector) return this.createErrorResult('selector is required');
    try {
      const tab = await this.getTargetTab(args.tabId);
      if (!tab?.id) return this.createErrorResult('Could not find the target tab');
      const tabId = tab.id;

      if (!(await this.waitForSelector(tabId, selector, timeout))) {
        return this.createErrorResult(`Element not found: ${selector}`);
      }

      await this.executeInTab(
        tabId,
        (sel, matchText, checkVisible) => {
          const nodes = Array.from(document.querySelectorAll(sel));
          if (nodes.length === 0) throw new Error(`Element not found: ${sel}`);

          let target = null;
          if (matchText) {
            target =
              nodes.find((node) => {
                const content = node.textContent?.trim() || '';
                return content === matchText || content.includes(matchText);
              }) || null;
            if (!target) throw new Error(`No element found containing text "${matchText}"`);
          } else {
            target = nodes[0];
          }

          if (checkVisible) {
            const style = window.getComputedStyle(target);
            if (style.display === 'none' || style.visibility === 'hidden') {
              throw new Error('Element is not visible');
            }
          }

          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          if (target instanceof HTMLElement) {
            target.click();
          } else {
            target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          }
          return { success: true };
        },
        // 注意：text 缺省时要传 null 而不是 undefined —— chrome.scripting 的 args
        // 不接受不可序列化的值（1.7.3 传 undefined，实测在 Chrome 上直接报
        // "Value is unserializable"，等于不传 text 就没法点击）。
        [selector, text ?? null, waitClickable],
      );

      return this.createTextResult(
        JSON.stringify({ success: true, selector, text: text || undefined }),
      );
    } catch (err) {
      return this.createErrorResult(err instanceof Error ? err.message : 'Click failed');
    }
  }

}

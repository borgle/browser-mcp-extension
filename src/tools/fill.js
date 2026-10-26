/**
 * browser_fill：填充输入框 / 文本域 / contenteditable。
 *
 * 参数：
 *   selector     必填
 *   value        必填
 *   method       set(默认，直接赋值并派发 input/change) | type(逐字符模拟按键) |
 *                execCommand(仅 contenteditable，等价于用户键入)
 *   clearBefore  填充前清空，默认 false
 *   timeout      等待元素出现的超时，默认 30s
 *   tabId        目标标签页，缺省用活动标签
 * 返回 { success, selector, method, valueLength }。
 */
import { BaseTool } from './base.js';

export class FillTool extends BaseTool {
  name = 'browser_fill';

  async execute(args) {
    const { selector, value, method = 'set', clearBefore = false, timeout = 30000, tabId } = args;
    if (!selector) return this.createErrorResult('selector is required');
    if (value == null) return this.createErrorResult('value is required');

    try {
      let targetTabId;
      if (tabId !== undefined) {
        targetTabId = tabId;
      } else {
        const activeTab = await this.getTargetTab();
        if (!activeTab?.id) return this.createErrorResult('Could not find the target tab');
        targetTabId = activeTab.id;
      }

      if (!(await this.waitForSelector(targetTabId, selector, timeout))) {
        return this.createErrorResult(`Element not found: ${selector}`);
      }

      await this.executeInTab(
        targetTabId,
        (sel, text, fillMethod, shouldClear) => {
          const element = document.querySelector(sel);
          if (!element) throw new Error(`Element not found: ${sel}`);
          if (element instanceof HTMLElement) element.focus();

          if (shouldClear) {
            if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
              element.value = '';
            } else if (element instanceof HTMLElement && element.isContentEditable) {
              element.textContent = '';
            }
          }

          switch (fillMethod) {
            case 'set':
              if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
                element.value = text;
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
              } else if (element instanceof HTMLElement && element.isContentEditable) {
                element.textContent = text;
                element.dispatchEvent(new Event('input', { bubbles: true }));
              } else {
                throw new Error('Element does not support the set method');
              }
              break;

            case 'type':
              if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
                const original = element.value;
                element.value = original + text;
                for (let i = 0; i < text.length; i++) {
                  element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
                  element.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true }));
                  element.dispatchEvent(new Event('input', { bubbles: true }));
                  element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                }
              } else if (element instanceof HTMLElement && element.isContentEditable) {
                const original = element.textContent || '';
                element.textContent = original + text;
                element.dispatchEvent(new Event('input', { bubbles: true }));
              } else {
                throw new Error('Element does not support the type method');
              }
              break;

            case 'execCommand':
              if (!(element instanceof HTMLElement && element.isContentEditable)) {
                throw new Error('Element does not support execCommand (requires contenteditable)');
              }
              element.focus();
              if (shouldClear) document.execCommand('selectAll', false);
              document.execCommand('insertText', false, text);
              break;

            default:
              throw new Error(`Unsupported fill method: ${fillMethod}`);
          }
          return { success: true };
        },
        [selector, value, method, clearBefore],
      );

      return this.createTextResult(
        JSON.stringify({ success: true, selector, method, valueLength: value.length }),
      );
    } catch (err) {
      return this.createErrorResult(err instanceof Error ? err.message : 'Fill failed');
    }
  }

}

/**
 * browser_keyboard：向聚焦元素（或 selector 指定元素）发送按键序列。
 *
 * 参数：
 *   keys     必填，逗号分隔，如 `Enter` / `ArrowDown,A,Enter` / 任意单字符
 *   selector 先聚焦该元素（可选，默认用当前聚焦元素）
 *   delay    每个按键之间的间隔毫秒（默认 0）
 *   timeout  等待 selector 的超时，默认 30s
 *   tabId    目标标签页，缺省用活动标签
 *
 * 实现说明：页面里真正派发 keydown/keypress/keyup，并手动补上浏览器默认行为
 * （单字符写入、Enter 提交表单/换行、Backspace 删除），因为这些事件不会真触发默认行为。
 */
import { BaseTool } from './base.js';

export class KeyboardTool extends BaseTool {
  name = 'browser_keyboard';

  async execute(args) {
    const { keys, selector, delay = 0, timeout = 30000 } = args;
    if (!keys) return this.createErrorResult('keys 参数必填');

    try {
      const tab = await this.getTargetTab(args.tabId);
      if (!tab?.id) return this.createErrorResult('无法找到目标标签页');
      const tabId = tab.id;

      if (selector) {
        if (!(await this.waitForSelector(tabId, selector, timeout))) {
          return this.createErrorResult(`元素未找到: ${selector}`);
        }
        await this.executeInTab(
          tabId,
          (sel) => {
            const element = document.querySelector(sel);
            if (element instanceof HTMLElement) element.focus();
          },
          [selector],
        );
      }

      const keyList = keys.split(',').map((key) => key.trim());

      await this.executeInTab(
        tabId,
        // ⚠️ 这个函数会被序列化后在页面里执行，只能用参数和页面自己的全局对象
        async (list, delayMs) => {
          /** 特殊键名 → KeyboardEvent.key 的取值 */
          const KEY_ALIASES = {
            Enter: 'Enter',
            Space: ' ',
            Backspace: 'Backspace',
            Tab: 'Tab',
            Escape: 'Escape',
            ArrowUp: 'ArrowUp',
            ArrowDown: 'ArrowDown',
            ArrowLeft: 'ArrowLeft',
            ArrowRight: 'ArrowRight',
            Delete: 'Delete',
            Home: 'Home',
            End: 'End',
            PageUp: 'PageUp',
            PageDown: 'PageDown',
          };
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

          for (const rawKey of list) {
            const key = KEY_ALIASES[rawKey] || rawKey;
            const target = document.activeElement;
            if (!target) throw new Error('没有聚焦的元素');

            const down = new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true });
            const press = new KeyboardEvent('keypress', { key, code: key, bubbles: true, cancelable: true });
            const up = new KeyboardEvent('keyup', { key, code: key, bubbles: true, cancelable: true });
            target.dispatchEvent(down);
            target.dispatchEvent(press);

            const isTextInput =
              target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
            const isEditable = target instanceof HTMLElement && target.isContentEditable;

            if (key.length === 1 && isTextInput) {
              // 手动插入字符：input/textarea 不会因为合成事件而改变 value
              const value = target.value;
              const start = target.selectionStart || value.length;
              const end = target.selectionEnd || value.length;
              target.value = value.substring(0, start) + key + value.substring(end);
              target.selectionStart = target.selectionEnd = start + 1;
              target.dispatchEvent(new Event('input', { bubbles: true }));
            } else if (key.length === 1 && isEditable) {
              document.execCommand('insertText', false, key);
            } else if (key === 'Enter') {
              if (isTextInput) {
                const form = target.closest('form');
                if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
              } else if (isEditable) {
                document.execCommand('insertLineBreak');
              }
            } else if (key === 'Backspace') {
              if (isTextInput) {
                const value = target.value;
                const start = target.selectionStart || 0;
                const end = target.selectionEnd || 0;
                if (start === end && start > 0) {
                  target.value = value.substring(0, start - 1) + value.substring(end);
                  target.selectionStart = target.selectionEnd = start - 1;
                } else if (start !== end) {
                  target.value = value.substring(0, start) + value.substring(end);
                  target.selectionStart = target.selectionEnd = start;
                }
                target.dispatchEvent(new Event('input', { bubbles: true }));
              } else if (isEditable) {
                document.execCommand('delete');
              }
            }

            target.dispatchEvent(up);
            if (delayMs > 0) await sleep(delayMs);
          }
          return { success: true };
        },
        [keyList, delay],
      );

      return this.createTextResult(
        JSON.stringify({ success: true, keysCount: keyList.length, selector: selector || 'activeElement' }),
      );
    } catch (err) {
      return this.createErrorResult(err instanceof Error ? err.message : '键盘输入失败');
    }
  }
}

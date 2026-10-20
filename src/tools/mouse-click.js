/**
 * browser_mouse_click：CDP 真实鼠标点击（视口坐标），带随机化的按下时长。
 *
 * 参数：
 *   x / y           必填，视口坐标
 *   button          left(默认) | right | middle
 *   clickCount      点击次数，默认 1
 *   pressDurationMs 按下到松开的时间，缺省在 50~160ms 之间随机（更像真人）
 *   tabId           目标标签页，缺省用活动标签
 *
 * 与 browser_click 的区别：那条走 DOM 元素 + 派发事件，这条是真的 CDP 输入事件，
 * 能触发依赖真实指针行为的页面（拖拽、canvas、自定义控件）。
 */
import { BaseTool } from './base.js';
import { sendCommand, withDebugger } from '../cdp.js';
import { randomInt, sleep } from '../utils.js';

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

export class MouseClickTool extends BaseTool {
  name = 'browser_mouse_click';

  async execute(args) {
    const { x, y, button = 'left', clickCount = 1 } = args;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return this.createErrorResult('x/y 参数必填，且必须是视口坐标数字');
    }
    if (!['left', 'right', 'middle'].includes(button)) {
      return this.createErrorResult('button 仅支持 left/right/middle');
    }

    try {
      const tab = await this.getTargetTab(args.tabId);
      if (!tab?.id) return this.createErrorResult('无法找到目标标签页');
      const tabId = tab.id;
      const pressDuration = args.pressDurationMs ?? randomInt(50, 160);

      await withDebugger(tabId, async () => {
        // 先移动到目标位置，避免页面收到“凭空按下”
        await sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
        await sleep(randomInt(20, 80));
        await sendCommand(tabId, 'Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x,
          y,
          button,
          buttons: buttonsMask(button),
          clickCount,
        });
        await sleep(pressDuration);
        await sendCommand(tabId, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x,
          y,
          button,
          buttons: 0,
          clickCount,
        });
      });

      return this.createTextResult(
        JSON.stringify({ success: true, tabId, x, y, button, clickCount }),
      );
    } catch (err) {
      return this.createErrorResult(err instanceof Error ? err.message : '鼠标点击失败');
    }
  }
}

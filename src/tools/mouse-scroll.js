/**
 * browser_mouse_scroll：CDP 鼠标滚轮滚动（默认在视口中心）。
 *
 * 参数：
 *   deltaY     必填，向下为正、向上为负
 *   deltaX     横向滚动量，默认 0
 *   steps      拆成几次滚，1~20（默认 1）——拆开更像真人，也能触发懒加载
 *   x / y      滚轮位置，缺省视口中心
 *   intervalMs 每步间隔，缺省 80~180ms 随机
 *   tabId      目标标签页，缺省用活动标签
 */
import { BaseTool } from './base.js';
import { TimeoutError, detachDebugger, sendCommand, withDebugger } from '../cdp.js';
import { randomInt, sleep } from '../utils.js';

export class MouseScrollTool extends BaseTool {
  name = 'browser_mouse_scroll';

  async execute(args) {
    const { deltaX = 0, deltaY, steps = 1 } = args;
    if (!Number.isFinite(deltaY)) {
      return this.createErrorResult('deltaY 参数必填，向下滚动为正数，向上滚动为负数');
    }
    if (!Number.isFinite(deltaX)) return this.createErrorResult('deltaX 必须是数字');

    try {
      const tab = await this.getTargetTab(args.tabId);
      if (!tab?.id) return this.createErrorResult('无法找到目标标签页');
      const tabId = tab.id;

      const viewport = await this.executeInTab(tabId, () => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }));
      const x = Number.isFinite(args.x) ? args.x : Math.round(viewport.width / 2);
      const y = Number.isFinite(args.y) ? args.y : Math.round(viewport.height / 2);
      const stepCount = Math.max(1, Math.min(20, Math.floor(steps)));
      const stepDeltaX = deltaX / stepCount;
      const stepDeltaY = deltaY / stepCount;

      const dispatch = async () => {
        for (let step = 0; step < stepCount; step += 1) {
          await sendCommand(tabId, 'Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x,
            y,
            deltaX: stepDeltaX,
            deltaY: stepDeltaY,
          });
          if (step < stepCount - 1) await sleep(args.intervalMs ?? randomInt(80, 180));
        }
      };

      try {
        await withDebugger(tabId, dispatch);
      } catch (error) {
        if (!(error instanceof TimeoutError)) throw error;
        // Some pages stop acknowledging wheel events on a reused CDP session.
        // Recreate the session once before reporting failure.
        await detachDebugger(tabId);
        await sleep(200);
        await withDebugger(tabId, dispatch);
      }

      return this.createTextResult(
        JSON.stringify({ success: true, tabId, x, y, deltaX, deltaY, steps: stepCount }),
      );
    } catch (err) {
      return this.createErrorResult(err instanceof Error ? err.message : '鼠标滚动失败');
    }
  }
}

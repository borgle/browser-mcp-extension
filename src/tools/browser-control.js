/**
 * browser_control：标签页管理（关闭/读取/更新/查询/激活）。
 *
 * 参数：action = close_tab | get_tab | update_tab | query_tabs | activate_tab
 *       params = { tabId, updateInfo, queryInfo }
 * 返回结构与各 action 一致，统一含 { success, action, ... }。
 */
import { BaseTool } from './base.js';

export class BrowserControlTool extends BaseTool {
  name = 'browser_control';

  async execute({ action, params }) {
    if (!action || !params) return this.createErrorResult('action and params are required');
    try {
      switch (action) {
        case 'close_tab':
          return await this.closeTab(params);
        case 'get_tab':
          return await this.getTab(params);
        case 'update_tab':
          return await this.updateTab(params);
        case 'query_tabs':
          return await this.queryTabs(params);
        case 'activate_tab':
          return await this.activateTab(params);
        default:
          return this.createErrorResult(`Unknown action: ${action}`);
      }
    } catch (err) {
      return this.createErrorResult(err instanceof Error ? err.message : 'Operation failed');
    }
  }

  /** 只回传 AI 关心的字段，避免把 chrome.tabs.Tab 的其它内部字段塞进 MCP 结果 */
  static summarize(tab) {
    return { id: tab.id, url: tab.url, title: tab.title, status: tab.status, active: tab.active };
  }

  async closeTab(params) {
    if (!params.tabId) return this.createErrorResult('tabId is required');
    await chrome.tabs.remove(params.tabId);
    return this.createTextResult(
      JSON.stringify({ success: true, action: 'close_tab', tabId: params.tabId }),
    );
  }

  async getTab(params) {
    if (!params.tabId) return this.createErrorResult('tabId is required');
    const tab = await chrome.tabs.get(params.tabId);
    return this.createTextResult(
      JSON.stringify({ success: true, action: 'get_tab', tab: BrowserControlTool.summarize(tab) }),
    );
  }

  async updateTab(params) {
    if (!params.tabId) return this.createErrorResult('tabId is required');
    const tab = await chrome.tabs.update(params.tabId, params.updateInfo || {});
    if (!tab) return this.createErrorResult(`Tab ${params.tabId} does not exist`);
    return this.createTextResult(
      JSON.stringify({ success: true, action: 'update_tab', tab: BrowserControlTool.summarize(tab) }),
    );
  }

  async activateTab(params) {
    if (!params.tabId) return this.createErrorResult('tabId is required');
    const tab = await chrome.tabs.get(params.tabId);
    // 窗口最小化时用户看不到激活效果，先还原窗口
    if (tab.windowId !== undefined) {
      const win = await chrome.windows.get(tab.windowId).catch(() => undefined);
      if (win?.state === 'minimized') {
        await chrome.windows.update(tab.windowId, { state: 'normal' }).catch(() => {});
      }
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    }
    const activated = await chrome.tabs.update(params.tabId, { active: true });
    if (!activated) return this.createErrorResult(`Tab ${params.tabId} does not exist`);
    return this.createTextResult(
      JSON.stringify({
        success: true,
        action: 'activate_tab',
        tab: BrowserControlTool.summarize(activated),
      }),
    );
  }

  async queryTabs(params) {
    const tabs = await chrome.tabs.query(params.queryInfo || {});
    return this.createTextResult(
      JSON.stringify({
        success: true,
        action: 'query_tabs',
        tabs: tabs.map((tab) => BrowserControlTool.summarize(tab)),
      }),
    );
  }
}

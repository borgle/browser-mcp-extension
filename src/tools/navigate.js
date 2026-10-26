/**
 * browser_navigate：打开/复用标签页并等待加载。
 *
 * 参数：
 *   url                        必填，目标地址
 *   waitUntil                  load(默认) | domcontentloaded | networkidle
 *   timeout                    等待超时，默认 30s
 *   reuse                      true(默认) / "site" | "origin" | false
 *                              "site"：复用目标 URL 的同站点标签（忽略 www./m./mobile. 前缀，不跨子域）
 *                              "origin"：复用与目标 URL 完全同源的标签（协议、主机、端口）
 *                              false：总是新建标签
 *   reuseKey                   可选，显式工作标签名。同一 key 始终落到同一个标签；
 *                              首次出现会新建，不复用同站点其他标签
 *   automationGroupCollapsed   新建 AI 分组时是否折叠
 *   background                 true 表示后台打开不抢焦点
 *
 * 只复用属于 ABM 自动分组的标签，不会接管用户的私人标签页。
 * 站点范围从目标 URL 推导，不需要在代码里枚举站点。
 *
 * 返回 { success, url, tabId, previousTabId, reused, reuseMode }。
 */
import { BaseTool, invalidArgs } from './base.js';
import { STORAGE_KEY } from '../constants.js';
import { ensureTabInAutoGroup, getTabWithGrace, isAutoGroupTab, waitForNavigationCommit, waitForTabLoad } from '../tabs.js';
import { resolveReusePlan, sortTabsByLastAccessed } from '../reuse.js';

const REUSE_KEY_LIMIT = 50;

export class NavigateTool extends BaseTool {
  name = 'browser_navigate';

  async execute(args) {
    const {
      url,
      waitUntil = 'load',
      timeout = 30000,
      reuse = true,
      reuseKey,
      automationGroupCollapsed,
      background = false,
    } = args;
    if (!url) return this.createErrorResult('URL is required');

    const plan = resolveReusePlan({ url, reuse, reuseKey });
    if (plan.error) return invalidArgs(plan.error);

    const active = !background;
    try {
      const [currentTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

      const reusableTab = plan.mode ? await this.findReusableTab(plan) : undefined;
      const reused = Boolean(reusableTab?.id);

      // 复用标签时必须先挂上"等待提交"，再发起导航：
      // tabs.update() 返回时旧文档可能仍是 complete，过早等加载会读到旧页面。
      const committed = reused
        ? waitForNavigationCommit(reusableTab.id, Math.min(timeout, 15000))
        : undefined;

      const tab = reusableTab?.id
        ? await chrome.tabs.update(reusableTab.id, { url, active })
        : await chrome.tabs.create({ url, active });
      if (!tab?.id) return this.createErrorResult(reused ? 'Failed to reuse tab' : 'Failed to create tab');

      const tabId = tab.id;
      // 归组失败不影响导航本身（例如用户把分组功能关掉了）
      await ensureTabInAutoGroup(tabId, { collapsed: automationGroupCollapsed }).catch(() => {});
      if (plan.mode === 'key') await this.rememberReuseKey(plan.key, tabId);
      if (committed) await committed;

      switch (waitUntil) {
        case 'load':
          await waitForTabLoad(tabId, timeout);
          break;
        case 'domcontentloaded':
          await this.waitForReadyState(tabId, 'interactive', timeout);
          break;
        case 'networkidle':
          await waitForTabLoad(tabId, timeout);
          await this.waitForNetworkIdle(tabId, 2000, timeout);
          break;
        default:
          break;
      }

      const finalTab = await getTabWithGrace(tabId);
      if (!finalTab) return this.createErrorResult(reused ? 'Failed to reuse tab' : 'Failed to create tab');
      return this.createTextResult(
        JSON.stringify({
          success: true,
          url: finalTab.url,
          tabId: finalTab.id,
          previousTabId: currentTab?.id,
          reused,
          reuseMode: plan.mode,
        }),
      );
    } catch (err) {
      return this.createErrorResult(err instanceof Error ? err.message : 'Navigation failed');
    }
  }

  /**
   * 查找可复用的标签：
   *   1. reuseKey 记录过的标签（仍存在且属于 ABM 分组）
   *   2. 按站点 pattern 命中的 ABM 分组标签，取最近访问的一个
   * 当前活动标签也参与候选——它属于 ABM 分组时直接改地址即可。
   */
  async findReusableTab(plan) {
    if (plan.mode === 'key' && plan.key) {
      const mapped = await this.readReuseKey(plan.key);
      if (mapped !== undefined) {
        const tab = await getTabWithGrace(mapped, 300);
        if (tab?.id && (await isAutoGroupTab(tab))) return tab;
      }
    }
    if (plan.patterns.length === 0) return undefined;

    const candidates = await chrome.tabs.query({ url: plan.patterns });
    for (const tab of sortTabsByLastAccessed(candidates)) {
      if (await isAutoGroupTab(tab)) return tab;
    }
    return undefined;
  }

  async readReuseKey(key) {
    const map = await this.readReuseKeys();
    const tabId = map[key];
    return typeof tabId === 'number' ? tabId : undefined;
  }

  async readReuseKeys() {
    const stored = (await chrome.storage.local.get(STORAGE_KEY.reuseKeys))[STORAGE_KEY.reuseKeys];
    return stored && typeof stored === 'object' ? stored : {};
  }

  /** 记录 key → tabId，并限制条目数量 */
  async rememberReuseKey(key, tabId) {
    if (!key) return;
    const map = await this.readReuseKeys();
    map[key] = tabId;
    const keys = Object.keys(map);
    if (keys.length > REUSE_KEY_LIMIT) {
      for (const name of keys.slice(0, keys.length - REUSE_KEY_LIMIT)) delete map[name];
    }
    await chrome.storage.local.set({ [STORAGE_KEY.reuseKeys]: map });
  }

  /** 轮询 document.readyState 直到达到目标状态（或变成 complete） */
  async waitForReadyState(tabId, expected, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      try {
        const state = await this.executeInTab(tabId, () => document.readyState);
        if (state === expected || state === 'complete') return;
      } catch {
        // 页面正在导航、执行上下文被销毁：等下一次轮询
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for readyState=${expected}`);
  }

  /** 等到连续 idleMs 内没有网络请求完成 */
  async waitForNetworkIdle(tabId, idleMs, timeoutMs) {
    const startedAt = Date.now();
    let lastActivityAt = Date.now();
    const onCompleted = (details) => {
      if (details.tabId === tabId) lastActivityAt = Date.now();
    };
    chrome.webRequest.onCompleted.addListener(onCompleted, { urls: ['<all_urls>'] });
    try {
      while (Date.now() - startedAt < timeoutMs) {
        if (Date.now() - lastActivityAt >= idleMs) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error('Timed out waiting for network idle');
    } finally {
      chrome.webRequest.onCompleted.removeListener(onCompleted);
    }
  }
}

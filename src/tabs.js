/**
 * 标签页公共操作：自动化标签分组、等待页面加载、等待导航。
 * 这些方法被多个工具复用（browser_navigate / browser_click / …）。
 */
import { AUTO_GROUP, ERR, STORAGE_KEY } from './constants.js';

/**
 * 刚创建/刚操作的标签在部分浏览器（例如 Codex 内置浏览器）里会**稍后**才出现在
 * `chrome.tabs.get` / `chrome.tabs.query` 里，立刻查询会拿到 "No tab with id"。
 * 实测：browser_navigate 建完标签马上 tabs.get 会失败，于是白白报 “Tab not found”。
 * 这里给一个短暂的宽限期，多次重试后再判定真的不存在。
 */
export const TAB_LOOKUP_GRACE_MS = 3000;

/** 查询标签，短时间内轮询重试；仍然查不到返回 null */
export async function getTabWithGrace(tabId, graceMs = TAB_LOOKUP_GRACE_MS) {
  const deadline = Date.now() + graceMs;
  for (;;) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab) return tab;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/** 读取 AI 标签分组的 groupId（分组已被用户关掉则返回 undefined） */
async function readGroupId() {
  const stored = (await chrome.storage.local.get(STORAGE_KEY.automationGroupId))[
    STORAGE_KEY.automationGroupId
  ];
  return typeof stored === 'number' ? stored : undefined;
}

/** 记住 / 清除 AI 标签分组的 groupId */
async function writeGroupId(groupId) {
  if (groupId === undefined) {
    await chrome.storage.local.remove(STORAGE_KEY.automationGroupId);
  } else {
    await chrome.storage.local.set({ [STORAGE_KEY.automationGroupId]: groupId });
  }
}

/**
 * 把标签放进 AI 分组（分组不存在或已被关闭时新建）。
 * @param {number} tabId
 * @param {{collapsed?: boolean}} [options] 新建分组时的折叠状态
 */
export async function ensureTabInAutoGroup(tabId, options = {}) {
  let groupId = await readGroupId();
  if (groupId !== undefined) {
    try {
      await chrome.tabGroups.get(groupId);
    } catch {
      // 用户手动删掉了分组：忘掉记录，下面重建
      groupId = undefined;
      await writeGroupId(undefined);
    }
  }

  if (groupId === undefined) {
    groupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, {
      title: AUTO_GROUP.title,
      color: AUTO_GROUP.color,
      collapsed: options.collapsed ?? false,
    });
    await writeGroupId(groupId);
  } else {
    await chrome.tabs.group({ tabIds: [tabId], groupId });
    if (options.collapsed !== undefined) {
      await chrome.tabGroups.update(groupId, { collapsed: options.collapsed });
    }
  }
}

/** 该标签是否属于 AI 分组（用于 browser_navigate 的标签复用） */
export async function isAutoGroupTab(tab) {
  if (typeof tab.groupId !== 'number' || tab.groupId < 0) return false;
  try {
    const { title } = await chrome.tabGroups.get(tab.groupId);
    return title === AUTO_GROUP.title;
  } catch {
    return false;
  }
}

/**
 * 等待标签完成一次主框架导航提交（新文档已经就位）。
 *
 * `chrome.tabs.update()` 在导航提交前就返回，旧文档此时依然可能是
 * `status === 'complete'`、`readyState === 'complete'`，直接等加载会命中旧页面。
 * `webNavigation.onCommitted` 是新文档真正提交的信号，必须在发起导航**之前**注册。
 *
 * @returns {Promise<boolean>} 是否在超时前完成任务级提交
 */
export function waitForNavigationCommit(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      chrome.webNavigation.onCommitted.removeListener(onCommitted);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const onCommitted = (details) => {
      if (details.tabId === tabId && details.frameId === 0) finish(true);
    };
    const onRemoved = (removedTabId) => {
      if (removedTabId === tabId) finish(false);
    };

    timer = setTimeout(() => finish(false), timeoutMs);
    chrome.webNavigation.onCommitted.addListener(onCommitted);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

/**
 * 等待标签加载完成（status === 'complete'）。
 * 标签不存在、超时、加载中途被关闭都会抛出，由调用方转成错误结果。
 */
export function waitForTabLoad(tabId, timeoutMs = 30000) {
  return (async () => {
    const tab = await getTabWithGrace(tabId);
    if (!tab) throw new Error('Tab not found');
    if (tab.status === 'complete') return;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(ERR.pageLoadTimeout));
      }, timeoutMs);

      const onUpdated = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          cleanup();
          resolve();
        }
      };
      const onRemoved = (removedTabId) => {
        if (removedTabId === tabId) {
          cleanup();
          reject(new Error('Tab closed before load finished'));
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.onRemoved.removeListener(onRemoved);
      };

      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.onRemoved.addListener(onRemoved);
    });
  })();
}

/**
 * 等待标签发生一次主框架导航（含成功/失败/被关闭三种收敛）。
 * @returns {Promise<boolean>} 是否成功完成导航
 */
export function waitForNavigation(tabId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let completed = false;
    const finish = (value) => {
      cleanup();
      resolve(value);
    };
    const timer = setTimeout(() => finish(completed), timeoutMs);
    const onCompleted = (details) => {
      if (details.tabId === tabId && details.frameId === 0) {
        completed = true;
        finish(true);
      }
    };
    const onError = (details) => {
      if (details.tabId === tabId && details.frameId === 0) finish(false);
    };
    const onRemoved = (removedTabId) => {
      if (removedTabId === tabId) finish(false);
    };
    const cleanup = () => {
      clearTimeout(timer);
      chrome.webNavigation.onCompleted.removeListener(onCompleted);
      chrome.webNavigation.onErrorOccurred.removeListener(onError);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };

    chrome.webNavigation.onCompleted.addListener(onCompleted);
    chrome.webNavigation.onErrorOccurred.addListener(onError);
    chrome.tabs.onRemoved.addListener(onRemoved);
    // 标签在等待期间被关掉时 chrome.tabs.get 会走 lastError
    chrome.tabs.get(tabId, (tab) => {
      if (!chrome.runtime.lastError && tab) return;
      finish(false);
    });
  });
}

/**
 * 先挂上“等待导航”，再执行会触发跳转的动作（点击/回车等）。
 * @param {number} tabId
 * @param {() => Promise<void>} action
 * @param {boolean} expectNavigation 是否真的等导航（false 直接执行）
 */
export async function clickAndWaitForNavigation(tabId, action, expectNavigation = true, timeoutMs = 30000) {
  if (!expectNavigation) {
    await action();
    return { clicked: true, navigationOccurred: false };
  }
  const navigation = waitForNavigation(tabId, timeoutMs);
  try {
    await action();
  } catch (err) {
    // 动作失败时别留下悬挂的等待
    navigation.catch(() => {});
    throw err;
  }
  return { clicked: true, navigationOccurred: await navigation };
}

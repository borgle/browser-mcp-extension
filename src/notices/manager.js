/**
 * 站内通知（后端 notice 消息 → 扩展本地存储 → popup 通知板 + 角标红点）。
 *
 * 存储：每个通知一条 `notice:<id>`，对象含 { id, title, level, body, actionUrl, receivedAt, read }。
 * 只保留最近 NOTICE_LIMIT 条，避免 storage 无限膨胀。
 */
import { NOTICE_LIMIT, STORAGE_KEY } from '../constants.js';

const PREFIX = STORAGE_KEY.noticePrefix;

function keyOf(id) {
  return `${PREFIX}${id}`;
}

/** 通知对象的最小校验：至少要有 id */
function isValidNotice(value) {
  return !!value && typeof value === 'object' && typeof value.id === 'string';
}

/** actionUrl 只放行 http/https，避免被塞进奇怪协议 */
function safeActionUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return undefined;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** 列出全部通知（按接收时间升序） */
export async function listNotices() {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(PREFIX))
    .map(([, value]) => value)
    .filter(isValidNotice)
    .sort((a, b) => (a.receivedAt || 0) - (b.receivedAt || 0));
}

/** 未读通知 */
export async function listUnreadNotices() {
  return (await listNotices()).filter((notice) => !notice.read);
}

/**
 * 保存一条通知（同 id 幂等，不会重复红点）。
 * @returns {Promise<object|null>} 保存的通知对象；参数非法时返回 null
 */
export async function saveNotice(payload) {
  const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
  const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
  if (!id || !title) return null;

  const notice = {
    id,
    title,
    level: payload.level === 'warning' ? 'warning' : 'info',
    body: typeof payload.body === 'string' ? payload.body : undefined,
    actionUrl: safeActionUrl(payload.actionUrl),
  };

  const existing = (await chrome.storage.local.get(keyOf(id)))[keyOf(id)];
  if (isValidNotice(existing)) {
    await refreshBadge();
    return existing;
  }

  const stored = { ...notice, receivedAt: Date.now(), read: false };
  await chrome.storage.local.set({ [keyOf(id)]: stored });
  await trimNotices();
  await refreshBadge();
  return stored;
}

/** 超出上限时删掉最旧的通知 */
async function trimNotices() {
  const notices = await listNotices();
  if (notices.length <= NOTICE_LIMIT) return;
  const obsolete = notices.slice(0, notices.length - NOTICE_LIMIT);
  await chrome.storage.local.remove(obsolete.map((notice) => keyOf(notice.id)));
}

/** 角标：有未读显示红点，否则清空 */
export async function refreshBadge() {
  try {
    if ((await listUnreadNotices()).length > 0) {
      await chrome.action.setBadgeBackgroundColor({ color: '#F5222D' });
      await chrome.action.setBadgeText({ text: '●' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch {
    // popup/角标不可用时忽略
  }
}

/** 标记已读（popup 通知板使用；popup 也直接操作 storage，这里便于代码复用） */
export async function markNoticeRead(id, read = true) {
  const key = keyOf(id);
  const notice = (await chrome.storage.local.get(key))[key];
  if (!isValidNotice(notice)) return;
  await chrome.storage.local.set({ [key]: { ...notice, read } });
  await refreshBadge();
}

/** 删除单条通知 */
export async function removeNotice(id) {
  await chrome.storage.local.remove(keyOf(id));
  await refreshBadge();
}

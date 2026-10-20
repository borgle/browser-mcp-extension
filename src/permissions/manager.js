/**
 * 域名（下载）权限管理。
 *
 * 背景：扩展只在 manifest 里声明了几个固定站点的 host 权限，其余站点走
 * `optional_host_permissions: ["<all_urls>"]` + 用户授权。凡是“扩展主动 fetch 某站点”
 * 的能力（下载视频、按 URL 取图）都先查这里的权限，没有权限就回 needPermission 让用户去授权。
 */
import { STORAGE_KEY } from '../constants.js';
import { BUILT_IN_HOSTS, hostPatternsOf, parseHostInput } from './host-input.js';

/**
 * 是否已“一键放开所有域名”。
 *
 * 以浏览器**实际持有的权限**为准，storage 里的标记只当缓存：
 * 用户在权限提示还没结束时关掉 popup（popup 会被系统关掉）时，标记可能没写成，
 * 这里顺手补上，避免出现「权限其实给了但界面一直显示没给」。
 */
export async function isAllHostsAuthorized() {
  const granted = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  if (!granted) return false;
  const stored = (await chrome.storage.local.get(STORAGE_KEY.allHostsAuthorized))[
    STORAGE_KEY.allHostsAuthorized
  ];
  if (!stored) await chrome.storage.local.set({ [STORAGE_KEY.allHostsAuthorized]: true });
  return true;
}

/** 扩展是否有权访问该 URL：已放开全部域名，或该 host 被单独授权 */
export async function hasHostPermission(url) {
  try {
    if (await isAllHostsAuthorized()) return true;
    return await chrome.permissions.contains({ origins: [hostPatternOf(url)] });
  } catch {
    // URL 非法 / 浏览器拒绝该 pattern：当作没有权限
    return false;
  }
}

/** `https://a.b.com/x` → `https://a.b.com/*`（match pattern 忽略端口） */
export function hostPatternOf(url) {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

/** `https://*.example.com/*` → `example.com`；无效 pattern 返回空串 */
function hostOfPattern(pattern) {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/]+)/i.exec(pattern || '');
  if (!match) return '';
  return match[1].replace(/^\*\./, '').toLowerCase();
}

/** manifest 静态授权的 host：浏览器不允许撤销，因此不进入可管理列表 */
function staticHosts() {
  const patterns = chrome.runtime?.getManifest?.().host_permissions || [];
  return new Set(patterns.map(hostOfPattern).filter(Boolean));
}

/**
 * 浏览器当前实际持有的可选 host。
 *
 * 用户在权限弹窗里点“允许”后，popup 可能立即被系统关闭，来不及把域名写进 storage；
 * 所以这里以 `permissions.getAll()` 为准，把“已授权但没记账”的域名补回来。
 */
async function grantedHosts() {
  try {
    const { origins = [] } = await chrome.permissions.getAll();
    return origins.map(hostOfPattern).filter(Boolean);
  } catch {
    // 浏览器不支持 getAll：退回只读 storage
    return [];
  }
}

/**
 * 用户手动添加的域名列表。
 *
 * = storage 列表 ∪ 浏览器实际持有的可选 host
 * − 内置域名（本机地址）− manifest 静态授权（不可撤销）。
 * 列表去重后排序，并把补回来的域名写回 storage。
 */
export async function getAuthorizedHosts() {
  const stored = (await chrome.storage.local.get(STORAGE_KEY.authorizedHosts))[
    STORAGE_KEY.authorizedHosts
  ] || [];
  const builtIn = new Set([...BUILT_IN_HOSTS, ...staticHosts()]);
  const managed = [...new Set([...stored, ...(await grantedHosts())])]
    .filter((host) => host && !builtIn.has(host))
    .sort();

  if (JSON.stringify(managed) !== JSON.stringify(stored)) {
    await chrome.storage.local.set({ [STORAGE_KEY.authorizedHosts]: managed });
  }
  return managed;
}

/** 清理列表中的内置域名，并标记初始化完成 */
export async function initHostListOnce() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEY.hostsInitialized,
    STORAGE_KEY.authorizedHosts,
  ]);
  const hosts = (stored[STORAGE_KEY.authorizedHosts] || []).filter(
    (host) => !BUILT_IN_HOSTS.includes(host),
  );
  await chrome.storage.local.set({
    [STORAGE_KEY.authorizedHosts]: hosts,
    [STORAGE_KEY.hostsInitialized]: true,
  });
}

/** 请求 <all_urls> 权限，成功后记住标记 */
export async function requestAllHostsPermission() {
  try {
    await chrome.permissions.contains({ origins: ['<all_urls>'] });
    const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
    if (granted) await chrome.storage.local.set({ [STORAGE_KEY.allHostsAuthorized]: true });
    return granted;
  } catch {
    return false;
  }
}

/** 撤销 <all_urls> 权限（并清掉标记） */
export async function revokeAllHostsPermission() {
  try {
    const removed = await chrome.permissions.remove({ origins: ['<all_urls>'] });
    if (removed) await chrome.storage.local.set({ [STORAGE_KEY.allHostsAuthorized]: false });
    await chrome.permissions.contains({ origins: ['<all_urls>'] });
    return removed;
  } catch {
    return false;
  }
}

/** 请求某个具体域名的权限（http/https 及其子域），成功后写入列表 */
export async function addHostPermission(domain) {
  try {
    const parsed = parseHostInput(domain);
    if (parsed.error) return false;
    const granted = await chrome.permissions.request({ origins: hostPatternsOf(parsed.host) });
    if (granted) await rememberHost(parsed.host);
    return granted;
  } catch {
    return false;
  }
}

/** 撤销域名权限并移出列表 */
export async function removeHostPermission(domain) {
  try {
    const parsed = parseHostInput(domain);
    if (parsed.error) return false;
    const hosts = (await getAuthorizedHosts()).filter((item) => item !== parsed.host);
    await chrome.storage.local.set({ [STORAGE_KEY.authorizedHosts]: hosts });
    await chrome.permissions.remove({ origins: hostPatternsOf(parsed.host) });
    return true;
  } catch {
    return false;
  }
}

/** 只记列表、不动浏览器权限（popup 里“补齐列表”用） */
export async function rememberHost(host) {
  const hosts = await getAuthorizedHosts();
  if (!hosts.includes(host)) {
    hosts.push(host);
    await chrome.storage.local.set({ [STORAGE_KEY.authorizedHosts]: hosts });
  }
}

/**
 * 标签复用范围解析（纯函数，不依赖 chrome，便于单测）。
 *
 * 设计原则：站点范围一律从**目标 URL 自身**推导，不维护站点枚举。
 * 新增站点不需要改这里。
 *
 * 复用范围：
 *   site    同站点：主机名一致，忽略 www./m./mobile. 前缀，不跨子域（默认）
 *   origin  严格同源：协议、主机、端口完全一致
 */

const REUSE_MODES = Object.freeze(['site', 'origin']);
const HOST_PREFIX = /^(?:www|m|mobile)\./;

/** `www.zhihu.com` → `zhihu.com`；`mp.weixin.qq.com` 保持原样 */
export function normalizeReuseHost(hostname) {
  return String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(HOST_PREFIX, '');
}

/**
 * 目标 URL → `chrome.tabs.query` 的 URL 过滤条件。
 * 非 http(s) 或无法解析时返回空数组（不参与复用）。
 *
 * site：只覆盖原始主机与去掉 www./m./mobile. 后的主机，**不跨子域**，
 *       避免把 search.bilibili.com 的搜索结果复用成 member.bilibili.com。
 */
export function reusePatternsFor(url, mode = 'site') {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname) return [];

  if (mode === 'origin') return [`${parsed.protocol}//${parsed.host}/*`];

  const hosts = [...new Set([parsed.hostname.toLowerCase(), normalizeReuseHost(parsed.hostname)])];
  return hosts.filter(Boolean).map((host) => `*://${host}/*`);
}

/**
 * 解析一次导航的复用计划。
 *
 * @param {{url?: string, reuse?: boolean|'site'|'origin', reuseKey?: string}} input
 * @returns {{mode: null|'site'|'origin'|'key', key?: string, patterns: string[], error?: string}}
 */
export function resolveReusePlan({ url, reuse = true, reuseKey } = {}) {
  const value = reuse === null ? true : reuse;
  if (value !== true && value !== false && !REUSE_MODES.includes(value)) {
    return {
      mode: null,
      patterns: [],
      error: `reuse accepts true, false, site, or origin; received ${String(value)}`,
    };
  }
  if (value === false) return { mode: null, patterns: [] };

  const key = typeof reuseKey === 'string' && reuseKey.trim() ? reuseKey.trim() : undefined;
  const mode = value === 'origin' ? 'origin' : 'site';
  const patterns = reusePatternsFor(url, mode);

  // key 是"专属标签"：没有记录就新建，绝不回退到同站点其他标签，
  // 否则两个 key 会挤到同一个标签上，搜索/发布就分不开了。
  if (key) return { mode: 'key', key, patterns: [] };
  if (patterns.length === 0) return { mode: null, patterns: [] };

  return { mode, patterns };
}

/** 按最近访问排序（纯函数，不改动入参） */
export function sortTabsByLastAccessed(tabs = []) {
  return [...tabs]
    .filter((tab) => tab && typeof tab.id === 'number')
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
}

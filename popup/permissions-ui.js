/**
 * popup 侧的域名权限操作。
 *
 * 为什么放在 popup 而不是 SW：
 *   `chrome.permissions.request()` 必须在**有用户手势的扩展页面**里调用，
 *   从 Service Worker 的消息回调里转发过去（1.7.3 的做法）会被拒绝，
 *   表现就是「一键允许所有网站」点了没反应/失败。
 *   所以：权限的申请/撤销在 popup 里做，storage 的记账交给 SW（api.js 的消息）。
 */
import { api } from './api.js';
import { hostPatternsOf, parseHostInput } from '../src/permissions/host-input.js';

function describe(error) {
  if (!error) return '';
  return error instanceof Error ? error.message : String(error);
}

/** 申请 <all_urls>（会弹浏览器授权框，popup 期间可能被系统关掉，属正常现象） */
export async function requestAllHosts() {
  try {
    const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
    await api.setAllHostsAuthorized(!!granted);
    return { success: !!granted };
  } catch (error) {
    return { success: false, error: describe(error) };
  }
}

/** 撤销 <all_urls> */
export async function revokeAllHosts() {
  try {
    await chrome.permissions.remove({ origins: ['<all_urls>'] });
    await api.setAllHostsAuthorized(false);
    return { success: true };
  } catch (error) {
    return { success: false, error: describe(error) };
  }
}

/** 申请单个域名的下载权限，成功后让 SW 记进列表 */
export async function grantHost(domain) {
  const parsed = parseHostInput(domain);
  if (parsed.error) return { success: false, error: parsed.error };
  try {
    const granted = await chrome.permissions.request({ origins: hostPatternsOf(parsed.host) });
    if (!granted) return { success: false, error: '未授予权限（可能被浏览器或用户取消）' };
    await api.addHostToStorage(parsed.host);
    return { success: true, host: parsed.host };
  } catch (error) {
    return { success: false, error: describe(error) };
  }
}

/** 撤销某个域名的权限，并让 SW 从列表里移除 */
export async function revokeHost(domain) {
  const parsed = parseHostInput(domain);
  if (parsed.error) return { success: false, error: parsed.error };
  try {
    const result = await api.removeHost(parsed.host);
    return { success: result.success, error: result.error };
  } catch (error) {
    return { success: false, error: describe(error) };
  }
}

/**
 * popup → Service Worker 的消息封装。
 * 所有请求都走同一个入口，返回统一为 `{ success, ... }`；
 * 后台抛错时 chrome.runtime.lastError 会被转成 { success:false, error }。
 */
import { POPUP_MSG } from '../src/message-types.js';

export function sendToBackground(type, payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { success: false, error: 'no response' });
    });
  });
}

export const api = {
  /** 连接状态（含 authRejected / lastError） */
  getStatus: () => sendToBackground(POPUP_MSG.GET_STATUS),
  /** 读取连接配置 */
  getConfig: () => sendToBackground(POPUP_MSG.GET_CONFIG),
  /** 保存连接配置（改服务器或 Key 会断开旧连接） */
  saveConfig: (config) => sendToBackground(POPUP_MSG.SAVE_CONFIG, config),
  /** 用当前配置（或传入的 serverBaseUrl/apiKey）连接 */
  connect: (params) => sendToBackground(POPUP_MSG.CONNECT, params),
  /** 主动断开（不再重连） */
  disconnect: () => sendToBackground(POPUP_MSG.DISCONNECT),

  /** 下载权限状态（只读，读操作不需要手势，留在 SW） */
  getPermissionStatus: () => sendToBackground(POPUP_MSG.GET_PERMISSION_STATUS),
  /**
   * 记账用的消息（权限的实际申请/撤销由 popup 直接调 chrome.permissions.* 完成，
   * 因为那需要用户手势；见 popup/permissions-ui.js）。
   */
  setAllHostsAuthorized: (authorized) => sendToBackground(POPUP_MSG.SET_ALL_HOSTS_AUTHORIZED, { authorized }),
  addHostToStorage: (domain) => sendToBackground(POPUP_MSG.ADD_HOST_TO_STORAGE, { domain }),
  removeHost: (domain) => sendToBackground(POPUP_MSG.REMOVE_HOST_PERMISSION, { domain }),
};

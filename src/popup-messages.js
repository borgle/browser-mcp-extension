import { loadConnectionConfig, saveConnectionConfig } from './core/storage.js';
import { STORAGE_KEY } from './constants.js';
import { POPUP_MSG } from './message-types.js';
import {
  addHostPermission,
  getAuthorizedHosts,
  isAllHostsAuthorized,
  rememberHost,
  removeHostPermission,
  requestAllHostsPermission,
  revokeAllHostsPermission,
} from './permissions/manager.js';
import { executeTool } from './tools/registry.js';
import { wsClient } from './core/connection.js';
import { parseHostInput } from './permissions/host-input.js';

export async function buildConnectionStatus() {
  const config = await loadConnectionConfig();
  const connected = wsClient.isConnected();
  const auth = wsClient.getAuthState();
  return {
    connected,
    serverBaseUrl: wsClient.getCurrentBaseUrl() || config.serverBaseUrl,
    reconnecting: !connected && wsClient.getShouldReconnect(),
    lastError: connected ? undefined : auth.lastError,
    authRejected: auth.authRejected,
    lastUpdated: Date.now(),
  };
}

export async function handlePopupMessage(message) {
  const { type, payload } = message || {};
  switch (type) {
    case POPUP_MSG.EXECUTE_TOOL: {
      const result = await executeTool(payload);
      return { success: !result.isError, result };
    }
    case POPUP_MSG.GET_STATUS:
      return { success: true, status: await buildConnectionStatus() };
    case POPUP_MSG.CONNECT: {
      let baseUrl = payload?.serverBaseUrl;
      let apiKey = payload?.apiKey;
      if (!baseUrl || !apiKey) {
        const config = await loadConnectionConfig();
        baseUrl = baseUrl || config.serverBaseUrl;
        apiKey = apiKey || config.apiKey;
      }
      if (!apiKey) return { success: false, error: '请先填写 API Key' };
      await wsClient.clearAuthRejection();
      wsClient.updateConfig({ serverBaseUrl: baseUrl, apiKey });
      return wsClient.connect(baseUrl);
    }
    case POPUP_MSG.DISCONNECT:
      await wsClient.disconnect();
      return { success: true };
    case POPUP_MSG.GET_CONFIG:
      return { success: true, config: await loadConnectionConfig() };
    case POPUP_MSG.SAVE_CONFIG: {
      const config = await saveConnectionConfig(payload || {});
      await wsClient.disconnect();
      wsClient.updateConfig(config);
      return { success: true, config };
    }
    case POPUP_MSG.GET_PERMISSION_STATUS:
      return {
        success: true,
        status: {
          allHostsAuthorized: await isAllHostsAuthorized(),
          authorizedHosts: await getAuthorizedHosts(),
        },
      };
    case POPUP_MSG.REQUEST_ALL_HOSTS_PERMISSION:
      return { success: await requestAllHostsPermission() };
    case POPUP_MSG.REVOKE_ALL_HOSTS_PERMISSION:
      await revokeAllHostsPermission();
      return { success: true };
    case POPUP_MSG.ADD_HOST_PERMISSION: {
      const parsed = parseHostInput(payload?.domain);
      if (parsed.error) return { success: false, error: parsed.error };
      const granted = await addHostPermission(parsed.host);
      return {
        success: granted,
        error: granted ? undefined : '未授予权限（可能被浏览器或用户取消）',
      };
    }
    case POPUP_MSG.REMOVE_HOST_PERMISSION:
      return { success: await removeHostPermission(payload?.domain) };
    case POPUP_MSG.SET_ALL_HOSTS_AUTHORIZED:
      await chrome.storage.local.set({
        [STORAGE_KEY.allHostsAuthorized]: !!payload?.authorized,
      });
      return {
        success: true,
        status: {
          allHostsAuthorized: await isAllHostsAuthorized(),
          authorizedHosts: await getAuthorizedHosts(),
        },
      };
    case POPUP_MSG.ADD_HOST_TO_STORAGE:
      await rememberHost(payload?.domain);
      return { success: true };
    default:
      return { success: false, error: '未知消息类型' };
  }
}

export function installPopupMessageListener() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handlePopupMessage(message)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  });
}


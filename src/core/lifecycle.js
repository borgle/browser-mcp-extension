import { RECONNECT } from '../constants.js';
import { registerBuiltinTools } from '../tools/registry.js';
import { initHostListOnce } from '../permissions/manager.js';
import { refreshBadge } from '../notices/manager.js';
import { loadConnectionConfig } from './storage.js';
import { wsClient } from './connection.js';
import { installPopupMessageListener } from '../popup-messages.js';
import { installExternalMessageListener } from '../video/receiver.js';
import { trackInjectedTabRemoval } from '../injectable.js';
import { setTabCleanupHook, trackDebuggerLifecycle } from '../cdp.js';
import { NetworkInterceptTool } from '../tools/network-intercept.js';

export async function startLifecycle() {
  registerBuiltinTools();
  trackInjectedTabRemoval();
  trackDebuggerLifecycle();
  setTabCleanupHook((tabId) => NetworkInterceptTool.cleanupTab(tabId));
  installPopupMessageListener();
  installExternalMessageListener();
  await Promise.all([initHostListOnce(), refreshBadge()]);

  const config = await loadConnectionConfig();
  wsClient.updateConfig(config);
  await wsClient.initialize();

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RECONNECT.alarmName) void wsClient.reconnectIfNeeded();
  });
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') void initHostListOnce();
  });
}


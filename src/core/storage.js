import { DEFAULT_CONNECTION, STORAGE_KEY, serverBaseUrl } from '../constants.js';

export async function loadConnectionConfig() {
  const stored = (await chrome.storage.local.get(STORAGE_KEY.connectionConfig))[
    STORAGE_KEY.connectionConfig
  ];
  if (!stored) {
    const initial = { ...DEFAULT_CONNECTION };
    await chrome.storage.local.set({ [STORAGE_KEY.connectionConfig]: initial });
    return initial;
  }
  const normalizedBaseUrl = serverBaseUrl(
    stored.serverBaseUrl || DEFAULT_CONNECTION.serverBaseUrl,
  );
  const config = {
    ...DEFAULT_CONNECTION,
    ...stored,
    serverBaseUrl: normalizedBaseUrl,
  };
  if (normalizedBaseUrl !== stored.serverBaseUrl) {
    await chrome.storage.local.set({ [STORAGE_KEY.connectionConfig]: config });
  }
  return config;
}

export async function saveConnectionConfig(patch) {
  const current = await loadConnectionConfig();
  const next = {
    ...current,
    ...patch,
    serverBaseUrl: serverBaseUrl(patch.serverBaseUrl ?? current.serverBaseUrl),
  };
  await chrome.storage.local.set({ [STORAGE_KEY.connectionConfig]: next });
  return next;
}

export function broadcastStatus(status) {
  chrome.runtime
    .sendMessage({ type: 'ABM_SERVER_STATUS_CHANGED', payload: status })
    .catch(() => {});
}

/**
 * ABM 扩展 WebSocket 客户端。
 *
 * 连接服务器基础地址后派生 /api/v1/extension/ws，使用 abm/1 信封。
 * service worker 唤醒后使用 storage.session 和 alarms 恢复连接。
 */
import {
  DEFAULT_CONNECTION,
  ERROR_CODE,
  MSG,
  OPEN_PORTAL_ERROR_CODES,
  RECONNECT,
  STORAGE_KEY,
  TERMINAL_ERROR_CODES,
  WS_SUBPROTOCOL,
  websocketUrl,
} from '../constants.js';
import { envelope, messageId, parseEnvelope } from './protocol.js';
import { broadcastStatus, loadConnectionConfig } from './storage.js';
import { refreshBadge, saveNotice } from '../notices/manager.js';
import { executeTool } from '../tools/registry.js';

function nextReconnectDelay(previousDelay) {
  const doubled = Math.min(2 * previousDelay, RECONNECT.maxMs);
  const jitter = 0.2 * doubled * Math.random();
  return Math.round(doubled - 0.1 * doubled + jitter);
}

class WebSocketClient {
  constructor() {
    this.socket = null;
    this.shouldReconnect = false;
    this.reconnectTimer = null;
    this.connectStartedAt = 0;
    this.reconnectDelay = RECONNECT.baseMs;
    this.currentBaseUrl = '';
    this.config = null;
    this.connectionState = 'disconnected';
    this.connectPromise = null;
    this.initialized = false;
    this.initPromise = null;
    this.isDisconnecting = false;
    this.authRejected = false;
    this.ready = false;
    this.lastError = undefined;
  }

  initialize() {
    if (!this.initialized) {
      this.initPromise = this.initPromise || this.doInitialize();
      return this.initPromise;
    }
    return undefined;
  }

  async doInitialize() {
    try {
      this.config = await loadConnectionConfig();
      const rejected = (
        await chrome.storage.local.get(STORAGE_KEY.rejectedApiKey)
      )[STORAGE_KEY.rejectedApiKey];
      if (rejected && rejected === this.config.apiKey) {
        this.currentBaseUrl = this.config.serverBaseUrl;
        await this.haltForRejectedKey(rejected);
        return;
      }

      const session = await chrome.storage.session.get([
        STORAGE_KEY.shouldReconnect,
        STORAGE_KEY.currentBaseUrl,
      ]);
      const shouldReconnect = session[STORAGE_KEY.shouldReconnect] === true;
      const baseUrl =
        session[STORAGE_KEY.currentBaseUrl] || this.config.serverBaseUrl;
      if ((shouldReconnect || this.config.autoReconnect) && baseUrl && this.config.apiKey) {
        this.shouldReconnect = true;
        await this.connect(baseUrl);
      }
    } finally {
      this.initialized = true;
      this.initPromise = null;
    }
  }

  async connect(baseUrl) {
    if (this.isConnected()) return { success: true };
    if (this.connectionState === 'connecting' && this.connectPromise) {
      return this.connectPromise;
    }
    if (!this.config) this.config = await loadConnectionConfig();
    this.currentBaseUrl = baseUrl || this.config.serverBaseUrl;
    this.config = { ...this.config, serverBaseUrl: this.currentBaseUrl };
    this.shouldReconnect = this.config.autoReconnect !== false;
    this.clearReconnectTimeout();
    if (this.shouldReconnect) await this.armRecovery(this.currentBaseUrl);

    this.connectionState = 'connecting';
    this.connectStartedAt = Date.now();
    this.ready = false;
    this.lastError = undefined;
    broadcastStatus({
      connected: false,
      connecting: true,
      reconnecting: this.shouldReconnect,
      serverBaseUrl: this.currentBaseUrl,
      lastUpdated: Date.now(),
    });

    this.connectPromise = new Promise((resolve) => {
      let settled = false;
      let readyTimer = null;
      const settle = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(readyTimer);
        this.connectPromise = null;
        resolve(result);
      };
      const url = websocketUrl(this.currentBaseUrl);
      let socket;
      try {
        socket = new WebSocket(url, [WS_SUBPROTOCOL]);
      } catch (error) {
        settle({ success: false, error: error.message });
        return;
      }
      this.socket = socket;
      readyTimer = setTimeout(() => {
        this.lastError = '等待 session.ready 超时';
        socket.close();
        settle({ success: false, error: this.lastError });
      }, 15000);

      socket.addEventListener('open', () => {
        if (this.isDisconnecting) {
          socket.close();
          settle({ success: false, error: '连接已取消' });
          return;
        }
        this.send({
          ...envelope(
            MSG.HELLO,
            {
              apiKey: this.config.apiKey,
              extensionId: chrome.runtime.id,
              extensionVersion: chrome.runtime.getManifest().version,
            },
            messageId('hello'),
          ),
        });
      });

      socket.addEventListener('message', (event) => {
        this.handleIncomingMessage(event.data)
          .then((message) => {
            if (message?.type === MSG.READY) {
              if (
                message.payload?.extensionId &&
                message.payload.extensionId !== chrome.runtime.id
              ) {
                this.send(
                  envelope(
                    MSG.IDENTIFY,
                    { extensionId: chrome.runtime.id },
                    messageId('identify'),
                  ),
                );
              }
              this.connectionState = 'connected';
              this.ready = true;
              this.reconnectDelay = RECONNECT.baseMs;
              this.shouldReconnect = this.config.autoReconnect !== false;
              broadcastStatus({
                connected: true,
                reconnecting: false,
                serverBaseUrl: this.currentBaseUrl,
                account: message.payload?.account,
                lastUpdated: Date.now(),
              });
              settle({ success: true });
            }
          })
          .catch(() => {});
      });

      socket.addEventListener('close', (event) => {
        this.socket = null;
        this.ready = false;
        this.connectionState = 'disconnected';
        if (event.code === 1000 || event.code === 1008) {
          this.shouldReconnect = false;
        }
        const reason = event.reason || 'WebSocket 连接已关闭';
        broadcastStatus({
          connected: false,
          reconnecting: this.shouldReconnect,
          serverBaseUrl: this.currentBaseUrl,
          lastError: this.lastError || (event.wasClean ? undefined : reason),
          authRejected: this.authRejected,
          lastUpdated: Date.now(),
        });
        if (!settled) settle({ success: false, error: reason });
        if (this.shouldReconnect && !this.authRejected) {
          this.scheduleReconnect().catch(() => {});
        }
      });

      socket.addEventListener('error', () => {
        this.lastError = 'WebSocket 连接失败';
        broadcastStatus({
          connected: false,
          reconnecting: this.shouldReconnect,
          serverBaseUrl: this.currentBaseUrl,
          lastError: this.lastError,
          lastUpdated: Date.now(),
        });
      });
    });
    return this.connectPromise;
  }

  async disconnect() {
    this.isDisconnecting = true;
    this.shouldReconnect = false;
    this.clearReconnectTimeout();
    await this.disarmRecovery();
    if (this.socket) {
      this.socket.close(1000, 'user disconnect');
      this.socket = null;
    }
    this.connectionState = 'disconnected';
    this.ready = false;
    this.connectPromise = null;
    broadcastStatus({
      connected: false,
      reconnecting: false,
      serverBaseUrl: this.currentBaseUrl,
      lastUpdated: Date.now(),
    });
    this.isDisconnecting = false;
  }

  isConnected() {
    return Boolean(
      this.ready &&
        this.socket &&
        this.socket.readyState === WebSocket.OPEN,
    );
  }

  getShouldReconnect() {
    return this.shouldReconnect;
  }

  getCurrentBaseUrl() {
    return this.currentBaseUrl;
  }

  getAuthState() {
    return { authRejected: this.authRejected, lastError: this.lastError };
  }

  async clearAuthRejection() {
    this.authRejected = false;
    this.lastError = undefined;
    this.reconnectDelay = RECONNECT.baseMs;
    await chrome.storage.local.remove(STORAGE_KEY.rejectedApiKey);
  }

  updateConfig(patch) {
    const previousKey = this.config?.apiKey;
    this.config = {
      serverBaseUrl:
        patch.serverBaseUrl ?? this.config?.serverBaseUrl ?? DEFAULT_CONNECTION.serverBaseUrl,
      autoReconnect:
        patch.autoReconnect ?? this.config?.autoReconnect ?? DEFAULT_CONNECTION.autoReconnect,
      apiKey: patch.apiKey ?? this.config?.apiKey,
    };
    this.shouldReconnect = this.config.autoReconnect;
    if (patch.serverBaseUrl) this.currentBaseUrl = this.config.serverBaseUrl;
    if (patch.apiKey && previousKey && patch.apiKey !== previousKey) {
      void this.clearAuthRejection();
      if (this.socket) {
        this.socket.close(1000, 'credential changed');
        this.socket = null;
      }
      this.ready = false;
      this.connectionState = 'disconnected';
    }
  }

  async haltForRejectedKey(apiKey = this.config?.apiKey) {
    this.shouldReconnect = false;
    this.clearReconnectTimeout();
    this.authRejected = true;
    this.ready = false;
    if (apiKey) {
      await chrome.storage.local.set({ [STORAGE_KEY.rejectedApiKey]: apiKey });
    }
    await this.disarmRecovery();
    if (this.socket) {
      this.socket.close(1008, 'credential rejected');
      this.socket = null;
    }
    this.connectionState = 'disconnected';
    this.connectPromise = null;
    broadcastStatus({
      connected: false,
      reconnecting: false,
      serverBaseUrl: this.currentBaseUrl || this.config?.serverBaseUrl || '',
      lastError: this.lastError,
      authRejected: true,
      lastUpdated: Date.now(),
    });
  }

  async stopTerminal(errorCode, errorMessage) {
    this.shouldReconnect = false;
    this.clearReconnectTimeout();
    await this.disarmRecovery();
    if (this.socket) {
      this.socket.close(1008, errorCode);
      this.socket = null;
    }
    this.connectionState = 'disconnected';
    this.ready = false;
    this.connectPromise = null;
    broadcastStatus({
      connected: false,
      reconnecting: false,
      serverBaseUrl: this.currentBaseUrl || this.config?.serverBaseUrl || '',
      lastError: errorMessage,
      authRejected: false,
      lastUpdated: Date.now(),
    });
  }

  async handleError(payload) {
    this.lastError = payload?.message || '服务器返回错误';
    const code = payload?.code;
    const terminal =
      payload?.retryable === false ||
      TERMINAL_ERROR_CODES.has(code) ||
      this.authRejected;
    if (terminal) {
      if (
        OPEN_PORTAL_ERROR_CODES.has(code) ||
        code === ERROR_CODE.ACCOUNT_DISABLED ||
        this.authRejected
      ) {
        this.authRejected = true;
        await this.haltForRejectedKey();
      } else {
        await this.stopTerminal(code || 'ABM_PROTOCOL_ERROR', this.lastError);
      }
    }
  }

  async armRecovery(baseUrl) {
    await chrome.storage.session.set({
      [STORAGE_KEY.shouldReconnect]: true,
      [STORAGE_KEY.currentBaseUrl]: baseUrl,
    });
    await chrome.alarms.create(RECONNECT.alarmName, {
      periodInMinutes: RECONNECT.alarmPeriodMinutes,
    });
  }

  async disarmRecovery() {
    await chrome.alarms.clear(RECONNECT.alarmName);
    await chrome.storage.session.remove([
      STORAGE_KEY.shouldReconnect,
      STORAGE_KEY.currentBaseUrl,
    ]);
  }

  async scheduleReconnect() {
    if (!this.shouldReconnect || !this.currentBaseUrl || this.authRejected) return;
    this.clearReconnectTimeout();
    await this.armRecovery(this.currentBaseUrl);
    const delay = this.reconnectDelay;
    this.reconnectDelay = nextReconnectDelay(this.reconnectDelay);
    this.reconnectTimer = setTimeout(() => {
      this.connect(this.currentBaseUrl).catch(() => {});
    }, delay);
  }

  clearReconnectTimeout() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  async reconnectIfNeeded() {
    if (this.initPromise) await this.initPromise;
    if (this.authRejected || this.isConnected()) return;
    if (
      this.connectionState === 'connecting' &&
      Date.now() - this.connectStartedAt < RECONNECT.connectingStuckMs
    ) {
      return;
    }
    const session = await chrome.storage.session.get([
      STORAGE_KEY.shouldReconnect,
      STORAGE_KEY.currentBaseUrl,
    ]);
    const baseUrl =
      this.currentBaseUrl ||
      session[STORAGE_KEY.currentBaseUrl] ||
      this.config?.serverBaseUrl;
    if (baseUrl && (this.shouldReconnect || session[STORAGE_KEY.shouldReconnect])) {
      this.shouldReconnect = true;
      await this.connect(baseUrl);
    }
  }

  async handleIncomingMessage(raw) {
    const text =
      typeof raw === 'string'
        ? raw
        : raw instanceof Blob
          ? await raw.text()
          : new TextDecoder().decode(raw);
    const message = parseEnvelope(text);
    if (!message) {
      this.lastError = '服务器协议版本不兼容';
      return null;
    }
    switch (message.type) {
      case MSG.READY:
        return message;
      case MSG.PING:
        this.send(envelope(MSG.PONG));
        return message;
      case MSG.ERROR:
        await this.handleError(message.payload);
        return message;
      case MSG.TOOL_INVOKE:
        await this.handleToolInvoke(message);
        return message;
      case MSG.NOTICE:
        await saveNotice(message.payload);
        await refreshBadge();
        return message;
      default:
        return message;
    }
  }

  async handleToolInvoke(message) {
    const requestId = message.id;
    const name = message.payload?.name;
    const args = message.payload?.arguments || {};
    let response;
    try {
      const result = await executeTool({ name, args });
      const firstError = result.content?.find((item) => item.type === 'error');
      if (result.isError || firstError) {
        response = {
          status: 'error',
          error: {
            code: 'ABM_TOOL_EXECUTION_FAILED',
            message: firstError?.text || 'Tool execution failed',
          },
        };
      } else {
        response = {
          status: 'ok',
          content: (result.content || []).map((item) => ({
            type: 'text',
            text: typeof item.text === 'string' ? item.text : JSON.stringify(item),
          })),
        };
      }
    } catch (error) {
      response = {
        status: 'error',
        error: {
          code: 'ABM_TOOL_EXECUTION_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
    this.send(envelope(MSG.TOOL_RESULT, response, requestId));
  }

  send(message) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
}

export const wsClient = new WebSocketClient();


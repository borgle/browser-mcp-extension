/**
 * 扩展共享常量。所有跨页面、跨进程字符串集中在这里维护。
 */

export const PROTOCOL_VERSION = 'abm/1';
export const WS_SUBPROTOCOL = 'abm.v1';

/** 与服务端 abm/1 WebSocket 信封一致的消息类型 */
export const MSG = Object.freeze({
  HELLO: 'session.hello',
  READY: 'session.ready',
  IDENTIFY: 'session.identify',
  PING: 'session.ping',
  PONG: 'session.pong',
  TOOL_INVOKE: 'tool.invoke',
  TOOL_RESULT: 'tool.result',
  NOTICE: 'notice.push',
  ERROR: 'error',
});

export const ERROR_CODE = Object.freeze({
  PROTOCOL: 'ABM_PROTOCOL_ERROR',
  HELLO_TIMEOUT: 'ABM_HELLO_TIMEOUT',
  DUPLICATE_HELLO: 'ABM_DUPLICATE_HELLO',
  INVALID_API_KEY: 'ABM_INVALID_API_KEY',
  API_KEY_REVOKED: 'ABM_API_KEY_REVOKED',
  ACCOUNT_DISABLED: 'ABM_ACCOUNT_DISABLED',
  CONNECTION_REPLACED: 'ABM_CONNECTION_REPLACED',
  HEARTBEAT_TIMEOUT: 'ABM_HEARTBEAT_TIMEOUT',
  SERVER_SHUTTING_DOWN: 'ABM_SERVER_SHUTTING_DOWN',
  CONNECTION_LIMIT: 'ABM_CONNECTION_LIMIT',
  RATE_LIMITED: 'ABM_RATE_LIMITED',
  INTERNAL: 'ABM_INTERNAL_ERROR',
});

export const TERMINAL_ERROR_CODES = Object.freeze(
  new Set([
    ERROR_CODE.PROTOCOL,
    ERROR_CODE.DUPLICATE_HELLO,
    ERROR_CODE.INVALID_API_KEY,
    ERROR_CODE.API_KEY_REVOKED,
    ERROR_CODE.ACCOUNT_DISABLED,
    ERROR_CODE.CONNECTION_REPLACED,
  ]),
);

export const OPEN_PORTAL_ERROR_CODES = Object.freeze(
  new Set([ERROR_CODE.INVALID_API_KEY, ERROR_CODE.API_KEY_REVOKED]),
);

export const EXECUTION_WORLD = Object.freeze({
  /** 仅用于扩展内部注入桥/视频执行器；browser_inject_script 不接受 ISOLATED 源码串 */
  ISOLATED: 'ISOLATED',
  MAIN: 'MAIN',
});

/** 仅用于扩展自身的 chrome.storage 命名空间 */
export const STORAGE_KEY = Object.freeze({
  connectionConfig: 'abm.connection',
  noticePrefix: 'abm.notice:',
  automationGroupId: 'abm.automationGroupId',
  rejectedApiKey: 'abm.rejectedApiKey',
  shouldReconnect: 'abm.shouldReconnect',
  currentBaseUrl: 'abm.currentBaseUrl',
  allHostsAuthorized: 'abm.allHostsAuthorized',
  authorizedHosts: 'abm.authorizedHosts',
  hostsInitialized: 'abm.hostsInitialized',
  bridgeKey: 'abm.bridgeKey',
  bridgeExtensionId: 'abm.bridgeExtensionId',
  reuseKeys: 'abm.reuseKeys',
});

export const AUTO_GROUP = Object.freeze({
  title: 'abm:browser',
  color: globalThis.chrome?.tabGroups?.Color?.BLUE ?? 'blue',
});

export const ERR = Object.freeze({
  toolFailed: 'Tool execution failed',
  pageLoadTimeout: 'Page load timeout',
  invalidArgs: 'Invalid arguments provided',
});

export const DEFAULT_CONNECTION = Object.freeze({
  serverBaseUrl: 'https://abm.borgle.io',
  autoReconnect: true,
});

export const RECONNECT = Object.freeze({
  baseMs: 5000,
  maxMs: 30000,
  alarmName: 'abm-websocket-reconnect',
  alarmPeriodMinutes: 0.5,
  connectingStuckMs: 45000,
});

export const NOTICE_LIMIT = 20;

export const PROJECT_LINKS = Object.freeze({
  repo: 'https://github.com/borgle/browser-mcp-extension',
  docsPath: 'blob/main/README.md',
  issuesPath: 'issues',
});

export const SERVICE_HOME = 'https://abm.borgle.io';

export const DEFAULT_BRIDGE_KEY_PATTERNS = Object.freeze([
  'http://localhost:*/*',
  'http://127.0.0.1:*/*',
  'https://borgle.io/*',
  'https://*.borgle.io/*',
]);

export const INJECT_MSG = Object.freeze({
  EXECUTE_SCRIPT: 'ABM_EXECUTE_SCRIPT',
  CLEANUP: 'abm:cleanup',
});

export const INJECT_ACTION = Object.freeze({
  EXECUTE_CODE: 'ABM_EXECUTE_CODE',
  INIT_VIDEO_RECEIVER: 'ABM_INIT_VIDEO_RECEIVER',
  VIDEO_CHUNK: 'ABM_VIDEO_CHUNK',
  SET_VIDEO_TO_INPUT: 'ABM_SET_VIDEO_TO_INPUT',
});

export const INJECT_EVENT = Object.freeze({
  EXECUTE: 'abm:execute',
  RESPONSE: 'abm:response',
  CLEANUP: 'abm:cleanup',
});

export const BRIDGE_MSG = Object.freeze({
  CHECK: 'abm.bridge.check',
  CONFIG: 'abm.bridge.config',
  VIDEO_BEGIN: 'abm.video.begin',
  VIDEO_CHUNK: 'abm.video.chunk',
  VIDEO_FINISH: 'abm.video.finish',
  VIDEO_CANCEL: 'abm.video.cancel',
  VIDEO_INFO: 'abm.video.info',
});

export function serverBaseUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const parsed = new URL(value);
  if (parsed.protocol === 'ws:') parsed.protocol = 'http:';
  if (parsed.protocol === 'wss:') parsed.protocol = 'https:';
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('服务器地址必须使用 http://、https://、ws:// 或 wss://');
  }
  return `${parsed.protocol}//${parsed.host}`;
}

export function websocketUrl(baseUrl) {
  const base = serverBaseUrl(baseUrl);
  if (!base) return '';
  const url = new URL('/api/v1/extension/ws', base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export function portalUrl(baseUrl, path = '/') {
  const base = serverBaseUrl(baseUrl) || SERVICE_HOME;
  return new URL(path, base).toString();
}


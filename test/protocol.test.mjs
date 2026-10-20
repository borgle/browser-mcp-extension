const local = new Map();
const session = new Map();
const runtimeMessages = [];

globalThis.chrome = {
  runtime: {
    id: 'test-extension',
    getManifest: () => ({ version: '2.0.0' }),
    sendMessage: async (message) => {
      runtimeMessages.push(message);
    },
    onMessage: { addListener: () => {} },
  },
  storage: {
    local: {
      get: async (key) => (key ? { [key]: local.get(key) } : Object.fromEntries(local)),
      set: async (values) => {
        for (const [key, value] of Object.entries(values)) local.set(key, value);
      },
      remove: async (key) => local.delete(key),
    },
    session: {
      get: async (keys) =>
        Object.fromEntries(keys.map((key) => [key, session.get(key)])),
      set: async (values) => {
        for (const [key, value] of Object.entries(values)) session.set(key, value);
      },
      remove: async (keys) => {
        for (const key of keys) session.delete(key);
      },
    },
  },
  alarms: {
    create: async () => {},
    clear: async () => true,
  },
  action: {
    setBadgeBackgroundColor: async () => {},
    setBadgeText: async () => {},
  },
};

class FakeWebSocket {
  static OPEN = 1;
  static instances = [];

  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.readyState = FakeWebSocket.OPEN;
    this.listeners = new Map();
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  send(value) {
    this.sent.push(JSON.parse(value));
  }

  close(code = 1000, reason = '') {
    this.readyState = 3;
    this.emit('close', { code, reason, wasClean: true });
  }
}

globalThis.WebSocket = FakeWebSocket;

const { wsClient } = await import('../src/core/connection.js');
const {
  MSG,
  PROTOCOL_VERSION,
  STORAGE_KEY,
  WS_SUBPROTOCOL,
  serverBaseUrl,
} = await import('../src/constants.js');

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✔ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${name}${detail ? `：${detail}` : ''}`);
  }
}

wsClient.updateConfig({
  serverBaseUrl: 'http://127.0.0.1:18050',
  apiKey: 'abm_test_key',
  autoReconnect: false,
});
const connected = wsClient.connect('http://127.0.0.1:18050');
const socket = FakeWebSocket.instances[0];
check(
  '连接路径使用 abm/1 子协议',
  socket.url === 'ws://127.0.0.1:18050/api/v1/extension/ws' &&
    socket.protocols[0] === WS_SUBPROTOCOL,
  socket.url,
);
check(
  'wss 完整地址会归一化为 HTTPS 基础地址',
  serverBaseUrl('wss://abm.borgle.io/api/v1/extension/ws') ===
    'https://abm.borgle.io',
);
socket.emit('open');
check(
  '发送 session.hello',
  socket.sent[0]?.v === PROTOCOL_VERSION &&
    socket.sent[0]?.type === MSG.HELLO &&
    socket.sent[0]?.payload?.apiKey === 'abm_test_key',
);

socket.emit('message', {
  data: JSON.stringify({
    v: PROTOCOL_VERSION,
    id: 'ready-1',
    type: MSG.READY,
    payload: {
      protocolVersion: PROTOCOL_VERSION,
      extensionId: 'different-extension',
      account: { id: 'user-1', displayName: 'Test', planCode: 'free' },
    },
  }),
});

await connected;
await new Promise((resolve) => setTimeout(resolve, 0));
check('session.ready 后进入已连接状态', wsClient.isConnected());
check(
  '扩展 ID 不一致时发送 session.identify',
  socket.sent.some(
    (message) =>
      message.type === MSG.IDENTIFY &&
      message.payload?.extensionId === 'test-extension',
  ),
);

socket.emit('message', {
  data: JSON.stringify({
    v: PROTOCOL_VERSION,
    id: 'tool-1',
    type: MSG.TOOL_INVOKE,
    payload: { name: 'unknown_tool', arguments: {} },
  }),
});
await new Promise((resolve) => setTimeout(resolve, 0));
const toolResult = socket.sent.find(
  (message) => message.type === MSG.TOOL_RESULT && message.id === 'tool-1',
);
check(
  '工具调用回执使用同一个信封 id',
  toolResult?.payload?.status === 'error',
  JSON.stringify(toolResult),
);
check(
  '工具结果广播给 popup',
  runtimeMessages.some(
    (message) =>
      message.type === 'ABM_TOOL_RESULT_UPDATE' &&
      message.payload?.name === 'unknown_tool' &&
      message.payload?.status === 'error',
  ),
);

socket.emit('message', {
  data: JSON.stringify({
    v: PROTOCOL_VERSION,
    id: null,
    type: MSG.ERROR,
    payload: {
      code: 'ABM_INVALID_API_KEY',
      message: 'Key 无效',
      retryable: false,
      action: 'open_account_portal',
    },
  }),
});
await new Promise((resolve) => setTimeout(resolve, 0));
check('无效 Key 停止重连', wsClient.getAuthState().authRejected);
check(
  '无效 Key 写入拒绝状态',
  local.get(STORAGE_KEY.rejectedApiKey) === 'abm_test_key',
);

if (failures > 0) {
  console.error(`\n${failures} 项失败。`);
  process.exit(1);
}
console.log('\n协议客户端测试全部通过。');
process.exit(0);

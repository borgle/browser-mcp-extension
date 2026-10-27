globalThis.chrome = {
  runtime: {
    id: 'test-extension',
    getManifest: () => ({
      version: '2.0.0',
      externally_connectable: { matches: ['http://localhost:*/*'] },
    }),
  },
  storage: {
    local: {
      get: async () => ({
        'abm.connection': {
          serverBaseUrl: 'https://abm.borgle.io',
          apiKey: 'abm_test_connection',
          autoReconnect: true,
        },
      }),
      set: async () => {},
    },
  },
};

let tokenRequest = null;
globalThis.fetch = async (url, options) => {
  tokenRequest = { url, options };
  return {
    ok: true,
    status: 200,
    json: async () => ({
      token: 'abm_bridge_test',
      expiresAt: '2026-01-01T00:00:00+00:00',
    }),
  };
};

const { handleExternalMessage } = await import('../src/video/receiver.js');
const { getStoredVideo } = await import('../src/video/store.js');
const { BRIDGE_MSG } = await import('../src/constants.js');

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✔ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${name}${detail ? `：${detail}` : ''}`);
  }
}

const sender = { origin: 'http://localhost:3000' };
const sessionId = 'video_test_1';
const original = 'ABCDEF';
const base64 = Buffer.from(original).toString('base64');

const extensionConfig = await handleExternalMessage({ type: BRIDGE_MSG.CONFIG }, sender);
check(
  '受信桥页面自动获取短期 bridge token',
  extensionConfig.ok === true &&
    extensionConfig.extensionId === 'test-extension' &&
    extensionConfig.bridgeToken === 'abm_bridge_test' &&
    !('apiKey' in extensionConfig),
  JSON.stringify(extensionConfig),
);
check(
  'bridge token 由扩展用 API Key 向服务端换取',
  tokenRequest?.url === 'https://abm.borgle.io/api/v1/video/bridge-token' &&
    tokenRequest?.options?.headers?.Authorization === 'Bearer abm_test_connection',
  JSON.stringify(tokenRequest),
);

const started = await handleExternalMessage(
  {
    type: BRIDGE_MSG.VIDEO_BEGIN,
    payload: {
      sessionId,
      fileName: 'demo.mp4',
      fileType: 'video/mp4',
      fileSize: original.length,
      totalChunks: 1,
    },
  },
  sender,
);
check('视频会话开始', started.ok === true, JSON.stringify(started));

const chunk = await handleExternalMessage(
  {
    type: BRIDGE_MSG.VIDEO_CHUNK,
    payload: { sessionId, index: 0, base64 },
  },
  sender,
);
check(
  'base64 分片解码为真实字节',
  chunk.ok === true && chunk.receivedSize === original.length,
  JSON.stringify(chunk),
);

const completed = await handleExternalMessage(
  { type: BRIDGE_MSG.VIDEO_FINISH, payload: { sessionId } },
  sender,
);
check('视频会话完成', completed.ok === true, JSON.stringify(completed));
check('暂存区写入了视频', Boolean(getStoredVideo()));
check(
  '暂存字节与原文一致',
  getStoredVideo() && Buffer.from(getStoredVideo().data).toString() === original,
);

const duplicatePayload = {
  sessionId: 'video_test_2',
  fileName: 'x.mp4',
  fileType: 'video/mp4',
  fileSize: 1,
  totalChunks: 1,
};
check(
  '重复会话被拒绝',
  (await handleExternalMessage({ type: BRIDGE_MSG.VIDEO_BEGIN, payload: duplicatePayload }, sender))
    .ok &&
    !(
      await handleExternalMessage(
        { type: BRIDGE_MSG.VIDEO_BEGIN, payload: duplicatePayload },
        sender,
      )
    ).ok,
);
check(
  '未知会话分片被拒绝',
  !(
    await handleExternalMessage(
      { type: BRIDGE_MSG.VIDEO_CHUNK, payload: { sessionId: 'missing', index: 0, base64 } },
      sender,
    )
  ).ok,
);
check(
  '未受信来源被拒绝',
  !(
    await handleExternalMessage(
      { type: BRIDGE_MSG.CHECK },
      { origin: 'https://evil.example' },
    )
  ).ok,
);
check(
  '未知消息有明确错误',
  (await handleExternalMessage({ type: 'unknown.message' }, sender)).error ===
    '未知外部消息类型',
);

if (failures > 0) {
  console.error(`\n${failures} 项失败。`);
  process.exit(1);
}
console.log('\n视频桥测试全部通过。');
process.exit(0);


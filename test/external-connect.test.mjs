/**
 * 一键连接契约：控制台通过受信外部消息写入连接配置并触发连接。
 * 运行：node test/external-connect.test.mjs
 */
import { EXTERNAL_MSG } from '../src/constants.js';
import { configureFromExternal } from '../src/core/external.js';
import { POPUP_MSG } from '../src/message-types.js';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✔ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${name}${detail ? `: ${detail}` : ''}`);
  }
}

console.log('一键连接');

const calls = [];
const handler = async (message) => {
  calls.push(message);
  return { success: true };
};
const result = await configureFromExternal(
  {
    type: EXTERNAL_MSG.CONFIGURE,
    payload: {
      serverBaseUrl: 'https://abm.example.com',
      apiKey: 'abm_test_key',
    },
  },
  handler,
);
check('返回连接成功', result.ok === true && result.connected === true);
check(
  '先保存再连接',
  calls[0]?.type === POPUP_MSG.SAVE_CONFIG &&
    calls[1]?.type === POPUP_MSG.CONNECT &&
    calls[0]?.payload?.serverBaseUrl === 'https://abm.example.com' &&
    calls[0]?.payload?.apiKey === 'abm_test_key',
  JSON.stringify(calls),
);

const missing = await configureFromExternal(
  { type: EXTERNAL_MSG.CONFIGURE, payload: { serverBaseUrl: 'https://abm.example.com' } },
  handler,
);
check('缺少 API Key 被拒绝', missing.ok === false);

const saveFailed = await configureFromExternal(
  {
    type: EXTERNAL_MSG.CONFIGURE,
    payload: { serverBaseUrl: 'https://abm.example.com', apiKey: 'abm_test_key' },
  },
  async () => ({ success: false, error: 'save failed' }),
);
check('保存失败被透传', saveFailed.ok === false && saveFailed.error === 'save failed');

const connectFailed = await configureFromExternal(
  {
    type: EXTERNAL_MSG.CONFIGURE,
    payload: { serverBaseUrl: 'https://abm.example.com', apiKey: 'abm_test_key' },
  },
  async (message) =>
    message.type === POPUP_MSG.SAVE_CONFIG
      ? { success: true }
      : { success: false, error: 'connect failed' },
);
check(
  '连接失败被透传',
  connectFailed.ok === false && connectFailed.error === 'connect failed',
);

if (failures > 0) {
  console.error(`\n${failures} 项失败。`);
  process.exit(1);
}
console.log('\n全部通过。');
process.exit(0);

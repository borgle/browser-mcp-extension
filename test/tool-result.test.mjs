/**
 * popup 工具结果广播测试。
 *
 * 运行：node test/tool-result.test.mjs
 */
const sent = [];

globalThis.chrome = {
  runtime: {
    sendMessage: async (message) => {
      sent.push(message);
    },
  },
};

const {
  broadcastToolResult,
  summarizeToolResult,
  TOOL_RESULT_TEXT_LIMIT,
} = await import('../src/core/tool-result.js');

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✔ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('成功结果摘要');
const ok = summarizeToolResult({
  requestId: 'req-1',
  name: 'browser_click',
  response: {
    status: 'ok',
    content: [{ type: 'text', text: '{"success":true}' }],
  },
  durationMs: 12.6,
});
check('保留请求和工具名', ok.requestId === 'req-1' && ok.name === 'browser_click');
check('状态为 ok', ok.status === 'ok');
check('耗时四舍五入', ok.durationMs === 13, String(ok.durationMs));
check('提取文本内容', ok.text === '{"success":true}');
check('未截断', ok.truncated === false);
check('带时间戳', typeof ok.at === 'number');

console.log('\n错误结果摘要');
const error = summarizeToolResult({
  requestId: 'req-2',
  name: 'browser_click',
  response: {
    status: 'error',
    error: { code: 'ABM_TOOL_EXECUTION_FAILED', message: '元素未找到' },
  },
  durationMs: 4,
});
check('状态为 error', error.status === 'error');
check('保留错误信息', error.error?.message === '元素未找到');
check('错误结果不携带 text', !('text' in error));

console.log('\n长结果截断');
const long = summarizeToolResult({
  name: 'browser_read_page_data',
  response: {
    status: 'ok',
    content: [{ type: 'text', text: 'x'.repeat(TOOL_RESULT_TEXT_LIMIT + 1) }],
  },
});
check('标记截断', long.truncated === true);
check('文本以截断提示结尾', long.text.endsWith('…（已截断）'));
check('截断后长度受控', long.text.length < TOOL_RESULT_TEXT_LIMIT + 20);

console.log('\n非字符串 content');
const mixed = summarizeToolResult({
  name: 'browser_extract_data',
  response: {
    status: 'ok',
    content: [{ type: 'text', text: 'ok' }, { value: 1 }],
  },
});
check('对象内容可序列化', mixed.text === 'ok\n{"value":1}', mixed.text);

console.log('\n广播消息');
const payload = broadcastToolResult({
  requestId: 'req-3',
  name: 'browser_navigate',
  response: {
    status: 'ok',
    content: [{ type: 'text', text: 'done' }],
  },
  durationMs: 5,
});
await Promise.resolve();
check('返回摘要给调用方', payload.name === 'browser_navigate');
check('发送了一条消息', sent.length === 1, String(sent.length));
check('消息类型正确', sent[0]?.type === 'ABM_TOOL_RESULT_UPDATE');
check('消息携带摘要', sent[0]?.payload?.text === 'done');

if (failures > 0) {
  console.error(`\n${failures} 项失败。`);
  process.exit(1);
}
console.log('\n工具结果广播测试全部通过。');
process.exit(0);

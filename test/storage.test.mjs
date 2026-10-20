/**
 * 连接配置存取测试。
 *
 * 只验证真实行为：读取时归一化服务端地址并回写，未配置时写入默认值。
 *
 * 运行：node test/storage.test.mjs
 */
const storage = new Map([
  [
    'abm.connection',
    {
      serverBaseUrl: 'wss://abm.example.com/ws',
      apiKey: 'abm_test_key',
      autoReconnect: false,
    },
  ],
]);

globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => ({ [key]: storage.get(key) }),
      set: async (values) => {
        for (const [name, value] of Object.entries(values)) storage.set(name, value);
      },
    },
  },
};

const { loadConnectionConfig } = await import('../src/core/storage.js');

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✔ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('已有配置');
const config = await loadConnectionConfig();
check('wss 归一化为 https 基础地址', config.serverBaseUrl === 'https://abm.example.com', config.serverBaseUrl);
check('保留 API Key', config.apiKey === 'abm_test_key');
check('保留用户设置', config.autoReconnect === false);
check(
  '归一化结果已回写',
  storage.get('abm.connection').serverBaseUrl === 'https://abm.example.com',
  storage.get('abm.connection').serverBaseUrl,
);

console.log('\n首次使用');
storage.delete('abm.connection');
const initial = await loadConnectionConfig();
check('返回默认服务端地址', initial.serverBaseUrl === 'https://abm.borgle.io', initial.serverBaseUrl);
check('默认自动重连开启', initial.autoReconnect === true);
check('默认配置已持久化', storage.get('abm.connection')?.serverBaseUrl === 'https://abm.borgle.io');

if (failures > 0) {
  console.error(`\n${failures} 项失败。`);
  process.exit(1);
}
console.log('\n连接配置存取全部通过。');
process.exit(0);

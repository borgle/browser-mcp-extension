const storage = new Map([
  [
    'abm.authorizedHosts',
    ['localhost', 'klingai.com'],
  ],
]);
const granted = new Set([
  'https://*.example.com/*',
  'http://*.example.com/*',
  'https://example.com/*',
  'http://example.com/*',
  'https://*.zhihu.com/*',
]);

globalThis.chrome = {
  runtime: {
    getManifest: () => ({ host_permissions: ['https://*.zhihu.com/*'] }),
  },
  storage: {
    local: {
      get: async (key) => ({ [key]: storage.get(key) }),
      set: async (values) => {
        for (const [name, value] of Object.entries(values)) storage.set(name, value);
      },
    },
  },
  permissions: {
    remove: async ({ origins }) => {
      for (const origin of origins) granted.delete(origin);
      return true;
    },
    getAll: async () => ({ origins: [...granted] }),
  },
};

const {
  getAuthorizedHosts,
  hostPatternOf,
  removeHostPermission,
} = await import('../src/permissions/manager.js');

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✔ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${name}${detail ? `：${detail}` : ''}`);
  }
}

const initial = await getAuthorizedHosts();
check('本机内置域名不进入可撤销列表', !initial.includes('localhost'), JSON.stringify(initial));
check(
  '已授权但没记账的域名会补回列表',
  initial.includes('example.com'),
  JSON.stringify(initial),
);
check('storage 里的额外域名保留', initial.includes('klingai.com'), JSON.stringify(initial));
check(
  'manifest 静态授权不进入可撤销列表',
  !initial.includes('zhihu.com'),
  JSON.stringify(initial),
);
check(
  '补回的域名已写回 storage',
  JSON.stringify(storage.get('abm.authorizedHosts')) ===
    JSON.stringify(['example.com', 'klingai.com']),
  JSON.stringify(storage.get('abm.authorizedHosts')),
);

check('删除额外域名成功', await removeHostPermission('example.com'));
check(
  '删除后只移除目标域名',
  JSON.stringify(storage.get('abm.authorizedHosts')) === JSON.stringify(['klingai.com']),
  JSON.stringify(storage.get('abm.authorizedHosts')),
);
check(
  '删除后不会重新出现在列表',
  !(await getAuthorizedHosts()).includes('example.com'),
  JSON.stringify(await getAuthorizedHosts()),
);
check(
  '浏览器权限已撤销',
  [...granted].every((origin) => origin.includes('zhihu.com')),
  JSON.stringify([...granted]),
);
check(
  'URL 含端口时 match pattern 去掉端口',
  hostPatternOf('http://127.0.0.1:18050/files/a.png') === 'http://127.0.0.1/*',
  hostPatternOf('http://127.0.0.1:18050/files/a.png'),
);

if (failures > 0) {
  console.error(`\n${failures} 项权限测试失败。`);
  process.exit(1);
}
console.log('\n下载权限测试全部通过。');

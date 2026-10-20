import {
  BUILT_IN_HOSTS,
  LOCAL_HOSTS,
  hostPatternsOf,
  parseHostInput,
} from '../src/permissions/host-input.js';

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✔ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${name}${detail ? `：${detail}` : ''}`);
  }
}

function hostOf(input) {
  return parseHostInput(input).host;
}

function errorOf(input) {
  return parseHostInput(input).error;
}

// ---------------------------------------------------------------- 可接受的输入
check('纯域名', hostOf('example.com') === 'example.com');
check('去协议、路径、查询串', hostOf('https://Example.COM/path?a=1#x') === 'example.com');
check('去通配前缀', hostOf('*.example.com') === 'example.com');
check('去端口', hostOf('example.com:8080') === 'example.com');
check('协议 + 端口 + 路径', hostOf('http://example.com:8080/a/b') === 'example.com');
check('去末尾点', hostOf('example.com.') === 'example.com');
check('多级域名', hostOf('cdn.sub.example.co.uk') === 'cdn.sub.example.co.uk');
check('单标签域名', hostOf('intranet') === 'intranet');
check('IPv4', hostOf('192.168.1.10') === '192.168.1.10');
check('IPv4 带协议', hostOf('http://192.168.1.10/x') === '192.168.1.10');

// ---------------------------------------------------------------- 应拒绝的输入
check('空输入', !!errorOf(''));
check('只有空白', !!errorOf('   '));
check('只有协议', !!errorOf('https://'));
check('含空格', !!errorOf('foo bar'));
check('含下划线', !!errorOf('foo_bar.com'));
check('标签以连字符开头', !!errorOf('-foo.com'));
check('标签以连字符结尾', !!errorOf('foo-.com'));
check('连续点', !!errorOf('foo..bar'));
check('前导点', !!errorOf('.foo.com'));
check('算术 IP 段', !!errorOf('1.2.3'));
check('IP 段超范围', !!errorOf('256.1.1.1'));
check('IPv6', !!errorOf('[::1]'));
check('带用户信息', !!errorOf('user:pass@example.com'));
check('中文域名（需 punycode）', !!errorOf('例子.com'));
check('本机地址已内置', errorOf('localhost').includes('内置'));
check('本机 IPv4 已内置', errorOf('127.0.0.1').includes('内置'));
check(
  '原默认 CDN 可自行添加',
  ['klingai.com', 'aliyuncs.com', 'myqcloud.com'].every((host) => hostOf(host) === host),
);

// ---------------------------------------------------------------- 内置清单
check(
  '内置清单只包含本机地址',
  BUILT_IN_HOSTS.length === LOCAL_HOSTS.length &&
    LOCAL_HOSTS.every((host) => BUILT_IN_HOSTS.includes(host)),
  JSON.stringify(BUILT_IN_HOSTS),
);
check(
  '下载 CDN 不再内置',
  !BUILT_IN_HOSTS.includes('klingai.com') &&
    !BUILT_IN_HOSTS.includes('aliyuncs.com') &&
    !BUILT_IN_HOSTS.includes('myqcloud.com'),
  JSON.stringify(BUILT_IN_HOSTS),
);
check('内置清单无重复', new Set(BUILT_IN_HOSTS).size === BUILT_IN_HOSTS.length);

// ---------------------------------------------------------------- match pattern
const domainPatterns = hostPatternsOf('example.com');
check('域名展开 4 条 pattern', domainPatterns.length === 4, JSON.stringify(domainPatterns));
check(
  'pattern 覆盖 http/https 与子域',
  ['https://example.com/*', 'http://example.com/*', 'https://*.example.com/*', 'http://*.example.com/*'].every(
    (pattern) => domainPatterns.includes(pattern),
  ),
  JSON.stringify(domainPatterns),
);

const ipPatterns = hostPatternsOf('192.168.1.10');
check('IPv4 只展开精确 pattern', ipPatterns.length === 2, JSON.stringify(ipPatterns));
check(
  'IPv4 不含通配子域',
  ipPatterns.every((pattern) => !pattern.includes('*.')),
  JSON.stringify(ipPatterns),
);

if (failures > 0) {
  console.error(`\n${failures} 项域名输入测试失败。`);
  process.exit(1);
}
console.log('\n域名输入测试全部通过。');

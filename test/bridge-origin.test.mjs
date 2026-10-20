/**
 * 视频桥可信来源判定测试。
 *
 * 规则是以 manifest 的 externally_connectable.matches 为准（唯一事实来源），
 * 这里用真实的 match pattern 形态覆盖本机 / 官方域名 / 无关站点 / 端口与协议差异。
 *
 * 运行：node test/bridge-origin.test.mjs
 */
import { matchesOrigin } from '../src/video/receiver.js';
import { DEFAULT_BRIDGE_KEY_PATTERNS } from '../src/constants.js';

let failures = 0;
function check(name, condition) {
  if (condition) {
    console.log(`  ✔ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${name}`);
  }
}

// 与 manifest.json 的 externally_connectable.matches 保持一致
const SHIPPED = ['https://*.borgle.io/*', 'https://borgle.io/*', 'http://localhost:*/*', 'http://127.0.0.1:*/*'];

console.log('生产 manifest（本机 + 官方域名）');
check('本机 127.0.0.1 任意端口', matchesOrigin('http://127.0.0.1:18050', SHIPPED));
check('本机 localhost 带端口', matchesOrigin('http://localhost:18050', SHIPPED));
check('本机 localhost 无端口', matchesOrigin('http://localhost', SHIPPED));
check('官方子域（生产桥页面）', matchesOrigin('https://abm.borgle.io', SHIPPED));
check('官方主域', matchesOrigin('https://borgle.io', SHIPPED));
check('官方多级子域', matchesOrigin('https://a.b.borgle.io', SHIPPED));
check('无关站点不通过', !matchesOrigin('https://evil.com', SHIPPED));
check('仿冒域名不通过（borgle.io.evil.com）', !matchesOrigin('https://borgle.io.evil.com', SHIPPED));
check('仿冒域名不通过（notborgle.io）', !matchesOrigin('https://notborgle.io', SHIPPED));
check('本机 https 不通过（manifest 只放行 http）', !matchesOrigin('https://127.0.0.1:18050', SHIPPED));
check('file:// 不通过', !matchesOrigin('file:///C:/x.html', SHIPPED));
check('扩展自己的页面不通过', !matchesOrigin('chrome-extension://abcdefghijklmnop', SHIPPED));

console.log('\n兜底列表（manifest 缺失或被放宽到全部站点时）');
check('兜底仍放行本机', matchesOrigin('http://127.0.0.1:18050', DEFAULT_BRIDGE_KEY_PATTERNS));
check('兜底仍放行官方域名', matchesOrigin('https://abm.borgle.io', DEFAULT_BRIDGE_KEY_PATTERNS));
check('兜底不放行任意站点', !matchesOrigin('https://evil.com', DEFAULT_BRIDGE_KEY_PATTERNS));

if (failures > 0) {
  console.error(`\n${failures} 项失败。`);
  process.exit(1);
}
console.log('\n桥来源判定全部通过。');
process.exit(0);

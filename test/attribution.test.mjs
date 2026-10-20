import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const popup = fs.readFileSync(path.join(root, 'popup', 'popup.html'), 'utf8');

let failures = 0;
function check(name, condition) {
  if (condition) {
    console.log(`  ✔ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${name}`);
  }
}

check('ABM 全称已定义', readme.includes('ABM 是 **a browser mcp** 的简称'));
check(
  'README 包含 X-MCP 鸣谢',
  readme.includes('https://github.com/xpzouying/x-mcp') &&
    readme.includes('xpzouying'),
);
check(
  '关于页不展示开源鸣谢入口',
  !popup.includes('link-upstream') && !popup.includes('开源鸣谢'),
);

if (failures > 0) {
  console.error(`\n${failures} 项失败。`);
  process.exit(1);
}
console.log('\n品牌与鸣谢检查通过。');


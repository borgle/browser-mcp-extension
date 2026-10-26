/**
 * 工具错误语言契约：MCP 返回的工具错误使用英文规范文案，注释不计入。
 * 运行：node test/tool-errors-language.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = fs
  .readdirSync(path.join(root, 'src/tools'))
  .filter((name) => name.endsWith('.js'))
  .map((name) => `src/tools/${name}`);

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✔ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${name}${detail ? `: ${detail}` : ''}`);
  }
}

console.log('工具错误语言');

for (const file of files) {
  const source = fs
    .readFileSync(path.join(root, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const match = source.match(/[\u4e00-\u9fff]+/);
  check(`${file} 无非注释中文`, !match, match?.[0] || '');
}

if (failures > 0) {
  console.error(`\n${failures} 项失败。`);
  process.exit(1);
}
console.log('\n全部通过。');

/**
 * 发布工作流契约：Release notes 列出提交 message 和提交者。
 *
 * 运行：node test/release-workflow.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = fs.readFileSync(
  path.join(root, '.github', 'workflows', 'release.yml'),
  'utf8',
);

let failures = 0;
function check(name, condition) {
  if (condition) {
    console.log(`  ✔ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${name}`);
  }
}

check('发布会获取完整 git 历史与标签', workflow.includes('fetch-depth: 0'));
check('Release notes 使用生成文件', workflow.includes('--notes-file'));
check('不再使用 --generate-notes 默认说明', !workflow.includes('--generate-notes'));
check('Release notes 包含提交清单', workflow.includes('## Changes'));
check('Release notes 包含提交者清单', workflow.includes('## Contributors'));
check('提交清单列出作者', workflow.includes('%an'));
check('提交范围从上一个版本标签开始', workflow.includes('git describe --tags'));

if (failures > 0) {
  console.error(`\n${failures} 项失败。`);
  process.exit(1);
}
console.log('\n发布工作流检查通过。');

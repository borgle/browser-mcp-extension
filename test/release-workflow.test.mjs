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
check('Release notes 由脚本按提交类型分组生成', workflow.includes('scripts/release-notes.mjs'));
check('Release notes 支持人工文件覆盖', workflow.includes('.github/release-notes/') && workflow.includes('manual_notes'));
check('Release notes 通过 GitHub API 读取提交与作者', workflow.includes('gh api'));
check('Release notes 传入上一个版本标签', workflow.includes('--previous-tag'));
check('提交范围从上一个版本标签开始', workflow.includes('git describe --tags'));

if (failures > 0) {
  console.error(`\n${failures} 项失败。`);
  process.exit(1);
}
console.log('\n发布工作流检查通过。');

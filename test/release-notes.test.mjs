/**
 * Release notes 生成契约：按提交类型分组、列出提交者、过滤合并与版本提交。
 *
 * 运行：node test/release-notes.test.mjs
 */
import { generateReleaseNotes, readCommitPayload } from '../scripts/release-notes.mjs';

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✔ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function commit(sha, message, login, date, parents = [{}]) {
  return {
    sha: sha.padEnd(40, '0'),
    commit: { message, author: { name: login, date } },
    author: { login },
    parents,
  };
}

const notes = generateReleaseNotes({
  commits: [
    commit('aaaaaaa', 'chore: release v1.2.3', 'bot', '2026-01-01T00:00:00Z'),
    commit('bbbbbbb', 'feat(popup): inline connection editing', 'alice', '2026-01-02T00:00:00Z'),
    commit('ccccccc', 'fix: handle empty input', 'bob', '2026-01-03T00:00:00Z'),
    commit('ddddddd', 'docs: update release guide', 'alice', '2026-01-04T00:00:00Z'),
    commit('eeeeeee', 'perf: reduce startup time', 'bob', '2026-01-05T00:00:00Z'),
    commit('fffffff', 'chore: tidy repository', 'bob', '2026-01-06T00:00:00Z'),
    commit('ggggggg', 'Merge branch feature', 'bob', '2026-01-07T00:00:00Z', [{}, {}]),
  ],
  repository: 'owner/repo',
  tag: 'v1.2.3',
  previousTag: 'v1.2.2',
});

console.log('分组');
check('包含新增功能分组', notes.includes('### 新增功能 / New Features'));
check('包含问题修复分组', notes.includes('### 问题修复 / Bug Fixes'));
check('包含体验优化分组', notes.includes('### 体验优化 / Improvements'));
check('包含文档分组', notes.includes('### 文档 / Documentation'));
check('包含其他变更分组', notes.includes('### 其他变更 / Other Changes'));
check(
  '新增功能排在问题修复之前',
  notes.indexOf('### 新增功能 / New Features') < notes.indexOf('### 问题修复 / Bug Fixes'),
);

console.log('\n内容');
check('列出提交 message', notes.includes('feat(popup): inline connection editing'));
check('列出提交者', notes.includes('by @alice') && notes.includes('by @bob'));
check('包含提交链接', notes.includes('https://github.com/owner/repo/commit/'));
check('包含 Full Changelog', notes.includes('Full Changelog: [v1.2.2...v1.2.3](https://github.com/owner/repo/compare/v1.2.2...v1.2.3)'));
check('过滤版本提交', !notes.includes('chore: release v1.2.3'));
check('过滤合并提交', !notes.includes('Merge branch feature'));
check('未分类提交归入其他变更', notes.includes('chore: tidy repository'));

console.log('\n输入解析');
check('支持 compare 响应', readCommitPayload({ commits: [1] }).length === 1);
check('支持 commits 数组', readCommitPayload([1, 2]).length === 2);
const unknownAuthor = commit('hhhhhhh', 'fix: no author', 'someone', '2026-01-01T00:00:00Z');
unknownAuthor.author = undefined;
unknownAuthor.commit.author = { date: unknownAuthor.commit.author.date };
check(
  '未知作者回退到 unknown',
  generateReleaseNotes({
    commits: [unknownAuthor],
    repository: 'owner/repo',
    tag: 'v1.2.3',
  }).includes('by @unknown'),
);

if (failures > 0) {
  console.error(`\n${failures} 项失败。`);
  process.exit(1);
}
console.log('\nRelease notes 生成检查通过。');

#!/usr/bin/env node
/**
 * 根据 GitHub commits JSON 生成 Release notes。
 *
 * 输入为 GitHub compare 接口（`{ commits: [...] }`）或 commits 列表接口
 * （`[...]`）返回的 JSON，输出按 Conventional Commits 类型分组的 Markdown。
 *
 * 用法：
 *   node scripts/release-notes.mjs --input commits.json \
 *     --repository owner/repo --tag v1.2.3 [--previous-tag v1.2.2] > notes.md
 *
 * 也支持从 stdin 读取：
 *   cat commits.json | node scripts/release-notes.mjs --input - ...
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SECTIONS = [
  { id: 'features', title: '### 新增功能 / New Features' },
  { id: 'fixes', title: '### 问题修复 / Bug Fixes' },
  { id: 'improvements', title: '### 体验优化 / Improvements' },
  { id: 'docs', title: '### 文档 / Documentation' },
  { id: 'other', title: '### 其他变更 / Other Changes' },
];

const SECTION_BY_TYPE = new Map([
  ['feat', 'features'],
  ['fix', 'fixes'],
  ['perf', 'improvements'],
  ['refactor', 'improvements'],
  ['docs', 'docs'],
]);

const VERSION_BUMP_PATTERN = /^(chore|build|ci)(?:\([^)]*\))?:\s*(?:release|bump)\b/i;

export function parseCommit(commit) {
  const message = commit?.commit?.message ?? '';
  const subject = message.split('\n', 1)[0].trim();
  const match = /^([a-z]+)(?:\([^)]*\))?!?:\s*/i.exec(subject);
  return {
    sha: commit?.sha ?? '',
    subject,
    login: commit?.author?.login ?? commit?.committer?.login ?? commit?.commit?.author?.name ?? 'unknown',
    date: commit?.commit?.committer?.date ?? commit?.commit?.author?.date ?? '',
    type: match ? match[1].toLowerCase() : 'other',
    parents: Array.isArray(commit?.parents) ? commit.parents : [],
  };
}

export function generateReleaseNotes({ commits, repository, tag, previousTag = '' }) {
  const parsed = commits
    .map(parseCommit)
    .filter((commit) => commit.parents.length <= 1 && !VERSION_BUMP_PATTERN.test(commit.subject))
    .map((commit, index) => ({ ...commit, index }))
    .sort((a, b) => {
      if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.index - b.index;
    });

  const grouped = new Map(SECTIONS.map((section) => [section.id, []]));
  for (const commit of parsed) {
    grouped.get(SECTION_BY_TYPE.get(commit.type) ?? 'other').push(commit);
  }

  const lines = [];
  for (const section of SECTIONS) {
    const items = grouped.get(section.id);
    if (items.length === 0) continue;
    lines.push(section.title, '');
    for (const commit of items) {
      const shortSha = commit.sha.slice(0, 7);
      lines.push(
        `- ${commit.subject} ([\`${shortSha}\`](https://github.com/${repository}/commit/${commit.sha})) by @${commit.login}`,
      );
    }
    lines.push('');
  }

  if (previousTag) {
    lines.push(
      `Full Changelog: [${previousTag}...${tag}](https://github.com/${repository}/compare/${previousTag}...${tag})`,
      '',
    );
  }

  if (lines.length === 0) {
    lines.push('No notable changes.', '');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export function readCommitPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.commits)) return payload.commits;
  throw new Error('Unsupported commits payload: expected an array or { commits: [] }');
}

function parseArgs(argv) {
  const args = {
    input: '-',
    repository: process.env.GITHUB_REPOSITORY,
    tag: process.env.GITHUB_REF_NAME,
    previousTag: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') args.input = argv[++i];
    else if (arg === '--repository') args.repository = argv[++i];
    else if (arg === '--tag') args.tag = argv[++i];
    else if (arg === '--previous-tag') args.previousTag = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.repository || !args.tag) {
    throw new Error('--repository and --tag are required (or set GITHUB_REPOSITORY and GITHUB_REF_NAME)');
  }
  const raw = args.input === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(args.input, 'utf8');
  const commits = readCommitPayload(JSON.parse(raw.replace(/^\uFEFF/, '')));
  process.stdout.write(
    generateReleaseNotes({
      commits,
      repository: args.repository,
      tag: args.tag,
      previousTag: args.previousTag,
    }),
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();

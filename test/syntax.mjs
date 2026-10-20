/**
 * 语法自检：对 src / popup / inject-scripts / test 下所有 JS 跑一遍 `node --check`，
 * 另外校验 manifest.json 是合法 JSON。
 *
 * 运行：node test/syntax.mjs
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['src', 'popup', 'inject-scripts', 'test', 'tools'];

async function collect(dir) {
  const entries = await fs.readdir(path.join(root, dir), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(relative)));
    else if (/\.(js|mjs)$/.test(entry.name)) files.push(relative);
  }
  return files;
}

let failures = 0;
const files = (await Promise.all(SCAN_DIRS.map(collect))).flat().sort();

for (const file of files) {
  try {
    await run(process.execPath, ['--check', path.join(root, file)]);
    console.log(`  ✔ ${file}`);
  } catch (err) {
    failures += 1;
    console.error(`  ✘ ${file}\n${err.stderr || err.message}`);
  }
}

try {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  const problems = [];
  if (manifest.manifest_version !== 3) problems.push('manifest_version 必须是 3');
  if (manifest.background?.type !== 'module') problems.push('background 需要 "type": "module"');
  if (!manifest.background?.service_worker) problems.push('缺少 background.service_worker');
  if (!manifest.action?.default_popup) problems.push('缺少 action.default_popup');
  // 引用的文件必须真实存在
  const referenced = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    ...Object.values(manifest.icons || {}),
  ].filter(Boolean);
  for (const file of referenced) {
    try {
      await fs.access(path.join(root, file));
    } catch {
      problems.push(`manifest 引用的文件不存在: ${file}`);
    }
  }
  if (problems.length) {
    failures += 1;
    console.error(`  ✘ manifest.json：${problems.join('；')}`);
  } else {
    console.log(`  ✔ manifest.json（${manifest.name} v${manifest.version}，${referenced.length} 个引用文件）`);
  }
} catch (err) {
  failures += 1;
  console.error(`  ✘ manifest.json 解析失败：${err.message}`);
}

if (failures > 0) {
  console.error(`\n${failures} 项失败。`);
  process.exit(1);
}
console.log(`\n${files.length} 个 JS 文件 + manifest.json 全部通过。`);

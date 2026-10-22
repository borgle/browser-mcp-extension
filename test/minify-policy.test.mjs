import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MINIFY_EXCLUDED_FILES,
  normalizePackagePath,
  shouldMinifyFile,
} from '../scripts/minify-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(root, 'src');

function listJavaScriptFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJavaScriptFiles(filePath));
    } else if (entry.name.endsWith('.js')) {
      files.push(filePath);
    }
  }
  return files;
}

const serializationMarkers = [
  ['executeInTab(', 'chrome.scripting.executeScript({ func })'],
  [/func\s*:/, 'chrome.scripting.executeScript({ func })'],
  ['toInjectableSource(', 'toInjectableSource()'],
  ['input.toString()', 'toInjectableSource()'],
];

let failures = 0;
function check(name, passed) {
  if (passed) {
    console.log(`  ✔ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${name}`);
  }
}

for (const filePath of listJavaScriptFiles(srcRoot)) {
  const source = fs.readFileSync(filePath, 'utf8');
  const relativePath = normalizePackagePath(path.relative(root, filePath));
  const reasons = [
    ...new Set(
      serializationMarkers
        .filter(([marker]) => (marker instanceof RegExp ? marker.test(source) : source.includes(marker)))
        .map(([, reason]) => reason),
    ),
  ];
  if (reasons.length > 0) {
    check(
      `${relativePath} 使用 ${reasons.join('、')} 时必须排除压缩`,
      !shouldMinifyFile(relativePath),
    );
  }
}

for (const relativePath of MINIFY_EXCLUDED_FILES) {
  check(`${relativePath} 存在`, fs.existsSync(path.join(root, relativePath)));
}

check('普通核心模块仍然压缩', shouldMinifyFile('src/core/connection.js'));
check('popup 仍然压缩', shouldMinifyFile('popup/popup.js'));
check('inject-scripts 仍然压缩', shouldMinifyFile('inject-scripts/main-world-executor.js'));
check(
  'Windows 路径分隔符会归一化',
  !shouldMinifyFile('src\\tools\\click.js') && normalizePackagePath('src\\tools\\click.js') === 'src/tools/click.js',
);

if (failures > 0) {
  console.error(`\n${failures} 项压缩策略检查失败。`);
  process.exit(1);
}
console.log('\n压缩策略检查通过。');

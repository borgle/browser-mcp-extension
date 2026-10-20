import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  INJECT_ACTION,
  INJECT_EVENT,
  INJECT_MSG,
} from '../src/constants.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bridge = fs.readFileSync(
  path.join(root, 'inject-scripts', 'inject-bridge.js'),
  'utf8',
);
const executor = fs.readFileSync(
  path.join(root, 'inject-scripts', 'main-world-executor.js'),
  'utf8',
);
const injectTool = fs.readFileSync(
  path.join(root, 'src', 'tools', 'inject-script.js'),
  'utf8',
);

const checks = [
  ['execute event', bridge.includes(INJECT_EVENT.EXECUTE)],
  ['response event', bridge.includes(INJECT_EVENT.RESPONSE)],
  ['cleanup event', bridge.includes(INJECT_EVENT.CLEANUP)],
  ['execute message', bridge.includes(INJECT_MSG.EXECUTE_SCRIPT)],
  ['execute action', executor.includes(INJECT_ACTION.EXECUTE_CODE)],
  ['video init action', executor.includes(INJECT_ACTION.INIT_VIDEO_RECEIVER)],
  ['video chunk action', executor.includes(INJECT_ACTION.VIDEO_CHUNK)],
  ['set video action', executor.includes(INJECT_ACTION.SET_VIDEO_TO_INPUT)],
  ['inject tool keeps MAIN executor', injectTool.includes('executeInMainWorld')],
  ['inject tool rejects ISOLATED source', injectTool.includes('只支持 MAIN world')],
  ['inject tool has no ISOLATED source method', !injectTool.includes('executeInIsolatedWorld')],
  ['inject tool has CSP fallback', injectTool.includes('executeInMainWorldViaCdp')],
  ['inject tool uses CDP Runtime.evaluate', injectTool.includes("'Runtime.evaluate'")],
  [
    'inject tool has no ISOLATED source runtime',
    !injectTool.includes("new Function('args', injectedSource)"),
  ],
];

let failures = 0;
for (const [name, passed] of checks) {
  if (passed) {
    console.log(`  ✔ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${name}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} 项注入契约检查失败。`);
  process.exit(1);
}
console.log('\n页面注入契约检查通过。');


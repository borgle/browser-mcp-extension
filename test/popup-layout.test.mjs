/**
 * popup 布局契约：设置页只放下载权限，连接项在概览就地编辑，视频桥在关于。
 *
 * 运行：node test/popup-layout.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'popup', 'popup.html'), 'utf8');

const overviewStart = html.indexOf('<!-- ================= 概览');
const settingsStart = html.indexOf('<!-- ================= 设置');
const aboutStart = html.indexOf('<!-- ================= 关于');
const overview = html.slice(overviewStart, settingsStart);
const settings = html.slice(settingsStart, aboutStart);
const about = html.slice(aboutStart);

let failures = 0;
function check(name, condition) {
  if (condition) {
    console.log(`  ✔ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${name}`);
  }
}

console.log('概览：连接配置就地编辑');
check('概览包含服务器与 API Key 输入', overview.includes('id="server-url"') && overview.includes('id="api-key"'));
check('概览包含两个编辑/保存/取消入口', ['edit-server', 'edit-key', 'save-server', 'save-key', 'cancel-server', 'cancel-key'].every((id) => overview.includes(`id="${id}"`)));
check('视频桥入口不在概览', !overview.includes('id="quick-bridge"'));

console.log('\n设置：只保留下载权限');
check('设置页包含下载权限', settings.includes('下载权限') && settings.includes('id="host-list"'));
check('设置页不再包含连接设置', !settings.includes('连接设置'));
check('设置页不再包含服务器/API Key 输入', !settings.includes('id="server-url"') && !settings.includes('id="api-key"'));

console.log('\n关于：视频桥与诊断移除');
check('关于页包含视频桥快捷入口', about.includes('id="quick-bridge"'));
check('不再有诊断面板', !html.includes('诊断') && !html.includes('id="tool-log"'));
check('不再有复制诊断按钮', !html.includes('id="btn-copy-diagnostics"'));

if (failures > 0) {
  console.error(`\n${failures} 项失败。`);
  process.exit(1);
}
console.log('\npopup 布局检查通过。');

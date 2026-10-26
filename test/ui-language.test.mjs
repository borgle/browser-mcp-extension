/**
 * 页面 toast 语言契约：默认跟随 Chrome UI 语言，手动选择优先，非 zh 回退英文。
 * 运行：node test/ui-language.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  UI_TEXT,
  normalizeUiLanguage,
  resolveUiLanguage,
  uiText,
} from '../src/core/ui-language.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

let failures = 0;
function check(name, condition) {
  if (condition) {
    console.log(`  ✔ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${name}`);
  }
}

console.log('词典完整性');
const en = new Set(Object.keys(UI_TEXT.en));
const zh = new Set(Object.keys(UI_TEXT.zh));
check('en / zh 键数量一致', en.size === zh.size);
check('en / zh 键集合一致', [...en].every((key) => zh.has(key)));
check(
  '所有文案都是非空字符串',
  [...en].every(
    (key) => typeof UI_TEXT.en[key] === 'string' && UI_TEXT.en[key].length > 0,
  ) &&
    [...zh].every(
      (key) => typeof UI_TEXT.zh[key] === 'string' && UI_TEXT.zh[key].length > 0,
    ),
);
check(
  '占位符在两种语言中一致',
  [...en].every((key) => {
    const placeholders = (value) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    return (
      JSON.stringify(placeholders(UI_TEXT.en[key])) ===
      JSON.stringify(placeholders(UI_TEXT.zh[key]))
    );
  }),
);

console.log('\n语言归一化');
check('zh / zh-CN 归一化为 zh', normalizeUiLanguage('zh') === 'zh' && normalizeUiLanguage('zh-CN') === 'zh');
check('en / en-US 归一化为 en', normalizeUiLanguage('en') === 'en' && normalizeUiLanguage('en-US') === 'en');
check('其他语言回退英文', normalizeUiLanguage('fr-FR') === 'en' && normalizeUiLanguage('') === 'en');

console.log('\n文案渲染');
check(
  '英文下载进度',
  uiText('en', 'video.downloading', {
    percent: '12.5',
    received: '1.50',
    total: '12.00',
    speed: '2.25',
  }) === 'Downloading video… 12.5% (1.50MB / 12.00MB) 2.25MB/s',
);
check(
  '中文组装进度',
  uiText('zh', 'video.assembling', { percent: '50', current: 2, total: 4 }) ===
    '正在组装视频… 50% (2/4)',
);
check('未知键回退键名', uiText('en', 'missing.key') === 'missing.key');

console.log('\n语言解析');
globalThis.chrome = {
  i18n: { getUILanguage: () => 'zh-CN' },
  storage: { local: { get: async () => ({ 'abm.lang': 'en' }) } },
};
check('手动选择优先于 Chrome 语言', (await resolveUiLanguage()) === 'en');

globalThis.chrome = {
  i18n: { getUILanguage: () => 'zh-CN' },
  storage: { local: { get: async () => ({}) } },
};
check('未保存时跟随 Chrome 中文', (await resolveUiLanguage()) === 'zh');

globalThis.chrome = {
  i18n: { getUILanguage: () => 'fr-FR' },
  storage: { local: { get: async () => ({}) } },
};
check('非 zh Chrome 语言回退英文', (await resolveUiLanguage()) === 'en');

globalThis.chrome = {
  i18n: { getUILanguage: () => 'zh-TW' },
  storage: {
    local: {
      get: async () => {
        throw new Error('storage unavailable');
      },
    },
  },
};
check('storage 不可用时仍跟随 Chrome 语言', (await resolveUiLanguage()) === 'zh');

console.log('\n工具接入');
const download = read('src/tools/download-video-from-url.js');
const assemble = read('src/tools/set-video-to-page.js');
check('下载工具使用统一 toast 文案', download.includes("uiText(language, 'video.downloading'"));
check('下载工具不再硬编码中文 toast', !download.includes('正在下载视频'));
check('组装工具使用统一 toast 文案', assemble.includes("uiText(language, 'video.assembling'"));
check('组装工具不再硬编码中文 toast', !assemble.includes('正在组装视频'));

delete globalThis.chrome;

if (failures > 0) {
  console.error(`\n${failures} 项失败。`);
  process.exit(1);
}
console.log('\n全部通过。');

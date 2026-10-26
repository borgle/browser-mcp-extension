/**
 * popup 中英文契约：词典完整、HTML 键存在、manifest 本地化、预览依赖已登记。
 * 运行：node test/popup-i18n.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { translations } from '../popup/i18n.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('popup/popup.html');
const popup = read('popup/popup.js');
const preview = read('tools/popup-preview.mjs');
const pkg = JSON.parse(read('package.json'));
const manifest = JSON.parse(read('manifest.json'));

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
const en = new Set(Object.keys(translations.en));
const zh = new Set(Object.keys(translations.zh));
check('en / zh 键数量一致', en.size === zh.size);
check('en / zh 键集合一致', [...en].every((key) => zh.has(key)));
check(
  '所有文案都是非空字符串',
  [...en].every((key) => typeof translations.en[key] === 'string' && translations.en[key].length > 0) &&
    [...zh].every((key) => typeof translations.zh[key] === 'string' && translations.zh[key].length > 0),
);
check(
  '占位符在两种语言中一致',
  [...en].every((key) => {
    if (!zh.has(key)) return false;
    const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    return JSON.stringify(placeholders(translations.en[key])) ===
      JSON.stringify(placeholders(translations.zh[key]));
  }),
);

console.log('\nHTML 静态键');
const htmlKeys = new Set();
for (const match of html.matchAll(/data-i18n(?:-html|-placeholder|-aria-label|-title)?="([^"]+)"/g)) {
  htmlKeys.add(match[1]);
}
check('HTML 使用至少 40 个翻译键', htmlKeys.size >= 40);
check('HTML 键全部存在于 en', [...htmlKeys].every((key) => en.has(key)));
check('HTML 键全部存在于 zh', [...htmlKeys].every((key) => zh.has(key)));
check('语言切换按钮存在', html.includes('data-lang="zh"') && html.includes('data-lang="en"'));

console.log('\n动态键');
for (const match of popup.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) {
  const key = match[1];
  check(`popup.js 键存在: ${key}`, en.has(key) && zh.has(key));
}
check('popup.js 初始化语言', popup.includes('initPopupLanguage') && popup.includes('onLanguageChange'));
check('popup.js 使用相对时间翻译', popup.includes("relative.justNow") && popup.includes("relative.minutes"));

console.log('\nManifest 本地化');
check('manifest 有 default_locale=en', manifest.default_locale === 'en');
check('name 使用 __MSG_extensionName__', manifest.name === '__MSG_extensionName__');
check('description 使用 __MSG_extensionDescription__', manifest.description === '__MSG_extensionDescription__');
check('action title 使用本地化名称', manifest.action?.default_title === '__MSG_extensionName__');
for (const locale of ['en', 'zh_CN']) {
  const file = `_locales/${locale}/messages.json`;
  check(`${file} 存在`, fs.existsSync(path.join(root, file)));
  if (!fs.existsSync(path.join(root, file))) continue;
  const messages = JSON.parse(read(file));
  check(`${locale} extensionName 非空`, typeof messages.extensionName?.message === 'string' && messages.extensionName.message.length > 0);
  check(`${locale} extensionDescription 非空`, typeof messages.extensionDescription?.message === 'string' && messages.extensionDescription.message.length > 0);
}
check('打包包含 _locales', read('scripts/package-extension.mjs').includes("'_locales'"));

console.log('\n预览与测试');
check('preview 打包包含 popup/i18n.js', preview.includes("'popup/i18n.js'"));
check('preview 默认语言为中文', preview.includes("['abm.lang', 'zh']"));
check('test 脚本包含 popup-i18n', String(pkg.scripts?.test || '').includes('popup-i18n.test.mjs'));

if (failures > 0) {
  console.error(`\n${failures} 项失败。`);
  process.exit(1);
}
console.log('\npopup 中英文契约通过。');

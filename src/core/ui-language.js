/**
 * 扩展在页面里画 toast 时使用的语言。
 *
 * 优先级：popup 保存的 `abm.lang` > Chrome UI 语言 > 英文。
 * 只支持 zh / en；其他 Chrome 语言统一回退英文，和 popup 的默认行为一致。
 */
import { STORAGE_KEY } from '../constants.js';

export const UI_TEXT = Object.freeze({
  en: Object.freeze({
    'video.downloading': 'Downloading video… {percent}% ({received}MB / {total}MB) {speed}MB/s',
    'video.assembling': 'Preparing video… {percent}% ({current}/{total})',
    'video.unknownSize': 'unknown',
  }),
  zh: Object.freeze({
    'video.downloading': '正在下载视频… {percent}% ({received}MB / {total}MB) {speed}MB/s',
    'video.assembling': '正在组装视频… {percent}% ({current}/{total})',
    'video.unknownSize': '未知',
  }),
});

/** 把任意语言标记归一化为 zh / en；非中文一律英文。 */
export function normalizeUiLanguage(value) {
  return String(value || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** 按当前界面语言取文案并替换 `{name}` 占位符。 */
export function uiText(language, key, values = {}) {
  const copy = UI_TEXT[language === 'zh' ? 'zh' : 'en'];
  let text = copy[key] ?? UI_TEXT.en[key] ?? key;
  for (const [name, replacement] of Object.entries(values)) {
    text = text.replaceAll(`{${name}}`, String(replacement));
  }
  return text;
}

function detectChromeLanguage() {
  try {
    return normalizeUiLanguage(chrome.i18n?.getUILanguage?.() || navigator.language || 'en');
  } catch {
    return 'en';
  }
}

/**
 * 解析页面 toast 的语言：手动选择优先，其次跟随 Chrome UI 语言。
 * storage 不可用时仍然返回 Chrome UI 语言，保证默认行为不退化。
 */
export async function resolveUiLanguage() {
  try {
    const saved = (await chrome.storage.local.get(STORAGE_KEY.language))[STORAGE_KEY.language];
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    // Storage unavailable: fall through to the Chrome UI language.
  }
  return detectChromeLanguage();
}

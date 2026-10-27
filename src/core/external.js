/**
 * 受信网页与扩展之间的外部消息入口。
 *
 * 视频消息仍由 video/receiver.js 处理；账号控制台可以用
 * abm.connection.configure 把服务器地址和 API Key 一次性写入扩展。
 */
import { EXTERNAL_MSG } from '../constants.js';
import { POPUP_MSG } from '../message-types.js';
import { handlePopupMessage } from '../popup-messages.js';
import { handleExternalMessage, trustedSender } from '../video/receiver.js';

function sameOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

export async function configureFromExternal(message, handler = handlePopupMessage) {
  const serverBaseUrl = String(message?.payload?.serverBaseUrl || '').trim();
  const apiKey = String(message?.payload?.apiKey || '').trim();
  if (!serverBaseUrl || !apiKey) {
    return { ok: false, error: 'serverBaseUrl and apiKey are required.' };
  }
  const saved = await handler({
    type: POPUP_MSG.SAVE_CONFIG,
    payload: { serverBaseUrl, apiKey },
  });
  if (!saved?.success) {
    return { ok: false, error: saved?.error || 'Could not save connection settings.' };
  }
  const connected = await handler({
    type: POPUP_MSG.CONNECT,
    payload: { serverBaseUrl, apiKey },
  });
  if (!connected?.success) {
    return { ok: false, error: connected?.error || 'Could not connect the extension.' };
  }
  return { ok: true, connected: true };
}

export function installExternalMessageListener() {
  chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (!trustedSender(sender)) {
      sendResponse({ ok: false, error: 'Untrusted origin.' });
      return false;
    }
    let task;
    if (message?.type === EXTERNAL_MSG.CONFIGURE) {
      const target = sameOrigin(message?.payload?.serverBaseUrl);
      if (!target || sameOrigin(sender.origin) !== target) {
        sendResponse({ ok: false, error: 'Origin mismatch.' });
        return false;
      }
      task = configureFromExternal(message);
    } else {
      task = handleExternalMessage(message, sender);
    }
    task
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  });
}

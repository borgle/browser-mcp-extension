/**
 * 工具结果 → popup 诊断面板。
 *
 * 只给扩展自己的 popup 看，不改变 WS 上发给服务端的 tool.result。
 * popup 可能没打开，sendMessage 失败时静默忽略。
 */
import { POPUP_MSG } from '../message-types.js';

/** popup 里最多展示的文本长度，避免把整页数据塞进诊断面板 */
export const TOOL_RESULT_TEXT_LIMIT = 4000;

/**
 * 生成稳定的诊断摘要。
 * @param {{requestId?: string, name?: string, response?: object, durationMs?: number}} update
 */
export function summarizeToolResult({ requestId, name, response, durationMs = 0 } = {}) {
  const status = response?.status === 'ok' ? 'ok' : 'error';
  const summary = {
    requestId: requestId || undefined,
    name: name || '未知工具',
    status,
    durationMs: Math.max(0, Math.round(Number(durationMs) || 0)),
    at: Date.now(),
  };

  if (status === 'ok') {
    const text = (response?.content || [])
      .map((item) => {
        if (typeof item?.text === 'string') return item.text;
        try {
          return JSON.stringify(item);
        } catch {
          return String(item);
        }
      })
      .join('\n');
    summary.truncated = text.length > TOOL_RESULT_TEXT_LIMIT;
    summary.text = summary.truncated
      ? `${text.slice(0, TOOL_RESULT_TEXT_LIMIT)}\n…（已截断）`
      : text;
  } else {
    summary.error = response?.error || {
      code: 'ABM_TOOL_EXECUTION_FAILED',
      message: '工具执行失败',
    };
  }

  return summary;
}

/** 把摘要发给 popup；没有接收方时忽略。 */
export function broadcastToolResult(update) {
  const payload = summarizeToolResult(update);
  try {
    chrome.runtime.sendMessage({ type: POPUP_MSG.TOOL_RESULT_UPDATE, payload }).catch(() => {});
  } catch {
    // popup 未打开，或扩展上下文正在销毁
  }
  return payload;
}

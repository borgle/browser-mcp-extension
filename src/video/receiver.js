/**
 * 受信视频桥页面与扩展之间的外部消息。
 *
 * 可信来源只由 manifest 的 externally_connectable.matches 决定。
 * 受信桥页面会通过 abm.bridge.config 获取当前连接配置（含 API Key），
 * 这是视频桥免重复配置的既定行为；因此绝不能把该接口暴露给任意网页。
 */
import { BRIDGE_MSG, DEFAULT_BRIDGE_KEY_PATTERNS } from '../constants.js';
import { loadConnectionConfig } from '../core/storage.js';
import {
  clearStoredVideo,
  getStoredVideoInfo,
  storeVideo,
  VIDEO_RETENTION_MS,
} from './store.js';

const uploadSessions = new Map();

function patternToOriginRegExp(pattern) {
  if (pattern === '<all_urls>') return /^https?:\/\//i;
  const match = /^(\*|https?):\/\/([^/]+)(?:\/.*)?$/i.exec(String(pattern || '').trim());
  if (!match) return null;
  const [, scheme, authority] = match;
  let host = authority;
  let port = '';
  const portMatch = /:(\*|\d+)$/.exec(authority);
  if (portMatch) {
    host = authority.slice(0, portMatch.index);
    port = portMatch[1] === '*' ? '(?::\\d+)?' : `:${portMatch[1]}`;
  }
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hostRe = host.startsWith('*.')
    ? `(?:[^./]+\\.)*${escape(host.slice(2))}`
    : escape(host);
  return new RegExp(`^${scheme === '*' ? 'https?' : scheme}://${hostRe}${port}$`, 'i');
}

export function matchesOrigin(origin, patterns) {
  return patterns.some((pattern) => patternToOriginRegExp(pattern)?.test(origin));
}

function senderOrigin(sender) {
  if (sender?.origin) return sender.origin;
  try {
    const url = new URL(sender?.url || '');
    return `${url.protocol}//${url.host}`;
  } catch {
    return '';
  }
}

function trustedPatterns() {
  const declared = chrome.runtime.getManifest()?.externally_connectable?.matches;
  if (!Array.isArray(declared) || declared.length === 0) {
    return DEFAULT_BRIDGE_KEY_PATTERNS;
  }
  const tooBroad = declared.some(
    (pattern) => pattern === '<all_urls>' || /^\*:\/\/\*\/\*$/.test(pattern),
  );
  return tooBroad ? DEFAULT_BRIDGE_KEY_PATTERNS : declared;
}

function trustedSender(sender) {
  return matchesOrigin(senderOrigin(sender), trustedPatterns());
}

function bytesFromBase64(value) {
  if (typeof value !== 'string') return new Uint8Array(0);
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function beginVideo(payload) {
  const sessionId = String(payload?.sessionId || '');
  if (!sessionId) return { ok: false, error: 'sessionId 必填' };
  if (uploadSessions.has(sessionId)) return { ok: false, error: '视频会话已存在' };
  uploadSessions.set(sessionId, {
    sessionId,
    fileName: String(payload.fileName || 'video.mp4'),
    fileType: String(payload.fileType || 'video/mp4'),
    fileSize: Number(payload.fileSize || 0),
    totalChunks: Number(payload.totalChunks || 0),
    chunks: [],
    receivedSize: 0,
    createdAt: Date.now(),
  });
  return { ok: true };
}

function appendVideoChunk(payload) {
  const session = uploadSessions.get(payload?.sessionId);
  if (!session) return { ok: false, error: '视频会话不存在' };
  const index = Number(payload.index);
  if (!Number.isInteger(index) || index < 0) {
    return { ok: false, error: '分片索引无效' };
  }
  const bytes = bytesFromBase64(payload.base64);
  session.chunks[index] = bytes;
  session.receivedSize += bytes.length;
  return { ok: true, receivedSize: session.receivedSize };
}

function finishVideo(payload) {
  const session = uploadSessions.get(payload?.sessionId);
  if (!session) return { ok: false, error: '视频会话不存在' };
  const chunks = session.chunks.filter(Boolean);
  if (session.totalChunks && chunks.length !== session.totalChunks) {
    return { ok: false, error: '视频分片不完整' };
  }
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  storeVideo(session.fileName, session.fileType, size, merged);
  uploadSessions.delete(session.sessionId);
  return { ok: true, fileSize: size };
}

setInterval(() => {
  const cutoff = Date.now() - VIDEO_RETENTION_MS;
  for (const [id, session] of uploadSessions) {
    if (session.createdAt < cutoff) uploadSessions.delete(id);
  }
}, 300000);

export async function handleExternalMessage(message, sender) {
  if (!trustedSender(sender)) {
    return { ok: false, error: '来源未受信任' };
  }
  switch (message?.type) {
    case BRIDGE_MSG.CONFIG: {
      const config = await loadConnectionConfig();
      return {
        ok: true,
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version,
        serverBaseUrl: config.serverBaseUrl,
        apiKey: config.apiKey || '',
      };
    }
    case BRIDGE_MSG.CHECK:
      return {
        ok: true,
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version,
        storedVideo: getStoredVideoInfo(),
      };
    case BRIDGE_MSG.VIDEO_BEGIN:
      return beginVideo(message.payload);
    case BRIDGE_MSG.VIDEO_CHUNK:
      return appendVideoChunk(message.payload);
    case BRIDGE_MSG.VIDEO_FINISH:
      return finishVideo(message.payload);
    case BRIDGE_MSG.VIDEO_CANCEL:
      uploadSessions.delete(message.payload?.sessionId);
      return { ok: true };
    case BRIDGE_MSG.VIDEO_INFO:
      return getStoredVideoInfo();
    case 'abm.video.clear':
      clearStoredVideo();
      return { ok: true };
    default:
      return { ok: false, error: '未知外部消息类型' };
  }
}

export function installExternalMessageListener() {
  chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    handleExternalMessage(message, sender)
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


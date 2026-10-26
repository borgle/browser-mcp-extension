/**
 * browser_download_video_from_url：扩展自己去某个 URL 下载视频，写进暂存区。
 *
 * 参数：
 *   url      必填，http/https
 *   timeout  下载超时，默认 30 分钟
 *   tabId    可选：传了就在该标签页上显示下载进度 toast（需要能向该标签注入脚本）
 *
 * 与视频桥的关系：两者最终都调用 video/store.storeVideo()。
 * 所以下载完可以直接 browser_set_video_to_page。差别是这条通道由扩展自己发起 HTTP 请求，
 * 因此需要目标域名的 host 权限（本机 127.0.0.1 / localhost 已在 manifest 里）。
 *
 * 返回：
 *   - 缺权限：`{ success:false, needPermission:true, host }`（isError=false，便于上层引导授权）
 *   - 成功：`{ success:true, fileName, fileType, fileSize }`
 */
import { BaseTool } from './base.js';
import { resolveUiLanguage, uiText } from '../core/ui-language.js';
import { hasHostPermission } from '../permissions/manager.js';
import { VIDEO_MAX_BYTES, storeVideo } from '../video/store.js';

/** 判定“看起来是视频”的 Content-Type 白名单（视频/二进制流） */
const ALLOWED_CONTENT_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/webm',
  'video/x-matroska',
  'application/octet-stream',
];
/** 兜底判断：URL 后缀 */
const ALLOWED_EXTENSIONS = ['mp4', 'mov', 'avi', 'webm', 'mkv'];
/** 默认下载超时 30 分钟 */
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
/** 进度上报间隔 */
const PROGRESS_INTERVAL_MS = 500;
/** 伪装 UA：部分 CDN 对非浏览器 UA 直接拒绝 */
const SPOOFED_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

export class DownloadVideoFromUrlTool extends BaseTool {
  name = 'browser_download_video_from_url';

  async execute(args) {
    const { url, timeout = DEFAULT_TIMEOUT_MS } = args;
    if (!url) return this.createErrorResult('url is required');

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return this.createErrorResult('Invalid URL format');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return this.createErrorResult('Only http and https URLs are supported');
    }
    if (!(await hasHostPermission(url))) {
      return this.createTextResult(
        JSON.stringify({
          success: false,
          needPermission: true,
          host: parsed.host,
          message: `No permission to access ${parsed.host}. Add this host or grant all hosts in the extension settings.`,
        }),
      );
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      let response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': SPOOFED_UA },
        });
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof Error && err.name === 'AbortError') {
          return this.createErrorResult(`Download timed out after ${Math.round(timeout / 1000 / 60)} minutes`);
        }
        return this.createErrorResult(`Download failed: ${err instanceof Error ? err.message : 'network error'}`);
      }
      clearTimeout(timer);

      if (!response.ok) return this.createErrorResult(`Download failed: HTTP ${response.status} ${response.statusText}`);

      // 类型校验：优先 Content-Type，其次看 URL 后缀
      const contentType = response.headers.get('Content-Type') || '';
      if (!contentType.startsWith('video/') && !ALLOWED_CONTENT_TYPES.includes(contentType)) {
        const extension = parsed.pathname.split('.').pop()?.toLowerCase();
        if (!extension || !ALLOWED_EXTENSIONS.includes(extension)) {
          return this.createErrorResult(`Unsupported file type: ${contentType || 'unknown'}`);
        }
      }

      const contentLength = response.headers.get('Content-Length');
      if (contentLength) {
        const declared = parseInt(contentLength, 10);
        if (declared > VIDEO_MAX_BYTES) {
          return this.createErrorResult(
            `File too large: ${Math.round(declared / 1024 / 1024 / 1024)}GB. The maximum is 20GB.`,
          );
        }
      }

      const declaredBytes = parseInt(contentLength || '0', 10);

      let bytes;
      if (args.tabId && declaredBytes > 0 && response.body) {
        // 已知长度 + 指定标签页：走流式读取，边下边在页面上报进度
        const language = await resolveUiLanguage();
        bytes = await this.readStreamWithProgress(response, args.tabId, declaredBytes, language);
      } else {
        bytes = new Uint8Array(await response.arrayBuffer());
      }

      if (bytes.length > VIDEO_MAX_BYTES) {
        return this.createErrorResult(
          `File too large: ${Math.round(bytes.length / 1024 / 1024 / 1024)}GB. The maximum is 20GB.`,
        );
      }

      const fileName = this.extractFileName(parsed, contentType);
      const fileType = this.getFileType(contentType, fileName);
      storeVideo(fileName, fileType, bytes.length, bytes);

      return this.createTextResult(
        JSON.stringify({
          success: true,
          fileName,
          fileType,
          fileSize: bytes.length,
          message: 'Video downloaded and staged',
        }),
      );
    } catch (err) {
      return this.createErrorResult(err instanceof Error ? err.message : 'Download failed');
    }
  }

  /** 流式读取响应体，每 500ms 往页面推一次进度 toast */
  async readStreamWithProgress(response, tabId, declaredBytes, language) {
    const reader = response.body.getReader();
    const parts = [];
    let received = 0;
    let lastReportAt = 0;
    const startedAt = Date.now();
    const totalMb =
      declaredBytes > 0
        ? (declaredBytes / 1024 / 1024).toFixed(2)
        : uiText(language, 'video.unknownSize');

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      received += value.length;

      const now = Date.now();
      if (now - lastReportAt >= PROGRESS_INTERVAL_MS) {
        lastReportAt = now;
        const percent = ((received / declaredBytes) * 100).toFixed(1);
        const receivedMb = (received / 1024 / 1024).toFixed(2);
        const elapsedSec = (now - startedAt) / 1000;
        const speed = elapsedSec > 0 ? (received / 1024 / 1024 / elapsedSec).toFixed(2) : '0.00';
        const text = uiText(language, 'video.downloading', {
          percent,
          received: receivedMb,
          total: totalMb,
          speed,
        });
        chrome.scripting
          .executeScript({
            target: { tabId },
            world: 'MAIN',
            func: (message) => {
              if (typeof window.__showToast === 'function') window.__showToast(message);
            },
            args: [text],
          })
          .catch(() => {});
      }
    }

    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return bytes;
  }

  /** 文件名优先取 URL 最后一段；没有后缀时按 Content-Type 生成 */
  extractFileName(parsed, contentType) {
    const segments = parsed.pathname.split('/');
    const last = segments[segments.length - 1];
    if (last && last.includes('.')) return decodeURIComponent(last);
    return `downloaded_video_${Date.now()}.${this.getExtensionFromContentType(contentType)}`;
  }

  getExtensionFromContentType(contentType) {
    return (
      {
        'video/mp4': 'mp4',
        'video/quicktime': 'mov',
        'video/x-msvideo': 'avi',
        'video/webm': 'webm',
        'video/x-matroska': 'mkv',
      }[contentType] || 'mp4'
    );
  }

  /** Content-Type 是 video/* 就用它，否则按文件后缀推断 */
  getFileType(contentType, fileName) {
    if (contentType.startsWith('video/')) return contentType;
    return (
      {
        mp4: 'video/mp4',
        mov: 'video/quicktime',
        avi: 'video/x-msvideo',
        webm: 'video/webm',
        mkv: 'video/x-matroska',
      }[fileName.split('.').pop()?.toLowerCase() || ''] || 'video/mp4'
    );
  }
}

/**
 * browser_set_files_from_urls：从 URL 下载图片（≤10MB）后写进 file input。
 *
 * 参数：
 *   selector  必填
 *   urls      必填，非空数组，元素形如 { url, fileName, mimeType }
 *   tabId / timeout 透传给 browser_set_files
 *
 * 与 browser_set_files 的差别：文件字节由扩展自己去站点取，因此需要该域名的 host 权限；
 * 缺权限时返回 `{ success:false, needPermission:true, host }`（isError=false），
 * 让上层提示用户去扩展设置里授权。
 */
import { BaseTool } from './base.js';
import { hasHostPermission } from '../permissions/manager.js';
import { SetFilesTool } from './set-files.js';

/** 单文件上限 10MB */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** 单个 URL 的下载超时 */
const DOWNLOAD_TIMEOUT_MS = 120000;
/** 分块转 base64，避免超长参数爆栈 */
const B64_BLOCK = 32768;

export class SetFilesFromUrlsTool extends BaseTool {
  name = 'browser_set_files_from_urls';

  async execute(args) {
    const { selector, urls, tabId, timeout } = args;
    if (!selector) return this.createErrorResult('selector 参数必填');
    if (!urls || urls.length === 0) return this.createErrorResult('urls 参数必填且不能为空');

    const files = [];
    for (const item of urls) {
      let parsed;
      try {
        parsed = new URL(item.url);
      } catch {
        return this.createErrorResult(`无效的 URL 格式: ${item.url}`);
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return this.createErrorResult('仅支持 http/https 协议');
      }
      if (!(await hasHostPermission(item.url))) {
        return this.createTextResult(
          JSON.stringify({
            success: false,
            needPermission: true,
            host: parsed.host,
            message: `没有访问 ${parsed.host} 的权限，请在扩展设置中添加该域名或授权所有域名`,
          }),
        );
      }

      const downloaded = await this.fetchAsBase64(item.url);
      if ('error' in downloaded) {
        return this.createErrorResult(`下载图片失败 (${item.url}): ${downloaded.error}`);
      }
      files.push({
        base64Data: downloaded.base64,
        fileName: item.fileName,
        mimeType: downloaded.mimeType || item.mimeType,
      });
    }

    // 复用 browser_set_files 的写文件逻辑
    return new SetFilesTool().execute({ selector, files, tabId, timeout });
  }

  /** 下载并转 base64；返回 { base64, mimeType } 或 { error }（不抛异常） */
  async fetchAsBase64(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return { error: `HTTP ${res.status} ${res.statusText}` };

      const declaredLength = res.headers.get('Content-Length');
      if (declaredLength && parseInt(declaredLength, 10) > MAX_FILE_BYTES) {
        return { error: '图片超过 10MB 限制' };
      }
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength > MAX_FILE_BYTES) return { error: '图片超过 10MB 限制' };

      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += B64_BLOCK) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + B64_BLOCK));
      }

      const contentType = res.headers.get('Content-Type') || '';
      const mimeType = contentType.startsWith('image/') ? contentType.split(';')[0] : '';
      return { base64: btoa(binary), mimeType };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return { error: '下载超时' };
      return { error: err instanceof Error ? err.message : '网络错误' };
    } finally {
      clearTimeout(timer);
    }
  }
}

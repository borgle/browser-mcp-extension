/**
 * browser_upload_file：把一段 base64 内容作为文件写进 `<input type="file">`。
 *
 * 参数：
 *   selector    必填，必须指向 file input
 *   base64Data  必填，可带 `data:...;base64,` 前缀
 *   fileName    默认 "file"
 *   mimeType    默认 "application/octet-stream"
 *   timeout     等待输入框的超时，默认 30s
 *   tabId       目标标签页，缺省用活动标签
 * 返回 { success, selector, fileName, mimeType }。
 */
import { BaseTool } from './base.js';

export class UploadFileTool extends BaseTool {
  name = 'browser_upload_file';

  async execute(args) {
    const {
      selector,
      base64Data,
      fileName = 'file',
      mimeType = 'application/octet-stream',
      timeout = 30000,
    } = args;
    if (!selector) return this.createErrorResult('selector is required');
    if (!base64Data) return this.createErrorResult('base64Data is required');

    try {
      const tab = await this.getTargetTab(args.tabId);
      if (!tab?.id) return this.createErrorResult('Could not find the target tab');
      const tabId = tab.id;

      if (!(await this.waitForSelector(tabId, selector, timeout))) {
        return this.createErrorResult(`File input not found: ${selector}`);
      }

      await this.executeInTab(
        tabId,
        (sel, data, name, type) => {
          const input = document.querySelector(sel);
          if (!input) throw new Error(`File input not found: ${sel}`);
          if (!(input instanceof HTMLInputElement) || input.type !== 'file') {
            throw new Error('Selector does not point to a file input');
          }

          const binary = atob(data.replace(/^data:[^;]+;base64,/, ''));
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

          const file = new File([new Blob([bytes], { type })], name, { type });
          const transfer = new DataTransfer();
          transfer.items.add(file);
          input.files = transfer.files;

          // 先触发 change，再触发 input。
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return { success: true };
        },
        [selector, base64Data, fileName, mimeType],
      );

      return this.createTextResult(
        JSON.stringify({ success: true, selector, fileName, mimeType }),
      );
    } catch (err) {
      return this.createErrorResult(err instanceof Error ? err.message : 'File upload failed');
    }
  }
}

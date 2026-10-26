/**
 * browser_set_files：一次写入多个内存文件到 `<input type="file" multiple>`。
 *
 * 参数：
 *   selector  必填，必须指向 file input
 *   files     必填，非空数组，元素形如 { fileName, mimeType, base64Data }
 *   timeout   等待输入框的超时，默认 30s
 *   tabId     目标标签页，缺省用活动标签
 * 返回 { success, selector, fileCount }。
 */
import { BaseTool } from './base.js';

export class SetFilesTool extends BaseTool {
  name = 'browser_set_files';

  async execute(args) {
    const { selector, files, timeout = 30000 } = args;
    if (!selector) return this.createErrorResult('selector is required');
    if (!files || files.length === 0) return this.createErrorResult('files is required and must not be empty');

    try {
      let tabId = args.tabId;
      if (!tabId) {
        const activeTab = await this.getTargetTab();
        if (!activeTab?.id) return this.createErrorResult('Could not find the target tab');
        tabId = activeTab.id;
      }

      if (!(await this.waitForSelector(tabId, selector, timeout))) {
        return this.createErrorResult(`File input not found: ${selector}`);
      }

      await this.executeInTab(
        tabId,
        (sel, fileList) => {
          const input = document.querySelector(sel);
          if (!input) throw new Error(`File input not found: ${sel}`);
          if (!(input instanceof HTMLInputElement) || input.type !== 'file') {
            throw new Error('Selector does not point to a file input');
          }

          const transfer = new DataTransfer();
          for (const item of fileList) {
            const binary = atob(item.base64Data.replace(/^data:[^;]+;base64,/, ''));
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes], { type: item.mimeType });
            transfer.items.add(new File([blob], item.fileName, { type: item.mimeType }));
          }
          input.files = transfer.files;

          // 先触发 input，再触发 change。
          input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
          return { success: true, count: fileList.length };
        },
        [selector, files],
      );

      return this.createTextResult(
        JSON.stringify({ success: true, selector, fileCount: files.length }),
      );
    } catch (err) {
      return this.createErrorResult(err instanceof Error ? err.message : 'Failed to set files');
    }
  }
}

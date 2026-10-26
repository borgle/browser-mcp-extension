/**
 * browser_set_files_native：用 CDP `DOM.setFileInputFiles` 注入**本机绝对路径**的文件。
 *
 * 参数：
 *   selector 必填，file input
 *   paths    必填，非空的本机绝对路径数组
 *   timeout  等待输入框的超时，默认 30s
 *   tabId    目标标签页，缺省用活动标签
 *
 * 与 browser_set_files / browser_upload_file 的区别：那两条把字节放进页面内存再伪造
 * File 对象（文件大小受消息体积限制）；这条由浏览器直接读本机文件，适合大文件，
 * 但要求文件已经在用户机器上（后端/AI 无法提供本机路径）。
 */
import { BaseTool } from './base.js';
import { ensureDebugger, sendCommand } from '../cdp.js';
import { sleep } from '../utils.js';

/** 轮询查找 input 的间隔 */
const POLL_INTERVAL_MS = 300;

export class SetFilesNativeTool extends BaseTool {
  name = 'browser_set_files_native';

  async execute(args) {
    const { selector, paths, timeout = 30000 } = args ?? {};
    if (!selector) return this.createErrorResult('selector is required');
    if (!Array.isArray(paths) || paths.length === 0) return this.createErrorResult('paths must be a non-empty array');

    try {
      const tab = await this.getTargetTab(args.tabId);
      if (!tab?.id) return this.createErrorResult('Could not find the target tab');
      const tabId = tab.id;

      await ensureDebugger(tabId);
      await sendCommand(tabId, 'DOM.enable', {});
      const nodeId = await this.waitForFileInputNode(tabId, selector, timeout);
      await sendCommand(tabId, 'DOM.setFileInputFiles', { files: paths, nodeId });

      return this.createTextResult(JSON.stringify({ success: true, tabId, count: paths.length }));
    } catch (err) {
      return this.createErrorResult(err instanceof Error ? err.message : 'Failed to set files');
    }
  }

  /** 轮询 DOM.querySelector 直到拿到 input 的 nodeId（pierce 穿透 shadow DOM） */
  async waitForFileInputNode(tabId, selector, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { root } = await sendCommand(tabId, 'DOM.getDocument', { depth: -1, pierce: true });
      const { nodeId } = await sendCommand(tabId, 'DOM.querySelector', { nodeId: root.nodeId, selector });
      if (nodeId) return nodeId;
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`File input not found: ${selector}`);
  }
}

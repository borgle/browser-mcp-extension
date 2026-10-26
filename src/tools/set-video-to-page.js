/**
 * browser_set_video_to_page：把暂存区的视频写进页面的 `<input type="file">`。
 *
 * 参数：
 *   selector       必填，视频上传的 file input
 *   timeout        等待输入框的超时，默认 30s
 *   clearAfterSet  设置成功后清空暂存区，默认 false
 *   tabId          目标标签页，缺省用活动标签
 *
 * 流程（视频字节不能走 chrome.tabs.sendMessage 一次传完，需要分片）：
 *   1. 注入 inject-bridge.js（ISOLATED）+ main-world-executor.js（MAIN）；
 *   2. MAIN world 里 INIT_VIDEO_RECEIVER 建立接收器；
 *   3. 逐片 VIDEO_CHUNK 传入（每片 20MB，边传边显示进度 toast）；
 *   4. SET_VIDEO_TO_INPUT 让 MAIN world 组装 File 并写进 input。
 *
 * 暂存区为空时返回 `{ success:false, needUpload:true }`（isError=false），
 * 提示调用方先跑 browser_stage_video / browser_download_video_from_url。
 */
import { BaseTool } from './base.js';
import { INJECT_ACTION, INJECT_MSG, EXECUTION_WORLD } from '../constants.js';
import { resolveUiLanguage, uiText } from '../core/ui-language.js';
import { VIDEO_CHUNK_BYTES, clearStoredVideo, getStoredVideo } from '../video/store.js';

/** 单条 tabs.sendMessage 的等待上限 */
const MESSAGE_TIMEOUT_MS = 30000;
/** 初始化接收器的等待上限 */
const INIT_TIMEOUT_MS = 10000;
/** base64 转换的分块大小 */
const B64_BLOCK = 32768;

export class SetVideoToPageTool extends BaseTool {
  name = 'browser_set_video_to_page';

  async execute(args) {
    const { selector, timeout = 30000, clearAfterSet = false } = args;
    if (!selector) return this.createErrorResult('selector 参数必填');

    try {
      const video = getStoredVideo();
      if (!video) {
        return this.createTextResult(
          JSON.stringify({
            success: false,
            needUpload: true,
            message: '没有暂存的视频，请先上传视频文件',
          }),
        );
      }

      let tabId = args.tabId;
      if (!tabId) {
        const activeTab = await this.getTargetTab();
        if (!activeTab?.id) return this.createErrorResult('无法找到目标标签页');
        tabId = activeTab.id;
      }
      if (!(await this.waitForSelector(tabId, selector, timeout))) {
        return this.createErrorResult(`文件输入框未找到: ${selector}`);
      }

      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['inject-scripts/inject-bridge.js'],
        world: EXECUTION_WORLD.ISOLATED,
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['inject-scripts/main-world-executor.js'],
        world: EXECUTION_WORLD.MAIN,
      });

      const totalChunks = Math.ceil(video.data.length / VIDEO_CHUNK_BYTES);
      const language = await resolveUiLanguage();

      // 1) 建立 MAIN world 的接收器
      await this.sendToPage(
        tabId,
        {
          type: INJECT_MSG.EXECUTE_SCRIPT,
          targetWorld: 'MAIN',
          action: INJECT_ACTION.INIT_VIDEO_RECEIVER,
          totalChunks,
          videoFileName: video.fileName,
          videoFileType: video.fileType,
        },
        INIT_TIMEOUT_MS,
        '初始化视频接收器超时',
        null,
      );

      // 2) 逐片投递
      for (let index = 0; index < totalChunks; index++) {
        const start = index * VIDEO_CHUNK_BYTES;
        const end = Math.min(start + VIDEO_CHUNK_BYTES, video.data.length);
        const chunkBase64 = this.uint8ArrayToBase64(video.data.subarray(start, end));
        const percent = Math.round(((index + 1) / totalChunks) * 100);

        // 进度 toast 只是锦上添花，失败不影响主流程
        try {
          const toast = uiText(language, 'video.assembling', {
            percent,
            current: index + 1,
            total: totalChunks,
          });
          await chrome.scripting.executeScript({
            target: { tabId },
            func: (message) => {
              if (typeof window.__showToast === 'function') window.__showToast(message);
            },
            args: [toast],
            world: EXECUTION_WORLD.MAIN,
          });
        } catch {
          // 忽略
        }

        await this.sendToPage(
          tabId,
          {
            type: INJECT_MSG.EXECUTE_SCRIPT,
            targetWorld: 'MAIN',
            action: INJECT_ACTION.VIDEO_CHUNK,
            chunkIndex: index,
            chunkData: chunkBase64,
          },
          MESSAGE_TIMEOUT_MS,
          `发送分块 ${index + 1} 超时`,
          '分块接收失败',
        );
      }

      // 3) 组装并写入 input
      const setResult = await this.sendToPage(
        tabId,
        {
          type: INJECT_MSG.EXECUTE_SCRIPT,
          targetWorld: 'MAIN',
          action: INJECT_ACTION.SET_VIDEO_TO_INPUT,
          args: { selector },
        },
        MESSAGE_TIMEOUT_MS,
        '设置视频到 file input 超时',
        '设置视频失败',
      );
      if (!setResult.success) {
        throw new Error(setResult.error?.message || '设置视频到 file input 失败');
      }

      if (clearAfterSet) clearStoredVideo();

      return this.createTextResult(
        JSON.stringify({
          success: true,
          selector,
          fileName: video.fileName,
          fileSize: video.fileSize,
          chunks: totalChunks,
        }),
      );
    } catch (err) {
      return this.createErrorResult(err instanceof Error ? err.message : '视频设置失败');
    }
  }

  /**
   * 向页面 MAIN world 发一条 EXECUTE_SCRIPT 消息并等回执。
   * @param {string|null} responseErrorMessage 回执 error 时的报错文案；传 null 表示忽略
   */
  sendToPage(tabId, message, timeoutMs, timeoutMessage, responseErrorMessage = null) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      chrome.tabs.sendMessage(tabId, message, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (responseErrorMessage !== null && response?.error) {
          reject(new Error(response.error.message || responseErrorMessage));
          return;
        }
        resolve(response?.data || { success: true });
      });
    });
  }

  /** Uint8Array → base64（分块拼接，避免 String.fromCharCode 参数过多） */
  uint8ArrayToBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += B64_BLOCK) {
      const slice = bytes.subarray(offset, offset + B64_BLOCK);
      binary += String.fromCharCode.apply(null, Array.from(slice));
    }
    return btoa(binary);
  }
}

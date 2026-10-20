/* eslint-disable */
/**
 * MAIN world 执行器（页面上下文）。
 *
 * 由 background 通过 chrome.scripting 注入到页面主世界，接收 inject-bridge 转发来的
 * action，在页面自己的 JS 环境里执行，再把结果用 CustomEvent 送回。
 *
 * 支持的 action：
 *   ABM_EXECUTE_CODE           执行任意代码（源码里用 `args` 取参数）
 *   INIT_VIDEO_RECEIVER        初始化视频分片接收器（browser_set_video_to_page 用）
 *   VIDEO_CHUNK                接收一片视频数据，收齐后拼到 window 暂存
 *   SET_VIDEO_TO_INPUT         把拼好的视频写进 <input type="file">
 *   TRIGGER_FILE_INPUT_CHANGE  重新触发 file input 的 change/input（大型表单兜底）
 *   READ_WINDOW_PROPERTY       按点分路径读 window 上的值
 *   CALL_FUNCTION              调用 window 上的函数
 *
 * ⚠️ 本文件是经典脚本（不是模块），因为 MV3 的 world: MAIN 注入不支持 ES module。
 */

(() => {
  // 防止重复注入
  if (window.__BROWSER_MCP_MAIN_EXECUTOR_LOADED__) return;
  window.__BROWSER_MCP_MAIN_EXECUTOR_LOADED__ = true;

  const EVENT_NAME = {
    EXECUTE: 'abm:execute',
    RESPONSE: 'abm:response',
    CLEANUP: 'abm:cleanup',
  };

  /** 视频分片接收状态 */
  const videoReceiver = {
    chunks: [],
    totalChunks: 0,
    receivedChunks: 0,
    fileName: '',
    fileType: '',
  };

  /** base64 → Uint8Array */
  const base64ToUint8Array = (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  };

  /** 执行传入的代码，返回 { success, result } 或 { success:false, error } */
  const executeCode = async (code, args = {}) => {
    try {
      // 用 Function 构造器执行，便于拿到清晰的错误堆栈
      const fn = new Function(
        'args',
        `
        'use strict';
        ${code}
      `,
      );
      const result = await fn(args);
      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: { message: error.message, stack: error.stack, name: error.name },
      };
    }
  };

  /** 处理来自 inject-bridge 的执行请求 */
  const executionHandler = async (event) => {
    const {
      requestId,
      code,
      args,
      action,
      totalChunks,
      videoFileName,
      videoFileType,
      chunkIndex,
      chunkData,
    } = event.detail;

    try {
      let result;

      switch (action) {
        case 'ABM_INIT_VIDEO_RECEIVER':
          // 每次开始投递都重置接收器（分片按下标落位）
          videoReceiver.chunks = new Array(totalChunks);
          videoReceiver.totalChunks = totalChunks;
          videoReceiver.receivedChunks = 0;
          videoReceiver.fileName = videoFileName;
          videoReceiver.fileType = videoFileType;
          console.log(`[VideoReceiver] 初始化完成：${totalChunks} 片，文件 ${videoFileName}`);
          result = { success: true, result: { initialized: true, totalChunks } };
          break;

        case 'ABM_VIDEO_CHUNK': {
          if (!videoReceiver.chunks || videoReceiver.totalChunks === 0) {
            result = { success: false, error: { message: 'Video receiver not initialized' } };
            break;
          }

          const chunkBytes = base64ToUint8Array(chunkData);
          videoReceiver.chunks[chunkIndex] = chunkBytes;
          videoReceiver.receivedChunks++;
          console.log(
            `[VideoReceiver] 收到分片 ${chunkIndex + 1}/${videoReceiver.totalChunks}，${chunkBytes.length} 字节`,
          );

          if (videoReceiver.receivedChunks === videoReceiver.totalChunks) {
            // 收齐了：拼成完整字节并挂到 window，供 SET_VIDEO_TO_INPUT 取用
            let totalSize = 0;
            for (const chunk of videoReceiver.chunks) totalSize += chunk.length;

            const videoData = new Uint8Array(totalSize);
            let offset = 0;
            for (const chunk of videoReceiver.chunks) {
              videoData.set(chunk, offset);
              offset += chunk.length;
            }

            window.__browserMcpVideoData = videoData;
            window.__browserMcpVideoFileName = videoReceiver.fileName;
            window.__browserMcpVideoFileType = videoReceiver.fileType;
            console.log(`[VideoReceiver] 分片收齐，已组装 ${totalSize} 字节`);

            // 释放分片数组（本体已在 videoData 里）
            videoReceiver.chunks = [];
            result = { success: true, result: { complete: true, totalSize } };
          } else {
            result = {
              success: true,
              result: { received: chunkIndex + 1, total: videoReceiver.totalChunks },
            };
          }
          break;
        }

        case 'ABM_SET_VIDEO_TO_INPUT':
          // 只做基本的文件写入，避免触发会让页面上下文销毁的操作
          try {
            const { selector } = args;
            const videoData = window.__browserMcpVideoData;
            const fileName = window.__browserMcpVideoFileName;
            const fileType = window.__browserMcpVideoFileType;

            if (!videoData) {
              result = { success: false, error: { message: '视频数据未接收完成' } };
              break;
            }

            const inputElement = document.querySelector(selector);
            if (!inputElement) {
              result = { success: false, error: { message: `文件输入框未找到: ${selector}` } };
              break;
            }
            if (!(inputElement instanceof HTMLInputElement) || inputElement.type !== 'file') {
              result = { success: false, error: { message: '选择器指向的不是文件输入框' } };
              break;
            }

            const videoFile = new File([videoData], fileName, { type: fileType });
            console.log(`[SetVideoToInput] 创建文件: ${fileName}, 大小: ${videoFile.size}`);

            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(videoFile);
            inputElement.files = dataTransfer.files;

            // 留给 TRIGGER_FILE_INPUT_CHANGE 复用
            window.__browserMcpVideoFile = videoFile;
            window.__browserMcpDataTransfer = dataTransfer;
            console.log(`[SetVideoToInput] 已写入 input, files.length: ${inputElement.files.length}`);

            // 先回执成功，再异步派发 change/input：确保调用方先拿到响应
            result = {
              success: true,
              result: {
                fileSize: videoFile.size,
                fileName,
                filesSet: inputElement.files.length,
              },
            };

            setTimeout(() => {
              try {
                inputElement.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                console.log('[SetVideoToInput] change 事件已触发');
                inputElement.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                console.log('[SetVideoToInput] input 事件已触发');
              } catch (e) {
                console.error('[SetVideoToInput] 触发事件错误:', e);
              }
            }, 100);

            // 清掉临时字节（保留 File/DataTransfer 供后续复用）
            delete window.__browserMcpVideoData;
            delete window.__browserMcpVideoFileName;
            delete window.__browserMcpVideoFileType;
          } catch (setError) {
            console.error('[SetVideoToInput] 错误:', setError);
            result = { success: false, error: { message: setError.message } };
          }
          break;

        case 'TRIGGER_FILE_INPUT_CHANGE':
          // 某些上传组件只在 change 之后才读 files：重新触发一次
          try {
            const { selector } = args;
            const fileInput = document.querySelector(selector);
            if (!fileInput) {
              result = { success: false, error: { message: `文件输入框未找到: ${selector}` } };
              break;
            }

            const storedFile = window.__browserMcpVideoFile;
            const storedDataTransfer = window.__browserMcpDataTransfer;
            if (storedFile && storedDataTransfer) fileInput.files = storedDataTransfer.files;

            fileInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            console.log('[TriggerChange] change 事件已触发');
            fileInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            console.log('[TriggerChange] input 事件已触发');

            result = { success: true, result: { triggered: true, filesCount: fileInput.files?.length || 0 } };
          } catch (triggerError) {
            console.error('[TriggerChange] 错误:', triggerError);
            result = { success: false, error: { message: triggerError.message } };
          }
          break;

        case 'ABM_EXECUTE_CODE':
          result = await executeCode(code, args);
          break;

        case 'READ_WINDOW_PROPERTY': {
          // 按点分路径读 window 上的值（browser_read_page_data 走 ABM_EXECUTE_CODE）
          const path = args.path;
          let value = window;
          for (const key of path.split('.')) {
            if (key && value) value = value[key];
          }
          result = { success: true, result: value };
          break;
        }

        case 'CALL_FUNCTION': {
          // 调用 window 上的函数，如 args.functionPath = 'myApp.submit'
          const fnPath = args.functionPath;
          const fnArgs = args.arguments || [];
          let fn = window;
          for (const key of fnPath.split('.')) {
            if (key && fn) fn = fn[key];
          }
          if (typeof fn === 'function') {
            result = { success: true, result: await fn.apply(window, fnArgs) };
          } else {
            result = { success: false, error: { message: `${fnPath} is not a function` } };
          }
          break;
        }

        default:
          // 未知 action 按代码执行处理。
          result = await executeCode(code, args);
      }

      window.dispatchEvent(
        new CustomEvent(EVENT_NAME.RESPONSE, { detail: { requestId, data: result } }),
      );
    } catch (error) {
      window.dispatchEvent(
        new CustomEvent(EVENT_NAME.RESPONSE, {
          detail: { requestId, error: { message: error.message, stack: error.stack } },
        }),
      );
    }
  };

  window.addEventListener(EVENT_NAME.EXECUTE, executionHandler);

  /** 卸载：摘掉监听器与标记 */
  const cleanupHandler = () => {
    window.removeEventListener(EVENT_NAME.EXECUTE, executionHandler);
    window.removeEventListener(EVENT_NAME.CLEANUP, cleanupHandler);
    delete window.__BROWSER_MCP_MAIN_EXECUTOR_LOADED__;
    console.log('[ABM] main world executor cleaned up');
  };

  window.addEventListener(EVENT_NAME.CLEANUP, cleanupHandler);

  console.log('[ABM] main world executor loaded');
})();

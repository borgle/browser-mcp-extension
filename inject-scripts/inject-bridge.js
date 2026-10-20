/* eslint-disable */
/**
 * 注入桥（ISOLATED world）。
 *
 * 作用：在扩展的隔离环境与页面（MAIN world）之间搭一条通道——
 *   background ──chrome.tabs.sendMessage──▶ 本脚本 ──CustomEvent──▶ main-world-executor
 *   background ◀──sendResponse──────────── 本脚本 ◀──CustomEvent──  执行结果
 *
 * 为什么要绕这一圈：MV3 里 chrome.scripting 只能在扩展自己的隔离环境执行函数，
 * 直接改页面里的 window/调用页面函数需要把源码丢进 MAIN world 执行，而两个世界之间
 * 只能通过 DOM 事件（CustomEvent）通信。
 *
 * 事件名与 cleanup 指令要和 src/constants.js 的 INJECT_EVENT / INJECT_MSG 保持一致。
 */

(() => {
  // 防止重复注入（background 每次执行前会先发 cleanup 卸载旧的桥）
  if (window.__BROWSER_MCP_INJECT_BRIDGE_LOADED__) return;
  window.__BROWSER_MCP_INJECT_BRIDGE_LOADED__ = true;

  // 与本脚本、MAIN world 执行器共享的事件名
  const EVENT_NAME = {
    EXECUTE: 'abm:execute',
    RESPONSE: 'abm:response',
    CLEANUP: 'abm:cleanup',
  };

  // requestId -> sendResponse（等待 MAIN world 回结果）
  const pendingRequests = new Map();

  /**
   * 处理来自 background 的消息
   */
  const messageHandler = (request, _sender, sendResponse) => {
    // 卸载：通知 MAIN world 一起清理
    if (request.type === EVENT_NAME.CLEANUP) {
      window.dispatchEvent(new CustomEvent(EVENT_NAME.CLEANUP));
      sendResponse({ success: true });
      return true;
    }

    // 只有 MAIN world 的请求才需要转发
    if (request.targetWorld === 'MAIN' && request.type === 'ABM_EXECUTE_SCRIPT') {
      const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      pendingRequests.set(requestId, sendResponse);

      const detail = {
        action: request.action,
        code: request.code,
        args: request.args,
        requestId,
      };

      // 视频分片相关字段按需透传
      if (request.totalChunks !== undefined) detail.totalChunks = request.totalChunks;
      if (request.videoFileName !== undefined) detail.videoFileName = request.videoFileName;
      if (request.videoFileType !== undefined) detail.videoFileType = request.videoFileType;
      if (request.chunkIndex !== undefined) detail.chunkIndex = request.chunkIndex;
      if (request.chunkData !== undefined) detail.chunkData = request.chunkData;

      // 交给 MAIN world
      window.dispatchEvent(new CustomEvent(EVENT_NAME.EXECUTE, { detail }));

      // 告诉 background 会异步回执
      return true;
    }

    // 不处理的消息返回 false，避免 "The message port closed before a response was received"
    return false;
  };

  chrome.runtime.onMessage.addListener(messageHandler);

  /**
   * MAIN world 执行完成 → 把结果回给 background
   */
  const responseHandler = (event) => {
    const { requestId, data, error } = event.detail;
    if (pendingRequests.has(requestId)) {
      const sendResponse = pendingRequests.get(requestId);
      sendResponse({ data, error });
      pendingRequests.delete(requestId);
    }
  };

  window.addEventListener(EVENT_NAME.RESPONSE, responseHandler);

  /**
   * 卸载本桥：摘掉监听器、丢弃未完成请求、清掉标记
   */
  const cleanupHandler = () => {
    chrome.runtime.onMessage.removeListener(messageHandler);
    window.removeEventListener(EVENT_NAME.RESPONSE, responseHandler);
    window.removeEventListener(EVENT_NAME.CLEANUP, cleanupHandler);
    pendingRequests.clear();
    delete window.__BROWSER_MCP_INJECT_BRIDGE_LOADED__;
  };

  window.addEventListener(EVENT_NAME.CLEANUP, cleanupHandler);

  console.log('[ABM] inject bridge loaded');
})();

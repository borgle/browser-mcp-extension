/**
 * browser_network_intercept：用 CDP 抓取页面网络请求。
 *
 * 参数：
 *   cmd       必填：start | stop | list | detail
 *   tabId     目标标签页；start 缺省用活动标签，list/detail/stop 缺省用最近 start 的那个
 *   filter    list 时按 URL 包含过滤
 *   requestId detail 时指定请求
 *   compress  detail 的响应体 >50KB 时 gzip+base64 压缩（默认开）
 *
 * 说明：
 *   - start 会开启 Network 域并禁用缓存，随后记录 requestWillBeSent / responseReceived；
 *   - 抓到的请求只在内存里（Service Worker 生命周期内有效）；
 *   - stop 会恢复缓存并 detach 调试器。
 */
import { BaseTool } from './base.js';
import {
  attachDebugger,
  detachDebugger,
  isDebuggerAttached,
  sendCommand,
} from '../cdp.js';
import { gzipToBase64 } from '../utils.js';

/** 响应体超过这个长度才压缩 */
const COMPRESS_THRESHOLD = 51200;

/** tabId -> Map<requestId, {requestId,url,method,timestamp,status?,mimeType?}> */
const capturedRequests = new Map();
/** 正在拦截的标签页 */
const interceptingTabs = new Set();
/** CDP 事件监听器只装一次 */
let listenersInstalled = false;

function requestsOf(tabId) {
  let map = capturedRequests.get(tabId);
  if (!map) {
    map = new Map();
    capturedRequests.set(tabId, map);
  }
  return map;
}

function dropTab(tabId) {
  interceptingTabs.delete(tabId);
  capturedRequests.delete(tabId);
}

/** Service Worker 启动时注册一次：抓包事件 + 清理钩子 */
export function installNetworkInterceptListeners() {
  if (listenersInstalled) return;
  listenersInstalled = true;

  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source.tabId;
    if (!tabId || !interceptingTabs.has(tabId)) return;
    const requests = requestsOf(tabId);

    if (method === 'Network.requestWillBeSent') {
      requests.set(params.requestId, {
        requestId: params.requestId,
        url: params.request.url,
        method: params.request.method,
        timestamp: params.timestamp,
      });
    }
    if (method === 'Network.responseReceived') {
      const record = requests.get(params.requestId);
      if (record) {
        record.status = params.response.status;
        record.mimeType = params.response.mimeType;
      }
    }
  });

  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId) dropTab(source.tabId);
  });
}

export class NetworkInterceptTool extends BaseTool {
  name = 'browser_network_intercept';

  async execute(args) {
    const { cmd } = args;
    if (!cmd) return this.createErrorResult('cmd 参数必填 (start/stop/list/detail)');
    try {
      switch (cmd) {
        case 'start':
          return await this.start(args);
        case 'stop':
          return await this.stop(args);
        case 'list':
          return await this.list(args);
        case 'detail':
          return await this.detail(args);
        default:
          return this.createErrorResult(`未知的 cmd: ${cmd}`);
      }
    } catch (err) {
      return this.createErrorResult(err instanceof Error ? err.message : '网络拦截操作失败');
    }
  }

  async start(args) {
    const tabId = await this.resolveTabId(args.tabId, true);
    await attachDebugger(tabId);
    capturedRequests.set(tabId, new Map());
    interceptingTabs.add(tabId);
    await sendCommand(tabId, 'Network.enable');
    await sendCommand(tabId, 'Network.setCacheDisabled', { cacheDisabled: true });
    installNetworkInterceptListeners();
    return this.ok({ success: true, tabId, message: '网络拦截已启动' });
  }

  async stop(args) {
    const tabId = await this.resolveTabId(args.tabId, false);
    interceptingTabs.delete(tabId);
    if (isDebuggerAttached(tabId)) {
      try {
        await sendCommand(tabId, 'Network.setCacheDisabled', { cacheDisabled: false });
        await sendCommand(tabId, 'Network.disable');
      } catch {
        // 页面可能已经跳走，忽略
      }
      await detachDebugger(tabId);
    }
    capturedRequests.delete(tabId);
    return this.ok({ success: true, tabId, message: '网络拦截已停止' });
  }

  async list(args) {
    const tabId = await this.resolveTabId(args.tabId, false);
    let records = [...requestsOf(tabId).values()];
    if (args.filter) records = records.filter((item) => item.url.includes(args.filter));
    return this.ok({
      count: records.length,
      tabId,
      requests: records.map((item) => ({
        requestId: item.requestId,
        url: item.url,
        method: item.method,
        status: item.status,
        mimeType: item.mimeType,
      })),
    });
  }

  async detail(args) {
    const { requestId, compress } = args;
    if (!requestId) return this.createErrorResult('requestId 参数必填');
    const tabId = await this.resolveTabId(args.tabId, false);
    const record = requestsOf(tabId).get(requestId);
    if (!record) return this.createErrorResult(`请求 ${requestId} 未找到`);

    const response = await sendCommand(tabId, 'Network.getResponseBody', { requestId });
    let body = response.body;
    // JSON 响应尽量解析成对象，方便 AI 直接读字段
    if (!response.base64Encoded) {
      try {
        body = JSON.parse(response.body);
      } catch {
        // 不是 JSON，保留原文
      }
    }
    const text = typeof body === 'string' ? body : JSON.stringify(body);

    if (compress !== false && text.length > COMPRESS_THRESHOLD) {
      try {
        const compressed = await gzipToBase64(text);
        return this.ok({
          requestId: record.requestId,
          url: record.url,
          method: record.method,
          status: record.status,
          mimeType: record.mimeType,
          compressed: true,
          encoding: 'gzip+base64',
          originalSize: text.length,
          compressedSize: compressed.length,
          body: compressed,
        });
      } catch {
        // 压缩失败就退回明文
      }
    }

    return this.ok({
      requestId: record.requestId,
      url: record.url,
      method: record.method,
      status: record.status,
      mimeType: record.mimeType,
      compressed: false,
      body,
    });
  }

  /**
   * 定位操作对象：显式 tabId > 正在拦截的第一个标签页；
   * allowActive 为 true（start）时可以在都没有的情况下退回活动标签。
   */
  async resolveTabId(tabId, allowActive) {
    if (tabId) return tabId;
    const intercepting = interceptingTabs.values().next().value;
    if (intercepting !== undefined) return intercepting;
    if (!allowActive) throw new Error('没有正在拦截的标签页，请先调用 start 或指定 tabId');
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!activeTab?.id) throw new Error('无法找到目标标签页');
    return activeTab.id;
  }

  /** 网络拦截的结果统一是成功文本 */
  ok(payload) {
    return this.createTextResult(JSON.stringify(payload));
  }

  /** 标签页消失时清理拦截状态（由 background 入口挂到 CDP 生命周期钩子上） */
  static cleanupTab(tabId) {
    dropTab(tabId);
  }
}

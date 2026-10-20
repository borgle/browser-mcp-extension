/**
 * 工具注册表：工具名 → 实例。
 *
 * ABM 网关通过 `tool.invoke` 下发工具名和参数，这里完成注册与执行。
 *
 * 工具清单（19 个；服务端共 21 个，browser_stage_video 与 browser_send_notice
 * 由服务端处理，不注册到扩展；工具名与服务端 abm_server/mcp_tools.py 同步）：
 *   browser_inject_script              在页面主环境执行任意 JS
 *   browser_read_page_data             读取 window 上的点分路径
 *   browser_navigate                打开/复用标签并等待加载
 *   browser_control                标签页增删改查/激活
 *   browser_extract_data            元素/ window / document 数据提取
 *   browser_click                   点击元素（可带文本匹配）
 *   browser_fill                    填充输入框 / contenteditable
 *   browser_keyboard                发送按键序列
 *   browser_upload_file             base64 → file input（单文件）
 *   browser_set_files               base64 → file input（多文件）
 *   browser_set_files_from_urls     扩展下载 URL 图片 → file input
 *   browser_wait_elements           等待元素达到指定数量
 *   browser_set_video_to_page       暂存区视频 → file input
 *   browser_download_video_from_url 扩展下载视频 URL → 暂存区
 *   browser_network_intercept       CDP 网络抓包
 *   browser_mouse_click             CDP 真实鼠标点击
 *   browser_mouse_scroll            CDP 滚轮滚动
 *   browser_input_sequence          CDP 输入事件回放
 *   browser_set_files_native        CDP 注入本机文件路径
 */
import { ERR } from '../constants.js';
import { InjectScriptTool } from './inject-script.js';
import { ReadPageDataTool } from './read-page-data.js';
import { NavigateTool } from './navigate.js';
import { BrowserControlTool } from './browser-control.js';
import { ExtractDataTool } from './extract-data.js';
import { ClickTool } from './click.js';
import { FillTool } from './fill.js';
import { KeyboardTool } from './keyboard.js';
import { UploadFileTool } from './upload-file.js';
import { SetFilesTool } from './set-files.js';
import { SetFilesFromUrlsTool } from './set-files-from-urls.js';
import { WaitElementsTool } from './wait-elements.js';
import { SetVideoToPageTool } from './set-video-to-page.js';
import { DownloadVideoFromUrlTool } from './download-video-from-url.js';
import { NetworkInterceptTool } from './network-intercept.js';
import { MouseClickTool } from './mouse-click.js';
import { MouseScrollTool } from './mouse-scroll.js';
import { InputSequenceTool } from './input-sequence.js';
import { SetFilesNativeTool } from './set-files-native.js';

/** name → 工具实例 */
const registry = new Map();

export function registerTool(tool) {
  registry.set(tool.name, tool);
}

/** 已注册的工具名（调试/popup 展示用） */
export function listToolNames() {
  return [...registry.keys()];
}

/** 注册全部内置工具 */
export function registerBuiltinTools() {
  for (const tool of [
    new InjectScriptTool(),
    new ReadPageDataTool(),
    new NavigateTool(),
    new BrowserControlTool(),
    new ExtractDataTool(),
    new ClickTool(),
    new FillTool(),
    new KeyboardTool(),
    new UploadFileTool(),
    new SetFilesTool(),
    new SetFilesFromUrlsTool(),
    new WaitElementsTool(),
    new SetVideoToPageTool(),
    new DownloadVideoFromUrlTool(),
    new NetworkInterceptTool(),
    new MouseClickTool(),
    new MouseScrollTool(),
    new InputSequenceTool(),
    new SetFilesNativeTool(),
  ]) {
    registerTool(tool);
  }
}

/**
 * 执行工具调用（供 WS 客户端调用）。
 * @param {{name: string, args?: object}} call
 * @returns {Promise<{content: Array<{type: string, text: string}>, isError: boolean}>}
 */
export async function executeTool(call) {
  const { name, args } = call || {};
  const tool = registry.get(name);
  if (!tool) return { content: [{ type: 'error', text: `Tool not found: ${name}` }], isError: true };
  try {
    return await tool.execute(args);
  } catch (err) {
    return {
      content: [{ type: 'error', text: err instanceof Error ? err.message : ERR.toolFailed }],
      isError: true,
    };
  }
}

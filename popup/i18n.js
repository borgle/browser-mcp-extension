import { STORAGE_KEY } from '../src/constants.js';

export const translations = {
  en: {
    "app.title": "ABM Browser Assistant",
    "tabs.overview": "Overview",
    "tabs.permissions": "Permissions",
    "tabs.about": "About",
    "tabs.aria": "Views",
    "status.checking": "Checking",
    "deck.title": "Browser channel",
    "field.server": "Server",
    "field.serverUrl": "Server URL",
    "field.accessKey": "Access key",
    "field.apiKey": "API Key",
    "field.extensionId": "Extension ID",
    "action.edit": "Edit",
    "action.save": "Save",
    "action.cancel": "Cancel",
    "action.connect": "Connect",
    "action.disconnect": "Disconnect",
    "action.copy": "Copy",
    "action.show": "Show",
    "action.hide": "Hide",
    "action.add": "Add",
    "action.manageKeys": "Manage keys ↗",
    "action.openAccount": "Open account",
    "aria.toggleKey": "Show or hide API key",
    "placeholder.server": "https://your-abm-server",
    "placeholder.apiKey": "Enter your API key",
    "placeholder.host": "Enter a domain, e.g. example.com",
    "hint.apiKey":
      "The key stays in this browser. Extension connections, the video bridge, and MCP OAuth use it to identify your browser.",
    "switch.autoReconnect": "Auto-reconnect",
    "switch.autoReconnectHint": "Recover after suspension",
    "switch.allHosts": "Allow all websites",
    "onboarding.title": "Connect your browser to ABM",
    "onboarding.step1a": "Open the ",
    "onboarding.step1Link": "ABM console",
    "onboarding.step1b": " and create an API key",
    "onboarding.step2": "Click Edit next to Access key above, then paste the key",
    "onboarding.step3": "For a self-hosted server, edit the Server URL first, then click Connect",
    "onboarding.fillKey": "Enter API key",
    "notices.title": "Notifications",
    "permissions.title": "Download permissions",
    "permissions.hint":
      "The extension needs host permission when it downloads files itself (video URL delivery, URL images). The local backend (<code>127.0.0.1</code> / <code>localhost</code>) is granted at install time, marked <strong>Built-in</strong>, and cannot be removed. Add other sites as needed, and remove them at any time.",
    "permissions.countAll": "All websites allowed",
    "permissions.count": "{custom} custom · {builtin} built-in",
    "permissions.allPlaceholder": "All websites are allowed; no need to add",
    "permissions.hostPlaceholder": "Enter a domain, e.g. example.com",
    "permissions.allAllowed": "All websites allowed",
    "permissions.noCustom": "No custom domains yet",
    "permissions.builtinTag": "Built-in",
    "permissions.builtinTitle": "Granted at install time; cannot be removed",
    "permissions.removeAria": "Remove {host}",
    "about.title": "The browser is the new interface",
    "about.body":
      "ABM stands for <strong>a browser mcp</strong>. The extension connects your browser to AI through MCP, enabling navigation, clicks, forms, data extraction, network inspection, and file delivery.",
    "about.docsTitle": "Guide",
    "about.docsMeta": "Install, connect, 23 tools, and integration steps",
    "about.resourcesTitle": "Docs & support",
    "about.repoTitle": "GitHub repository",
    "about.issuesTitle": "Issues",
    "about.issuesMeta": "Report a bug or request a feature",
    "about.shortcutsTitle": "Shortcuts",
    "about.bridgeTitle": "Open video bridge",
    "footer.capabilities": "23 browser capabilities",
    "status.connected": "Connected",
    "status.connecting": "Connecting",
    "status.reconnecting": "Reconnecting",
    "status.rejected": "Key rejected",
    "status.disconnected": "Disconnected",
    "key.notConfigured": "Not configured",
    "bridge.notConfigured": "Configure the server first",
    "error.keyRejected":
      "This API Key is invalid or revoked. Automatic reconnect has stopped.",
    "error.connectionPrefix": "Connection error: {message}",
    "toast.serverRequired": "Enter a server URL",
    "toast.unchanged": "No changes",
    "toast.saving": "Saving…",
    "toast.saveFailed": "Save failed",
    "toast.savedDisconnected": "Saved. The connection was closed; reconnect.",
    "toast.saved": "Saved",
    "toast.autoOn": "Auto-reconnect enabled",
    "toast.autoOff": "Auto-reconnect disabled",
    "toast.finishEditing": "Save or cancel the open editor first",
    "toast.keyRequired": "Enter an API Key first",
    "toast.connecting": "Connecting…",
    "toast.connectStarted": "Connection started",
    "toast.connectFailed": "Connection failed",
    "toast.disconnected": "Disconnected",
    "toast.operationFailed": "Operation failed. Try again.",
    "permissions.removed": "Removed {host}",
    "permissions.removeFailed": "Remove failed: {error}",
    "permissions.allNoAdd": "All websites are allowed; no need to add individually",
    "permissions.enterHost": "Enter a domain",
    "permissions.granting": "Granting…",
    "permissions.granted": "Granted {host}",
    "permissions.grantFailed": "Grant failed: {error}",
    "permissions.revokeFailed": "Revoke failed: {error}",
    "permissions.allGranted": "All websites granted",
    "permissions.allRevoked": "All website permissions revoked",
    "notices.empty": "No notifications",
    "notices.details": "Details",
    "notices.openLink": "Open related link",
    "notices.markRead": "Read",
    "notices.markReadTitle": "Mark as read",
    "notices.remove": "Remove",
    "notices.removeTitle": "Remove this notification",
    "copy.idCopied": "Extension ID copied",
    "copy.failed": "Copy failed; select it manually",
    "relative.justNow": "Just now",
    "relative.minutes": "{count} min ago",
    "relative.hours": "{count} hr ago",
    "error.generic": "Operation failed. Try again.",
    "error.apiKeyRequired": "Enter an API Key first.",
    "error.websocket": "WebSocket connection failed.",
    "error.readyTimeout": "Timed out waiting for the server to be ready.",
    "error.cancelled": "Connection cancelled.",
    "error.serverScheme": "Server URL must use http://, https://, ws://, or wss://.",
    "error.permissionDenied":
      "Permission was not granted (cancelled by the browser or user).",
    "error.unknownMessage": "Unknown message type.",
    "error.connectionClosed": "Extension connection closed.",
    "error.noResponse": "No response from the extension background.",
    "error.invalidDomain": "Invalid domain, e.g. example.com.",
    "error.invalidDomainPort": "Invalid domain (ports and IPv6 are not supported).",
    "error.domainTooLong": "Domain is too long.",
    "error.localHost": "Local addresses are built in; no need to add.",
    "error.invalidIp": "Invalid IP address.",
  },
  zh: {
    "app.title": "ABM 浏览器助手",
    "tabs.overview": "概览",
    "tabs.permissions": "权限",
    "tabs.about": "关于",
    "tabs.aria": "视图切换",
    "status.checking": "检测中",
    "deck.title": "浏览器通道",
    "field.server": "服务端",
    "field.serverUrl": "服务器地址",
    "field.accessKey": "访问密钥",
    "field.apiKey": "API Key",
    "field.extensionId": "扩展 ID",
    "action.edit": "编辑",
    "action.save": "保存",
    "action.cancel": "取消",
    "action.connect": "连接",
    "action.disconnect": "断开",
    "action.copy": "复制",
    "action.show": "显示",
    "action.hide": "隐藏",
    "action.add": "添加",
    "action.manageKeys": "管理密钥 ↗",
    "action.openAccount": "打开账号管理",
    "aria.toggleKey": "显示或隐藏 API Key",
    "placeholder.server": "https://your-abm-server",
    "placeholder.apiKey": "输入你的 API Key",
    "placeholder.host": "输入域名，如 example.com",
    "hint.apiKey":
      "Key 只保存在当前浏览器。扩展连接、视频桥与 MCP OAuth 授权都通过它识别你的浏览器。",
    "switch.autoReconnect": "断线自动重连",
    "switch.autoReconnectHint": "扩展被回收后自动恢复",
    "switch.allHosts": "一键允许所有网站",
    "onboarding.title": "把浏览器接入 ABM",
    "onboarding.step1a": "打开 ",
    "onboarding.step1Link": "ABM 管理台",
    "onboarding.step1b": "，注册并创建 API Key",
    "onboarding.step2": "点击上方「访问密钥」右侧的「编辑」，粘贴 Key",
    "onboarding.step3": "如使用自建服务，先编辑「服务端」地址，再点「连接」",
    "onboarding.fillKey": "填写 API Key",
    "notices.title": "通知",
    "permissions.title": "下载权限",
    "permissions.hint":
      "扩展自己下载文件（视频 URL 通道、按 URL 取图）时需要域名授权。本机后端（<code>127.0.0.1</code> / <code>localhost</code>）安装时已授予，标为「内置」且不可移除。其他站点可自行添加，也可以随时移除。",
    "permissions.countAll": "已授权所有域名",
    "permissions.count": "{custom} 个自定义 · 内置 {builtin} 个",
    "permissions.allPlaceholder": "已允许所有网站，无需添加",
    "permissions.hostPlaceholder": "输入域名，如 example.com",
    "permissions.allAllowed": "已允许所有网站",
    "permissions.noCustom": "还没有自定义域名",
    "permissions.builtinTag": "内置",
    "permissions.builtinTitle": "扩展安装时已授权，不可移除",
    "permissions.removeAria": "移除 {host}",
    "about.title": "浏览器是新的接口",
    "about.body":
      "ABM 是 <strong>a browser mcp</strong> 的简称。扩展通过 MCP 协议把用户浏览器安全接入 AI，提供导航、点击、填表、数据提取、网络抓包和文件投递能力。",
    "about.docsTitle": "使用说明",
    "about.docsMeta": "安装、连接、23 个工具清单与联调步骤",
    "about.resourcesTitle": "文档与支持",
    "about.repoTitle": "GitHub 仓库",
    "about.issuesTitle": "问题反馈",
    "about.issuesMeta": "提交 issue 或功能建议",
    "about.shortcutsTitle": "快捷入口",
    "about.bridgeTitle": "打开视频桥页面",
    "footer.capabilities": "23 项浏览器能力",
    "status.connected": "已连接",
    "status.connecting": "连接中",
    "status.reconnecting": "重连中",
    "status.rejected": "Key 已失效",
    "status.disconnected": "未连接",
    "key.notConfigured": "未配置",
    "bridge.notConfigured": "（需先配置服务器地址）",
    "error.keyRejected": "这把 API Key 已失效或被吊销，自动重连已停止。",
    "error.connectionPrefix": "连接错误：{message}",
    "toast.serverRequired": "请填写服务器地址",
    "toast.unchanged": "没有改动",
    "toast.saving": "保存中…",
    "toast.saveFailed": "保存失败",
    "toast.savedDisconnected": "已保存，连接已断开，请重新连接",
    "toast.saved": "已保存",
    "toast.autoOn": "已开启自动重连",
    "toast.autoOff": "已关闭自动重连",
    "toast.finishEditing": "请先保存或取消正在编辑的设置",
    "toast.keyRequired": "请先填写 API Key",
    "toast.connecting": "连接中…",
    "toast.connectStarted": "已发起连接",
    "toast.connectFailed": "连接失败",
    "toast.disconnected": "已断开连接",
    "toast.operationFailed": "操作失败，请重试",
    "permissions.removed": "已移除 {host}",
    "permissions.removeFailed": "移除失败：{error}",
    "permissions.allNoAdd": "已允许所有网站，无需单独添加",
    "permissions.enterHost": "请输入域名",
    "permissions.granting": "授权中…",
    "permissions.granted": "已授权 {host}",
    "permissions.grantFailed": "授权失败：{error}",
    "permissions.revokeFailed": "撤销失败：{error}",
    "permissions.allGranted": "已授权所有域名",
    "permissions.allRevoked": "已撤销所有域名授权",
    "notices.empty": "暂无通知",
    "notices.details": "详情",
    "notices.openLink": "打开相关链接",
    "notices.markRead": "已读",
    "notices.markReadTitle": "标记已读",
    "notices.remove": "移除",
    "notices.removeTitle": "移除这条通知",
    "copy.idCopied": "扩展 ID 已复制",
    "copy.failed": "复制失败，请手动选择",
    "relative.justNow": "刚刚",
    "relative.minutes": "{count} 分钟前",
    "relative.hours": "{count} 小时前",
    "error.generic": "操作失败，请重试。",
    "error.apiKeyRequired": "请先填写 API Key",
    "error.websocket": "WebSocket 连接失败",
    "error.readyTimeout": "等待 session.ready 超时",
    "error.cancelled": "连接已取消",
    "error.serverScheme": "服务器地址必须使用 http://、https://、ws:// 或 wss://",
    "error.permissionDenied": "未授予权限（可能被浏览器或用户取消）",
    "error.unknownMessage": "未知消息类型",
    "error.connectionClosed": "扩展连接已关闭。",
    "error.noResponse": "后台无响应",
    "error.invalidDomain": "域名格式不正确，例如 example.com",
    "error.invalidDomainPort": "域名格式不正确（暂不支持端口和 IPv6）",
    "error.domainTooLong": "域名过长",
    "error.localHost": "本机地址已内置，无需添加",
    "error.invalidIp": "IP 地址格式不正确",
  },
};

let language = "zh";
const listeners = new Set();

const ERROR_MESSAGES = {
  "请先填写 API Key": "error.apiKeyRequired",
  "WebSocket 连接失败": "error.websocket",
  "等待 session.ready 超时": "error.readyTimeout",
  "连接已取消": "error.cancelled",
  "服务器地址必须使用 http://、https://、ws:// 或 wss://": "error.serverScheme",
  "未授予权限（可能被浏览器或用户取消）": "error.permissionDenied",
  "未知消息类型": "error.unknownMessage",
  "扩展连接已关闭。": "error.connectionClosed",
  "扩展连接已断开。": "error.connectionClosed",
  "后台无响应": "error.noResponse",
  "请输入域名，例如 example.com": "error.invalidDomain",
  "域名格式不正确（暂不支持端口和 IPv6）": "error.invalidDomainPort",
  "域名过长": "error.domainTooLong",
  "本机地址已内置，无需添加": "error.localHost",
  "域名格式不正确，例如 example.com": "error.invalidDomain",
  "IP 地址格式不正确": "error.invalidIp",
};

export function t(key, values) {
  let value = translations[language]?.[key];
  if (typeof value !== "string") return key;
  if (values) {
    for (const [name, replacement] of Object.entries(values)) {
      value = value.replaceAll(`{${name}}`, String(replacement));
    }
  }
  return value;
}

export function currentLanguage() {
  return language;
}

export function getLocale() {
  return language === "zh" ? "zh-CN" : "en-US";
}

export function onLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function detectLanguage() {
  try {
    const ui = chrome.i18n?.getUILanguage?.() || navigator.language || "en";
    return String(ui).toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}

function applyLanguage(next) {
  language = next === "en" ? "en" : "zh";
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.title = t("app.title");

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const value = translations[language]?.[element.dataset.i18n];
    if (typeof value === "string") element.textContent = value;
  });
  document.querySelectorAll("[data-i18n-html]").forEach((element) => {
    const value = translations[language]?.[element.dataset.i18nHtml];
    if (typeof value === "string") element.innerHTML = value;
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    const value = translations[language]?.[element.dataset.i18nPlaceholder];
    if (typeof value === "string") element.placeholder = value;
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    const value = translations[language]?.[element.dataset.i18nAriaLabel];
    if (typeof value === "string") element.setAttribute("aria-label", value);
  });
  document.querySelectorAll("[data-lang]").forEach((button) => {
    const active = button.dataset.lang === language;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  try {
    void chrome.storage.local.set({ [STORAGE_KEY.language]: language });
  } catch {
    // Storage unavailable: the current popup still switches.
  }

  for (const listener of listeners) {
    listener(language);
  }
}

export async function initPopupLanguage() {
  let saved = "";
  try {
    saved = (await chrome.storage.local.get(STORAGE_KEY.language))[STORAGE_KEY.language] || "";
  } catch {
    // Storage unavailable; fall back to the browser language.
  }
  const initial = saved === "zh" || saved === "en" ? saved : detectLanguage();
  applyLanguage(initial);
  document.querySelectorAll("[data-lang]").forEach((button) => {
    button.addEventListener("click", () => applyLanguage(button.dataset.lang));
  });
  return language;
}

export function setLanguage(next) {
  applyLanguage(next);
}

export function localizeError(message) {
  if (!message) return t("error.generic");
  if (language === "zh") return message;
  const key = ERROR_MESSAGES[message];
  if (key) return t(key);
  if (/[\u4e00-\u9fff]/.test(message)) return t("error.generic");
  return message;
}

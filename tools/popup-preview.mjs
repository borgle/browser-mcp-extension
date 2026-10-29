/**
 * 生成 popup 预览页：把 popup 的 HTML/CSS/JS 打包成单文件，并注入一套假的 chrome API。
 *
 * 用途：popup 只能在 chrome-extension:// 里打开（浏览器策略不允许自动化访问），
 * 这个预览页把它搬到 http 下，用假数据驱动，便于设计走查与截图核对。
 * 产物写到后端的静态目录（被 .gitignore 忽略），用浏览器打开即可。
 *
 * 运行：npm run preview
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, 'build', 'popup-preview.html');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

/** 去掉 import 语句（模块会被拼进同一个作用域），保留其余代码 */
function stripImports(source) {
  return source.replace(/^\s*import\s[^;]*;\s*$/gm, '');
}

const css = read('popup/popup.css');
const html = read('popup/popup.html');
const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
if (!bodyMatch) throw new Error('popup.html 结构变了：找不到 <body>');
const bodyHtml = bodyMatch[1].replace(/<script[^>]*><\/script>/, '');

// 预览页是从后端静态目录提供的，扩展目录里的图片取不到 —— 把引用的图标内联成 data URI，
// 这样预览效果和真实 popup 一致（否则头部图标会是个碎图）。
const inlinedBodyHtml = bodyHtml.replace(/src="\.\.\/icons\/([^"]+)"/g, (whole, name) => {
  const file = path.join(root, 'icons', name);
  if (!fs.existsSync(file)) return whole; // 图标不存在就保持原样，方便看出问题
  const mime = name.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
  return `src="data:${mime};base64,${fs.readFileSync(file).toString('base64')}"`;
});

// 依赖顺序：常量 → 消息类型 → 通知 → popup 的 API 封装 / 权限封装 → 主逻辑
const BUNDLE_FILES = [
  'src/constants.js',
  'src/message-types.js',
  'src/notices/manager.js',
  'popup/api.js',
  'src/permissions/host-input.js',
  'popup/permissions-ui.js',
  'popup/i18n.js',
  'popup/popup.js',
];

// 自检：popup 源码里出现的相对 import 必须都在打包清单里，否则预览页会因为
// 「函数未定义」静默失效（踩过一次：漏加 permissions-ui.js）。
const imported = new Set();
for (const file of BUNDLE_FILES) {
  for (const match of read(file).matchAll(/^\s*import[^;]*from\s+['"](\.[^'"]+)['"]/gm)) {
    imported.add(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1])));
  }
}
const missing = [...imported].filter((file) => !BUNDLE_FILES.includes(file));
if (missing.length > 0) {
  throw new Error(`预览打包清单缺少依赖：${missing.join(', ')}（请加进 BUNDLE_FILES）`);
}

const bundle = BUNDLE_FILES
  .map((file) => `\n/* ==================== ${file} ==================== */\n${stripImports(read(file))}`)
  .join('\n');

const chromeStub = `
/* ==================== 假 chrome API（仅预览用） ==================== */
const previewState = {
  config: { serverBaseUrl: 'http://127.0.0.1:18050', apiKey: 'abm_demo_key', autoReconnect: true },
  status: { connected: true, serverBaseUrl: 'http://127.0.0.1:18050', reconnecting: false, authRejected: false, lastUpdated: Date.now() },
  permissions: { allHostsAuthorized: false, authorizedHosts: ['cdn.example.com'], failNextRequest: false },
  storage: new Map([
    ['abm.lang', 'zh'],
    ['abm.notice:n_demo_1', { id: 'n_demo_1', title: '视频投递完成', level: 'info', body: 'demo.mp4 已存入扩展暂存区', receivedAt: Date.now() - 120000, read: false }],
    ['abm.notice:n_demo_2', { id: 'n_demo_2', title: '账号提示', level: 'warning', body: '请到 ABM 管理台检查账号状态', actionUrl: 'https://borgle.io', receivedAt: Date.now() - 5400000, read: false }],
    ['abm.notice:n_demo_3', { id: 'n_demo_3', title: '下载权限已更新', level: 'info', body: '已添加 cdn.example.com', receivedAt: Date.now() - 86400000, read: true }],
  ]),
  listeners: [],
};

function pickStorage(keys) {
  if (keys === null || keys === undefined) {
    return Object.fromEntries(previewState.storage);
  }
  if (typeof keys === 'string') return previewState.storage.has(keys) ? { [keys]: previewState.storage.get(keys) } : {};
  if (Array.isArray(keys)) {
    const out = {};
    for (const key of keys) if (previewState.storage.has(key)) out[key] = previewState.storage.get(key);
    return out;
  }
  const out = {};
  for (const [key, fallback] of Object.entries(keys || {})) {
    out[key] = previewState.storage.has(key) ? previewState.storage.get(key) : fallback;
  }
  return out;
}

globalThis.chrome = {
  runtime: {
    getManifest: () => ({
      version: '2.0.3',
      // 与真实 manifest 一致：桥来源判定以这份列表为准
      externally_connectable: {
        matches: ['https://*.borgle.io/*', 'https://borgle.io/*', 'http://localhost:*/*', 'http://127.0.0.1:*/*'],
      },
    }),
    id: 'dklmcgbmpnmkndhapabinagmmdmjhjgl',
    onMessage: { addListener: (fn) => previewState.listeners.push(fn) },
    sendMessage: (message, callback) => {
      setTimeout(() => {
        const type = message?.type;
        const reply = (payload) => callback && callback(payload);
        if (type === 'abm.popup.getConfig') return reply({ success: true, config: previewState.config });
        if (type === 'abm.popup.saveConfig') {
          const patch = message.payload || {};
          previewState.config = { ...previewState.config, ...patch };
          if (patch.serverBaseUrl !== undefined || patch.apiKey !== undefined) {
            previewState.status = {
              ...previewState.status,
              connected: false,
              reconnecting: false,
              serverBaseUrl: previewState.config.serverBaseUrl,
            };
          }
          return reply({ success: true, config: previewState.config });
        }
        if (type === 'abm.popup.getStatus') return reply({ success: true, status: previewState.status });
        if (type === 'abm.popup.connect') {
          previewState.status = { ...previewState.status, connected: true, authRejected: false, lastError: undefined };
          return reply({ success: true });
        }
        if (type === 'abm.popup.disconnect') {
          previewState.status = { ...previewState.status, connected: false, reconnecting: false };
          return reply({ success: true });
        }
        if (type === 'abm.popup.getPermissionStatus') return reply({ success: true, status: previewState.permissions });
        if (type === 'abm.popup.requestAllHosts') {
          previewState.permissions.allHostsAuthorized = true;
          return reply({ success: true });
        }
        if (type === 'abm.popup.revokeAllHosts') {
          previewState.permissions.allHostsAuthorized = false;
          return reply({ success: true });
        }
        if (type === 'abm.popup.addHost') {
          const host = message.payload?.domain;
          if (host && !previewState.permissions.authorizedHosts.includes(host)) {
            previewState.permissions.authorizedHosts.push(host);
          }
          return reply({ success: true });
        }
        if (type === 'abm.popup.addHostToStorage') {
          const host = message.payload?.domain;
          if (host && !previewState.permissions.authorizedHosts.includes(host)) {
            previewState.permissions.authorizedHosts.push(host);
          }
          return reply({ success: true });
        }
        if (type === 'abm.popup.removeHost') {
          previewState.permissions.authorizedHosts = previewState.permissions.authorizedHosts.filter(
            (item) => item !== message.payload?.domain,
          );
          return reply({ success: true });
        }
        return reply({ success: true });
      }, 120);
    },
  },
  storage: {
    local: {
      get: (keys) => Promise.resolve(pickStorage(keys)),
      set: (entries) => {
        for (const [key, value] of Object.entries(entries)) previewState.storage.set(key, value);
        return Promise.resolve();
      },
      remove: (keys) => {
        for (const key of [].concat(keys)) previewState.storage.delete(key);
        return Promise.resolve();
      },
    },
  },
  tabs: { create: ({ url }) => { window.open(url, '_blank', 'noopener'); } },
  action: { setBadgeText: () => Promise.resolve(), setBadgeBackgroundColor: () => Promise.resolve() },
  permissions: {
    contains: ({ origins = [] }) =>
      Promise.resolve(origins.includes('<all_urls>') ? previewState.permissions.allHostsAuthorized : false),
    request: ({ origins = [] }) => {
      if (previewState.permissions.failNextRequest) {
        previewState.permissions.failNextRequest = false;
        return Promise.reject(new Error('This function must be called during a user gesture'));
      }
      if (origins.includes('<all_urls>')) previewState.permissions.allHostsAuthorized = true;
      return Promise.resolve(true);
    },
    remove: ({ origins = [] }) => {
      if (origins.includes('<all_urls>')) previewState.permissions.allHostsAuthorized = false;
      return Promise.resolve(true);
    },
    getAll: () =>
      Promise.resolve({
        origins: [
          'https://*.xiaohongshu.com/*',
          // 注意：这段代码会被塞进外层模板字符串里，所以内部不能用反引号
          ...previewState.permissions.authorizedHosts.flatMap((host) => [
            'https://*.' + host + '/*',
            'https://' + host + '/*',
          ]),
          ...(previewState.permissions.allHostsAuthorized ? ['<all_urls>'] : []),
        ],
      }),
  },
};

/** 预览工具条：模拟几种连接状态，方便走查告警样式 */
window.__previewSetStatus = (status) => {
  previewState.status = { ...previewState.status, ...status };
  for (const listener of previewState.listeners) {
    listener({ type: 'ABM_SERVER_STATUS_CHANGED', payload: previewState.status });
  }
};
window.__previewFailNextPermissionRequest = () => {
  previewState.permissions.failNextRequest = true;
};
`;

const toolbar = `
<div style="position:fixed;left:0;right:0;bottom:0;display:flex;gap:6px;flex-wrap:wrap;justify-content:center;padding:8px;background:#0009;color:#fff;font:12px system-ui;backdrop-filter:blur(6px)">
  <span style="opacity:.7;align-self:center">预览工具条（假数据）：</span>
  <button onclick="__previewSetStatus({connected:true,reconnecting:false,authRejected:false,lastError:undefined})">已连接</button>
  <button onclick="__previewSetStatus({connected:false,reconnecting:false,authRejected:false,lastError:'WebSocket 连接失败'})">未连接</button>
  <button onclick="__previewSetStatus({connected:false,reconnecting:true})">重连中</button>
  <button onclick="__previewSetStatus({connected:false,reconnecting:false,authRejected:true,lastError:'API Key 已失效'})">Key 失效</button>
  <button onclick="__previewFailNextPermissionRequest()">模拟权限被拒</button>
</div>
<style>body{padding-bottom:56px}</style>
`;

const outputHtml = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>popup 预览 · ABM 浏览器助手</title>
    <style>
${css}
      /* 预览页专用：把 popup 的固定宽度居中显示，并留出工具条空间 */
      body { width: auto; display: flex; justify-content: center; background: #6b7280; }
      .app-host { width: 380px; }
    </style>
  </head>
  <body>
    <div class="app-host">
${inlinedBodyHtml}
    </div>
${toolbar}
    <script type="module">
${chromeStub}
${bundle}
    </script>
  </body>
</html>
`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, outputHtml);
console.log(`已生成预览页：${output}`);
console.log('用浏览器直接打开该文件即可预览 popup。');

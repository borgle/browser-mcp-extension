/**
 * popup 交互逻辑（原生 JS，无构建步骤）。
 *
 * 视图划分（顶部固定品牌与状态胶囊，下面三个视图切换）：
 *   概览：连接状态 + 就地编辑的服务器/API Key + 主操作 + 通知 —— 平时只要看这一屏
 *   设置：下载权限 —— 只有要调整域名授权时才进来
 *   关于：简介 / 文档与仓库链接 / 视频桥快捷入口
 *
 * 交互约定：异步动作有 busy → toast 反馈；服务器和 API Key 点「编辑」后就地修改。
 */
import { api } from './api.js';
import { POPUP_MSG } from '../src/message-types.js';
import { listNotices, markNoticeRead, removeNotice } from '../src/notices/manager.js';
import {
  PROJECT_LINKS,
  SERVICE_HOME,
  portalUrl,
} from '../src/constants.js';
import { grantHost, requestAllHosts, revokeAllHosts, revokeHost } from './permissions-ui.js';
import { BUILT_IN_HOSTS } from '../src/permissions/host-input.js';

const $ = (id) => document.getElementById(id);

/** 状态 → 胶囊样式与文案 */
const STATUS_STYLE = {
  connected: ['ok', '已连接'],
  connecting: ['warn', '连接中'],
  reconnecting: ['warn', '重连中'],
  rejected: ['err', 'Key 已失效'],
  disconnected: ['', '未连接'],
};

const VIEWS = ['overview', 'settings', 'about'];

/** 已保存的连接配置；就地编辑保存后同步更新 */
let currentConfig = {};
/** 最近一次连接状态，供保存配置时判断是否需要提示重新连接 */
let lastStatus = {};
/** 当前展开的编辑器：'' | 'server' | 'key' */
let activeEditor = '';

// ---------------------------------------------------------------- 反馈

function toast(message, level) {
  const el = document.createElement('div');
  el.className = `toast${level ? ` ${level}` : ''}`;
  el.textContent = message;
  $('toasts').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 200);
  }, 2200);
}

/** 按钮 loading 态；返回恢复函数 */
function withBusy(button, busyText) {
  const original = button.textContent;
  button.disabled = true;
  button.classList.add('busy');
  if (busyText) button.textContent = busyText;
  return () => {
    button.disabled = false;
    button.classList.remove('busy');
    button.textContent = original;
  };
}

function relativeTime(timestamp) {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const date = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ---------------------------------------------------------------- 视图切换

function switchView(view) {
  const target = VIEWS.includes(view) ? view : 'overview';
  for (const name of VIEWS) {
    const tab = $(`tab-${name}`);
    const panel = $(`panel-${name}`);
    const active = name === target;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    panel.hidden = !active;
  }
}

// ---------------------------------------------------------------- 连接状态

function renderStatus(status) {
  lastStatus = status || {};
  const kind = lastStatus.authRejected
    ? 'rejected'
    : lastStatus.connected
      ? 'connected'
      : lastStatus.reconnecting
        ? 'reconnecting'
        : 'disconnected';
  const [level, label] = STATUS_STYLE[kind];

  $('status-pill').className = `pill ${level}`;
  $('status-text').textContent = label;
  // 已连接/重连中显示实际连接地址；未连接时以已保存配置为准（保存后即可看到新地址）。
  const serverBaseUrl =
    lastStatus.connected || lastStatus.reconnecting
      ? lastStatus.serverBaseUrl || currentConfig.serverBaseUrl
      : currentConfig.serverBaseUrl || lastStatus.serverBaseUrl;
  $('status-server').textContent = serverBaseUrl || '—';
  renderBridgeUrl(serverBaseUrl);

  const alert = $('status-alert');
  if (lastStatus.authRejected) {
    alert.hidden = false;
    alert.className = 'alert err';
    alert.textContent = '这把 API Key 已失效或被吊销，自动重连已停止。';
    const fix = document.createElement('button');
    fix.className = 'btn ghost alert-action';
    fix.type = 'button';
    fix.textContent = '打开账号管理';
    fix.addEventListener('click', () => {
      openUrl(portalUrl(currentConfig.serverBaseUrl || SERVICE_HOME, '/console'));
    });
    alert.appendChild(fix);
  } else if (lastStatus.lastError) {
    alert.hidden = false;
    alert.className = 'alert warn';
    alert.textContent = `连接错误：${lastStatus.lastError}`;
  } else {
    alert.hidden = true;
  }

  $('btn-connect').disabled = lastStatus.connected === true;
  $('btn-disconnect').disabled = lastStatus.connected !== true;
}

async function refreshStatus() {
  const res = await api.getStatus();
  if (res.success) renderStatus(res.status);
  return res;
}

/** 服务器基础地址 → /video-bridge */
function renderBridgeUrl(serverBaseUrl) {
  let bridge = '';
  try {
    const url = new URL('/video-bridge', serverBaseUrl);
    url.searchParams.set('extensionId', chrome.runtime.id);
    bridge = url.toString();
  } catch {
    bridge = '';
  }
  $('quick-bridge-url').textContent = bridge || '（需先配置服务器地址）';
  $('quick-bridge').disabled = !bridge;
  return bridge;
}

function openUrl(url) {
  if (!url) return;
  chrome.tabs.create({ url });
}

// ---------------------------------------------------------------- 连接设置

function maskKey(key) {
  return typeof key === 'string' && key.length > 6 ? `${key.slice(0, 3)}***${key.slice(-2)}` : '—';
}

async function loadConfig() {
  const res = await api.getConfig();
  if (!res.success) return;
  const config = res.config || {};
  currentConfig = config;
  $('server-url').value = config.serverBaseUrl || '';
  $('api-key').value = config.apiKey || '';
  $('auto-reconnect').checked = config.autoReconnect !== false;
  $('status-key').textContent = config.apiKey ? maskKey(config.apiKey) : '未配置';
  // 没配 key 才显示引导（概览里的三步上手）
  $('onboarding').hidden = Boolean(config.apiKey);
  renderBridgeUrl(config.serverBaseUrl);
  $('link-home').href = portalUrl(config.serverBaseUrl, '/register');
  $('link-get-key').href = portalUrl(config.serverBaseUrl, '/console');
}

/** 展开某一项的就地编辑器；同时只允许一个编辑器展开 */
function startEditor(kind) {
  if (activeEditor && activeEditor !== kind) closeEditor(activeEditor);
  activeEditor = kind;
  $(`${kind}-view`).hidden = true;
  $(`${kind}-edit`).hidden = false;
  $(`edit-${kind}`).setAttribute('aria-expanded', 'true');
  const input = $(kind === 'server' ? 'server-url' : 'api-key');
  input.focus();
  input.select();
}

/** 收起编辑器并恢复成已保存的值 */
function closeEditor(kind) {
  if (activeEditor === kind) activeEditor = '';
  $(`${kind}-view`).hidden = false;
  $(`${kind}-edit`).hidden = true;
  $(`edit-${kind}`).setAttribute('aria-expanded', 'false');

  if (kind === 'server') {
    $('server-url').value = currentConfig.serverBaseUrl || '';
    return;
  }
  const input = $('api-key');
  input.value = currentConfig.apiKey || '';
  input.type = 'password';
  $('toggle-key').textContent = '显示';
}

/** 保存单个字段。保存服务器/Key 会断开旧连接，需要用户重新点「连接」。 */
async function saveField(kind) {
  const isServer = kind === 'server';
  const input = $(isServer ? 'server-url' : 'api-key');
  const value = input.value.trim();
  if (isServer && !value) {
    input.focus();
    toast('请填写服务器地址', 'err');
    return;
  }

  const button = $(`save-${kind}`);
  if (button.disabled) return;

  const savedValue = isServer
    ? currentConfig.serverBaseUrl || ''
    : currentConfig.apiKey || '';
  if (value === savedValue) {
    closeEditor(kind);
    toast('没有改动');
    return;
  }

  const wasActive = lastStatus.connected === true || lastStatus.reconnecting === true;
  const patch = isServer ? { serverBaseUrl: value } : { apiKey: value };
  const done = withBusy(button, '保存中…');
  try {
    const res = await api.saveConfig(patch);
    if (!res.success) {
      toast(res.error || '保存失败', 'err');
      return;
    }
    currentConfig = res.config || { ...currentConfig, ...patch };
    closeEditor(kind);
    await loadConfig();
    await refreshStatus();
    toast(
      wasActive ? '已保存，连接已断开，请重新连接' : '已保存',
      'ok',
    );
  } finally {
    done();
  }
}

async function onToggleAutoReconnect(event) {
  const want = event.target.checked;
  event.target.disabled = true;
  try {
    const res = await api.saveConfig({ autoReconnect: want });
    if (!res.success) {
      event.target.checked = !want;
      toast(res.error || '保存失败', 'err');
      return;
    }
    currentConfig = res.config || { ...currentConfig, autoReconnect: want };
    toast(want ? '已开启自动重连' : '已关闭自动重连', 'ok');
  } finally {
    event.target.disabled = false;
  }
}

async function onConnect() {
  if (activeEditor) {
    toast('请先保存或取消正在编辑的设置', 'err');
    return;
  }
  if (!currentConfig.serverBaseUrl) {
    startEditor('server');
    toast('请先填写服务器地址', 'err');
    return;
  }
  if (!currentConfig.apiKey) {
    startEditor('key');
    toast('请先填写 API Key', 'err');
    return;
  }

  const done = withBusy($('btn-connect'), '连接中…');
  try {
    const res = await api.connect({
      serverBaseUrl: currentConfig.serverBaseUrl,
      apiKey: currentConfig.apiKey,
    });
    toast(res.success ? '已发起连接' : res.error || '连接失败', res.success ? 'ok' : 'err');
  } finally {
    done();
    await refreshStatus();
  }
}

async function onDisconnect() {
  const done = withBusy($('btn-disconnect'));
  try {
    const res = await api.disconnect();
    toast(res.success ? '已断开连接' : '操作失败，请重试', res.success ? '' : 'err');
  } finally {
    done();
    await refreshStatus();
  }
}

// ---------------------------------------------------------------- 下载权限

async function refreshPermissions() {
  const res = await api.getPermissionStatus();
  if (!res.success) return;
  const { allHostsAuthorized, authorizedHosts = [] } = res.status;

  $('all-hosts').checked = !!allHostsAuthorized;
  $('perm-count').textContent = allHostsAuthorized
    ? '已授权所有域名'
    : `${authorizedHosts.length} 个自定义域名 · 内置 ${BUILT_IN_HOSTS.length} 个`;

  // 已允许所有网站时，单独添加没有意义，直接禁用输入。
  const input = $('host-input');
  const addButton = $('btn-add-host');
  input.disabled = !!allHostsAuthorized;
  addButton.disabled = !!allHostsAuthorized;
  input.placeholder = allHostsAuthorized
    ? '已允许所有网站，无需添加'
    : '输入域名，如 example.com';

  const list = $('host-list');
  list.textContent = '';

  // 内置域名只读展示：让用户知道自己实际持有哪些下载权限。
  for (const host of BUILT_IN_HOSTS) {
    const chip = document.createElement('span');
    chip.className = 'chip builtin';
    chip.title = '扩展安装时已授权，不可移除';
    const name = document.createElement('span');
    name.textContent = host;
    const tag = document.createElement('span');
    tag.className = 'chip-tag';
    tag.textContent = '内置';
    chip.append(name, tag);
    list.appendChild(chip);
  }

  if (authorizedHosts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = allHostsAuthorized ? '已允许所有网站' : '还没有自定义域名';
    list.appendChild(empty);
    return;
  }
  for (const host of authorizedHosts) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const name = document.createElement('span');
    name.textContent = host;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = `移除 ${host}`;
    remove.setAttribute('aria-label', `移除 ${host}`);
    remove.addEventListener('click', async () => {
      const res2 = await revokeHost(host);
      toast(res2.success ? `已移除 ${host}` : `移除失败：${res2.error || '请重试'}`, res2.success ? '' : 'err');
      await refreshPermissions();
    });
    chip.append(name, remove);
    list.appendChild(chip);
  }
}

async function onAddHost() {
  if ($('all-hosts').checked) {
    toast('已允许所有网站，无需单独添加');
    return;
  }
  const value = $('host-input').value.trim();
  if (!value) {
    $('host-input').focus();
    toast('请输入域名', 'err');
    return;
  }
  const done = withBusy($('btn-add-host'), '授权中…');
  try {
    // 权限申请必须在 popup 里发起（需要用户手势），记账交给 SW
    const res = await grantHost(value);
    if (res.success) {
      $('host-input').value = '';
      toast(`已授权 ${res.host || value}`, 'ok');
    } else {
      toast(`授权失败：${res.error || '请重试'}`, 'err');
    }
  } finally {
    done();
    await refreshPermissions();
  }
}

async function onToggleAllHosts(event) {
  const wantGrant = event.target.checked;
  event.target.disabled = true;
  try {
    const res = wantGrant ? await requestAllHosts() : await revokeAllHosts();
    if (!res.success) {
      toast(`${wantGrant ? '授权' : '撤销'}失败：${res.error || '请重试'}`, 'err');
    } else {
      toast(wantGrant ? '已授权所有域名' : '已撤销所有域名授权', 'ok');
    }
  } finally {
    event.target.disabled = false;
    await refreshPermissions();
  }
}

// ---------------------------------------------------------------- 通知板

async function refreshNotices() {
  const notices = await listNotices();
  const unread = notices.filter((notice) => !notice.read).length;

  const badge = $('notice-badge');
  badge.hidden = unread === 0;
  badge.textContent = String(unread);

  const list = $('notice-list');
  list.textContent = '';
  if (notices.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = '暂无通知';
    list.appendChild(empty);
    return;
  }

  for (const notice of notices.slice().reverse()) {
    const item = document.createElement('li');
    if (!notice.read) item.classList.add('unread');

    const body = document.createElement('div');
    body.className = 'notice-body';
    const title = document.createElement('span');
    title.className = 'notice-title';
    title.textContent = notice.level === 'warning' ? `⚠ ${notice.title}` : notice.title;
    const meta = document.createElement('span');
    meta.className = 'notice-meta';
    meta.textContent = [relativeTime(notice.receivedAt), notice.body].filter(Boolean).join(' · ');
    body.append(title, meta);
    item.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'notice-actions';
    if (notice.actionUrl) {
      const open = document.createElement('button');
      open.className = 'icon-btn';
      open.type = 'button';
      open.textContent = '详情';
      open.title = '打开相关链接';
      open.addEventListener('click', () => openUrl(notice.actionUrl));
      actions.appendChild(open);
    }
    if (!notice.read) {
      const read = document.createElement('button');
      read.className = 'icon-btn';
      read.type = 'button';
      read.textContent = '已读';
      read.title = '标记已读';
      read.addEventListener('click', async () => {
        await markNoticeRead(notice.id, true);
        await refreshNotices();
      });
      actions.appendChild(read);
    }
    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.type = 'button';
    del.textContent = '移除';
    del.title = '移除这条通知';
    del.addEventListener('click', async () => {
      await removeNotice(notice.id);
      await refreshNotices();
    });
    actions.appendChild(del);
    item.appendChild(actions);
    list.appendChild(item);
  }
}

// ---------------------------------------------------------------- 关于

function setupAbout(config = {}) {
  // 「关于」放说明性内容、文档链接和视频桥快捷入口；
  // 名称/版本/扩展 ID 都由顶部与概览显示，这里不重复。

  const repo = PROJECT_LINKS.repo;
  const docs = `${repo}/${PROJECT_LINKS.docsPath}`;
  const issues = `${repo}/${PROJECT_LINKS.issuesPath}`;
  $('link-docs').href = docs;
  $('link-repo').href = repo;
  $('link-issues').href = issues;
  $('link-repo-url').textContent = repo.replace(/^https?:\/\//, '');
  const baseUrl = config?.serverBaseUrl || SERVICE_HOME;
  $('link-home').href = portalUrl(baseUrl, '/register');
  $('link-get-key').href = portalUrl(baseUrl, '/console');

  $('copy-ext-id').addEventListener('click', async () => {
    const ok = await copyText(chrome.runtime.id || '');
    toast(ok ? '扩展 ID 已复制' : '复制失败，请手动选择', ok ? 'ok' : 'err');
  });
  $('quick-bridge').addEventListener('click', () => {
    const bridge = renderBridgeUrl(currentConfig.serverBaseUrl || config?.serverBaseUrl);
    if (bridge) openUrl(bridge);
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- 初始化

function bindEvents() {
  for (const name of VIEWS) {
    $(`tab-${name}`).addEventListener('click', () => switchView(name));
    // 左右方向键切换视图（tablist 的无障碍惯例）
    $(`tab-${name}`).addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const index = VIEWS.indexOf(name);
      const next = VIEWS[(index + (event.key === 'ArrowRight' ? 1 : VIEWS.length - 1)) % VIEWS.length];
      switchView(next);
      $(`tab-${next}`).focus();
    });
  }

  $('btn-connect').addEventListener('click', onConnect);
  $('btn-disconnect').addEventListener('click', onDisconnect);
  $('btn-edit-key-from-onboarding').addEventListener('click', () => startEditor('key'));
  $('btn-add-host').addEventListener('click', onAddHost);
  $('all-hosts').addEventListener('change', onToggleAllHosts);
  $('auto-reconnect').addEventListener('change', onToggleAutoReconnect);

  for (const kind of ['server', 'key']) {
    $(`edit-${kind}`).addEventListener('click', () => startEditor(kind));
    $(`save-${kind}`).addEventListener('click', () => saveField(kind));
    $(`cancel-${kind}`).addEventListener('click', () => closeEditor(kind));
    const input = $(kind === 'server' ? 'server-url' : 'api-key');
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        saveField(kind);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeEditor(kind);
      }
    });
  }

  $('host-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') onAddHost();
  });
  $('toggle-key').addEventListener('click', () => {
    const input = $('api-key');
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    $('toggle-key').textContent = reveal ? '隐藏' : '显示';
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === POPUP_MSG.STATUS_CHANGED) {
      renderStatus(message.payload);
    }
  });
}

async function init() {
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;
  $('status-ext-id').textContent = chrome.runtime.id || '—';
  switchView('overview'); // 默认落在概览

  // 先拿到已保存配置再绑定事件，避免用户手速快于初始化时看到空输入框。
  await loadConfig();
  setupAbout(currentConfig);
  bindEvents();

  await Promise.all([refreshStatus(), refreshPermissions(), refreshNotices()]);
}

void init();

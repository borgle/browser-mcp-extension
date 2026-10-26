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
import {
  getLocale,
  initPopupLanguage,
  localizeError,
  onLanguageChange,
  t,
} from './i18n.js';
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

/** 状态 → 胶囊样式与文案 key */
const STATUS_STYLE = {
  connected: ['ok', 'status.connected'],
  connecting: ['warn', 'status.connecting'],
  reconnecting: ['warn', 'status.reconnecting'],
  rejected: ['err', 'status.rejected'],
  disconnected: ['', 'status.disconnected'],
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
  if (diff < 60_000) return t('relative.justNow');
  if (diff < 3_600_000) {
    return t('relative.minutes', { count: Math.floor(diff / 60_000) });
  }
  if (diff < 86_400_000) {
    return t('relative.hours', { count: Math.floor(diff / 3_600_000) });
  }
  return new Date(timestamp).toLocaleString(getLocale(), {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
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
  const [level, labelKey] = STATUS_STYLE[kind];

  $('status-pill').className = `pill ${level}`;
  $('status-text').textContent = t(labelKey);
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
    alert.textContent = t('error.keyRejected');
    const fix = document.createElement('button');
    fix.className = 'btn ghost alert-action';
    fix.type = 'button';
    fix.textContent = t('action.openAccount');
    fix.addEventListener('click', () => {
      openUrl(portalUrl(currentConfig.serverBaseUrl || SERVICE_HOME, '/console'));
    });
    alert.appendChild(fix);
  } else if (lastStatus.lastError) {
    alert.hidden = false;
    alert.className = 'alert warn';
    alert.textContent = t('error.connectionPrefix', {
      message: localizeError(lastStatus.lastError),
    });
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
  $('quick-bridge-url').textContent = bridge || t('bridge.notConfigured');
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

function renderKeySummary() {
  $('status-key').textContent = currentConfig.apiKey
    ? maskKey(currentConfig.apiKey)
    : t('key.notConfigured');
}

function updateToggleKeyLabel() {
  $('toggle-key').textContent =
    $('api-key').type === 'password' ? t('action.show') : t('action.hide');
}

async function loadConfig() {
  const res = await api.getConfig();
  if (!res.success) return;
  const config = res.config || {};
  currentConfig = config;
  $('server-url').value = config.serverBaseUrl || '';
  $('api-key').value = config.apiKey || '';
  $('auto-reconnect').checked = config.autoReconnect !== false;
  renderKeySummary();
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
  updateToggleKeyLabel();
}

/** 保存单个字段。保存服务器/Key 会断开旧连接，需要用户重新点「连接」。 */
async function saveField(kind) {
  const isServer = kind === 'server';
  const input = $(isServer ? 'server-url' : 'api-key');
  const value = input.value.trim();
  if (isServer && !value) {
    input.focus();
    toast(t('toast.serverRequired'), 'err');
    return;
  }

  const button = $(`save-${kind}`);
  if (button.disabled) return;

  const savedValue = isServer
    ? currentConfig.serverBaseUrl || ''
    : currentConfig.apiKey || '';
  if (value === savedValue) {
    closeEditor(kind);
    toast(t('toast.unchanged'));
    return;
  }

  const wasActive = lastStatus.connected === true || lastStatus.reconnecting === true;
  const patch = isServer ? { serverBaseUrl: value } : { apiKey: value };
  const done = withBusy(button, t('toast.saving'));
  try {
    const res = await api.saveConfig(patch);
    if (!res.success) {
      toast(res.error ? localizeError(res.error) : t('toast.saveFailed'), 'err');
      return;
    }
    currentConfig = res.config || { ...currentConfig, ...patch };
    closeEditor(kind);
    await loadConfig();
    await refreshStatus();
    toast(
      wasActive ? t('toast.savedDisconnected') : t('toast.saved'),
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
      toast(res.error ? localizeError(res.error) : t('toast.saveFailed'), 'err');
      return;
    }
    currentConfig = res.config || { ...currentConfig, autoReconnect: want };
    toast(want ? t('toast.autoOn') : t('toast.autoOff'), 'ok');
  } finally {
    event.target.disabled = false;
  }
}

async function onConnect() {
  if (activeEditor) {
    toast(t('toast.finishEditing'), 'err');
    return;
  }
  if (!currentConfig.serverBaseUrl) {
    startEditor('server');
    toast(t('toast.serverRequired'), 'err');
    return;
  }
  if (!currentConfig.apiKey) {
    startEditor('key');
    toast(t('toast.keyRequired'), 'err');
    return;
  }

  const done = withBusy($('btn-connect'), t('toast.connecting'));
  try {
    const res = await api.connect({
      serverBaseUrl: currentConfig.serverBaseUrl,
      apiKey: currentConfig.apiKey,
    });
    toast(
      res.success
        ? t('toast.connectStarted')
        : res.error
          ? localizeError(res.error)
          : t('toast.connectFailed'),
      res.success ? 'ok' : 'err',
    );
  } finally {
    done();
    await refreshStatus();
  }
}

async function onDisconnect() {
  const done = withBusy($('btn-disconnect'));
  try {
    const res = await api.disconnect();
    toast(res.success ? t('toast.disconnected') : t('toast.operationFailed'), res.success ? '' : 'err');
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
    ? t('permissions.countAll')
    : t('permissions.count', {
        custom: authorizedHosts.length,
        builtin: BUILT_IN_HOSTS.length,
      });

  // 已允许所有网站时，单独添加没有意义，直接禁用输入。
  const input = $('host-input');
  const addButton = $('btn-add-host');
  input.disabled = !!allHostsAuthorized;
  addButton.disabled = !!allHostsAuthorized;
  input.placeholder = allHostsAuthorized
    ? t('permissions.allPlaceholder')
    : t('permissions.hostPlaceholder');

  const list = $('host-list');
  list.textContent = '';

  // 内置域名只读展示：让用户知道自己实际持有哪些下载权限。
  for (const host of BUILT_IN_HOSTS) {
    const chip = document.createElement('span');
    chip.className = 'chip builtin';
    chip.title = t('permissions.builtinTitle');
    const name = document.createElement('span');
    name.textContent = host;
    const tag = document.createElement('span');
    tag.className = 'chip-tag';
    tag.textContent = t('permissions.builtinTag');
    chip.append(name, tag);
    list.appendChild(chip);
  }

  if (authorizedHosts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = allHostsAuthorized
      ? t('permissions.allAllowed')
      : t('permissions.noCustom');
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
    remove.title = t('permissions.removeAria', { host });
    remove.setAttribute('aria-label', t('permissions.removeAria', { host }));
    remove.addEventListener('click', async () => {
      const res2 = await revokeHost(host);
      toast(
        res2.success
          ? t('permissions.removed', { host })
          : t('permissions.removeFailed', {
              error: localizeError(res2.error),
            }),
        res2.success ? '' : 'err',
      );
      await refreshPermissions();
    });
    chip.append(name, remove);
    list.appendChild(chip);
  }
}

async function onAddHost() {
  if ($('all-hosts').checked) {
    toast(t('permissions.allNoAdd'));
    return;
  }
  const value = $('host-input').value.trim();
  if (!value) {
    $('host-input').focus();
    toast(t('permissions.enterHost'), 'err');
    return;
  }
  const done = withBusy($('btn-add-host'), t('permissions.granting'));
  try {
    // 权限申请必须在 popup 里发起（需要用户手势），记账交给 SW
    const res = await grantHost(value);
    if (res.success) {
      $('host-input').value = '';
      toast(t('permissions.granted', { host: res.host || value }), 'ok');
    } else {
      toast(
        t('permissions.grantFailed', {
          error: localizeError(res.error),
        }),
        'err',
      );
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
      toast(
        t(wantGrant ? 'permissions.grantFailed' : 'permissions.revokeFailed', {
          error: localizeError(res.error),
        }),
        'err',
      );
    } else {
      toast(wantGrant ? t('permissions.allGranted') : t('permissions.allRevoked'), 'ok');
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
    empty.textContent = t('notices.empty');
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
      open.textContent = t('notices.details');
      open.title = t('notices.openLink');
      open.addEventListener('click', () => openUrl(notice.actionUrl));
      actions.appendChild(open);
    }
    if (!notice.read) {
      const read = document.createElement('button');
      read.className = 'icon-btn';
      read.type = 'button';
      read.textContent = t('notices.markRead');
      read.title = t('notices.markReadTitle');
      read.addEventListener('click', async () => {
        await markNoticeRead(notice.id, true);
        await refreshNotices();
      });
      actions.appendChild(read);
    }
    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.type = 'button';
    del.textContent = t('notices.remove');
    del.title = t('notices.removeTitle');
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
    toast(ok ? t('copy.idCopied') : t('copy.failed'), ok ? 'ok' : 'err');
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
    updateToggleKeyLabel();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === POPUP_MSG.STATUS_CHANGED) {
      renderStatus(message.payload);
    }
  });
}

async function init() {
  await initPopupLanguage();
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;
  $('status-ext-id').textContent = chrome.runtime.id || '—';
  switchView('overview'); // 默认落在概览

  // 先拿到已保存配置再绑定事件，避免用户手速快于初始化时看到空输入框。
  await loadConfig();
  setupAbout(currentConfig);
  bindEvents();

  onLanguageChange(() => {
    renderKeySummary();
    updateToggleKeyLabel();
    renderStatus(lastStatus);
    void refreshPermissions();
    void refreshNotices();
  });

  await Promise.all([refreshStatus(), refreshPermissions(), refreshNotices()]);
}

void init();

/**
 * 域名输入解析（纯函数，popup 与 service worker 共用）。
 *
 * 权限申请必须由 popup 发起（需要用户手势），但输入校验、match pattern 展开
 * 和内置域名清单两边都要用；集中在这里，避免 popup / SW 各写一套导致规则漂移。
 */

/** 本机后端：随 manifest 静态授权，用户不需要也不应该再添加 */
export const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

/** 安装时即已授权的域名，列表里只读展示，不可移除 */
export const BUILT_IN_HOSTS = [...LOCAL_HOSTS];

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_LABEL = /^\d{1,3}$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * 用户输入 → `{ host }` 或 `{ error }`。
 *
 * 错误信息直接展示给用户，所以要说明「错在哪、正确格式是什么」。
 * 允许的写法：`example.com`、`https://example.com/a?b=1`、`*.example.com`、
 * `example.com:8080`、IPv4；端口、协议、路径会被忽略，IPv6 暂不支持。
 */
export function parseHostInput(input) {
  let value = String(input ?? '')
    .trim()
    .toLowerCase();
  if (!value) return { error: '请输入域名，例如 example.com' };

  value = value
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^\*\./, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '');

  const port = /^([^:]+):(\d+)$/.exec(value);
  if (port) value = port[1];
  if (value.includes(':')) {
    return { error: '域名格式不正确（暂不支持端口和 IPv6）' };
  }
  if (!value) return { error: '请输入域名，例如 example.com' };
  if (value.length > 253) return { error: '域名过长' };

  if (LOCAL_HOSTS.includes(value)) return { error: '本机地址已内置，无需添加' };

  const labels = value.split('.');
  if (labels.some((label) => !label)) {
    return { error: '域名格式不正确，例如 example.com' };
  }

  if (labels.every((label) => IPV4_LABEL.test(label))) {
    if (!IPV4.test(value) || labels.some((label) => Number(label) > 255)) {
      return { error: 'IP 地址格式不正确' };
    }
    return { host: value };
  }

  if (labels.some((label) => !HOST_LABEL.test(label))) {
    return { error: '域名格式不正确，例如 example.com' };
  }
  return { host: value };
}

/**
 * 一个域名展开成浏览器 match pattern。
 *
 * http/https × 主域/子域；IPv4 不加 `*.` 前缀（Chrome 不接受 IP 的通配子域）。
 */
export function hostPatternsOf(host) {
  const exact = [`https://${host}/*`, `http://${host}/*`];
  if (IPV4.test(host)) return exact;
  return [`https://*.${host}/*`, `http://*.${host}/*`, ...exact];
}

/**
 * 图标工作台的本地静态服务器。
 *
 * 为什么要一个服务器：lab 页面用 ES module 直接 import tools/icon-artwork.mjs，
 * 浏览器不允许 file:// 下做模块导入，所以起一个只读的本地 http 服务，顺带打开页面。
 * 服务只监听回环地址，只读扩展目录，不做任何写操作。
 *
 * 运行：npm run icon:lab            （默认 http://127.0.0.1:5173/tools/icon-lab.html）
 *       npm run icon:lab -- --port=5180 --no-open
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = Object.fromEntries(
  process.argv.slice(2).map((raw) => {
    const [key, value] = raw.replace(/^--/, '').split('=');
    return [key, value ?? true];
  }),
);

const port = Number(argv.port ?? 5173);
const page = '/tools/icon-lab.html';
const url = `http://127.0.0.1:${port}${page}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, url).pathname);
  const target = path.resolve(path.join(root, pathname));
  // 目录穿越保护：解析后的真实路径必须仍在扩展目录内
  if (target !== root && !target.startsWith(root + path.sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  const file = fs.existsSync(target) && fs.statSync(target).isDirectory()
    ? path.join(target, 'index.html')
    : target;
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`图标工作台：${url}`);
  console.log('改 tools/icon-artwork.mjs 后刷新页面即可看到新图形；定稿请跑 npm run icon:build。');
  if (argv['no-open'] === true) return;
  const [bin, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  spawn(bin, args, { stdio: 'ignore', detached: true }).unref();
});


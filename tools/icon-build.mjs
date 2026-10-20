/**
 * 扩展图标构建：把 tools/icon-artwork.mjs 里的设计参数落成仓库里的图标文件。
 *
 * 管线：参数 → SVG 源码 → canvas（@napi-rs/canvas，Skia 内核）栅格化 → PNG
 * 每个尺寸都按目标像素原生栅格化（SVG 的 width/height 直接写成目标尺寸），
 * 不是先渲染大图再缩小，所以 16/32px 的边缘比缩放法干净。
 *
 * 产物：
 *   icons/icon.svg           主图标（矢量，设计源对应 256px 全细节）
 *   icons/icon-maskable.svg  全出血版，图形收在 80% 安全区内
 *   icons/logo-lockup.svg    横版组合（图标 + 中英文字标）
 *   icons/icon-{16,32,48,128,256,512}.png
 *   icons/icon-preview.png   对照图（浅色底 / 深色底 / 遮罩预览 / 三套配色）
 *
 * 运行：
 *   npm run icon:build
 *   npm run icon:build -- --theme=mcp --variant=cursor
 *   npm run icon:build -- --sheet-only
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import {
  ICON_SIZES,
  THEMES,
  VARIANTS,
  buildIconSvg,
  buildLockupSvg,
} from './icon-artwork.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = path.join(root, 'icons');

/* 传入本机中文字体，避免组合图里的字标渲染成方框 */
for (const font of ['msyh.ttc', 'msyhbd.ttc', 'simhei.ttf', 'Deng.ttf']) {
  const file = path.join(process.env.WINDIR ?? 'C:/Windows', 'Fonts', font);
  if (fs.existsSync(file)) {
    try {
      GlobalFonts.registerFromPath(file);
    } catch {
      /* 字体注册失败不影响几何图形，忽略 */
    }
  }
}

const argv = Object.fromEntries(
  process.argv.slice(2).map((raw) => {
    const [key, value] = raw.replace(/^--/, '').split('=');
    return [key, value ?? true];
  }),
);

const theme = typeof argv.theme === 'string' && THEMES[argv.theme] ? argv.theme : 'xhs';
const variant = typeof argv.variant === 'string' && VARIANTS[argv.variant] ? argv.variant : 'spark';

/** SVG 源码 → canvas → PNG Buffer（按目标尺寸原生栅格化） */
async function renderPng(svg, size) {
  const image = await loadImage(Buffer.from(svg, 'utf8'));
  if (image.width !== size || image.height !== size) {
    throw new Error(`SVG 原生尺寸应是 ${size}，实际 ${image.width}×${image.height}`);
  }
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, size, size);
  return { buffer: canvas.toBuffer('image/png'), ctx, size };
}

/** 统计 alpha：用来确认四角透明、中心不透明（防止丢了圆角或透明底） */
function alphaStats(ctx, size) {
  const { data } = ctx.getImageData(0, 0, size, size);
  let painted = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 8) painted += 1;
  const at = (x, y) => data[(y * size + x) * 4 + 3];
  return {
    corner: at(0, 0),
    center: at(Math.floor(size / 2), Math.floor(size / 2)),
    coverage: painted / (size * size),
  };
}

function writeFile(name, content) {
  fs.writeFileSync(path.join(iconsDir, name), content);
  return fs.statSync(path.join(iconsDir, name)).size;
}

/** 对照图：一屏看清浅色底、深色底、遮罩裁切与三套配色的表现 */
async function buildSheet() {
  const W = 760;
  const H = 440;
  const bands = [
    { top: 0, height: 200, bg: '#FFFFFF', label: '#9AA3AF' },
    { top: 200, height: 130, bg: '#0B1220', label: '#64748B' },
    { top: 330, height: 110, bg: '#F8FAFC', label: '#9AA3AF' },
  ];
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const label = (text, x, y, color) => {
    ctx.font = '12px "Segoe UI", sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };

  // 浅色底：常规尺寸阶梯（128 起，逐个缩小，检查细节衰减是否自然）
  const band = bands[0];
  ctx.fillStyle = band.bg;
  ctx.fillRect(0, band.top, W, band.height);
  let cursorX = 32;
  for (const size of [128, 64, 48, 32, 16]) {
    const { buffer } = await renderPng(buildIconSvg({ size, theme, variant }), size);
    const image = await loadImage(buffer);
    ctx.drawImage(image, cursorX, band.top + (band.height - size) / 2 - 12, size, size);
    label(String(size), cursorX, band.top + band.height - 28, band.label);
    cursorX += size + 40;
  }

  // 深色底：工具栏上实际出现的尺寸
  const dark = bands[1];
  ctx.fillStyle = dark.bg;
  ctx.fillRect(0, dark.top, W, dark.height);
  cursorX = 32;
  for (const size of [48, 32, 16]) {
    const { buffer } = await renderPng(buildIconSvg({ size, theme, variant }), size);
    const image = await loadImage(buffer);
    ctx.drawImage(image, cursorX, dark.top + (dark.height - size) / 2, size, size);
    cursorX += size + 44;
  }
  // 遮罩预览：全出血版被裁成圆形 / 圆角方形时是否安全
  const maskable = await loadImage(Buffer.from(buildIconSvg({ size: 512, theme, variant, maskable: true })));
  const masks = [
    { x: 300, shape: 'circle' },
    { x: 400, shape: 'squircle' },
    { x: 500, shape: 'circle' },
  ];
  masks.forEach(({ x, shape }, i) => {
    const size = i === 2 ? 56 : 72;
    const y = dark.top + (dark.height - size) / 2;
    ctx.save();
    ctx.beginPath();
    if (shape === 'circle') {
      ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    } else {
      const r = size * 0.28;
      ctx.roundRect(x, y, size, size, r);
    }
    ctx.clip();
    ctx.drawImage(maskable, x, y, size, size);
    ctx.restore();
  });
  label('maskable mask test', 300, dark.top + dark.height - 16, dark.label);

  // 三套配色（同一图形，换肤看效果）
  const third = bands[2];
  ctx.fillStyle = third.bg;
  ctx.fillRect(0, third.top, W, third.height);
  cursorX = 32;
  for (const key of Object.keys(THEMES)) {
    const { buffer } = await renderPng(buildIconSvg({ size: 64, theme: key, variant }), 64);
    const image = await loadImage(buffer);
    ctx.drawImage(image, cursorX, third.top + 16, 64, 64);
    label(key, cursorX, third.top + 96, third.label);
    cursorX += 104;
  }
  // 三个图形候选
  cursorX = 380;
  for (const key of Object.keys(VARIANTS)) {
    const { buffer } = await renderPng(buildIconSvg({ size: 64, theme, variant: key }), 64);
    const image = await loadImage(buffer);
    ctx.drawImage(image, cursorX, third.top + 16, 64, 64);
    label(key, cursorX, third.top + 96, third.label);
    cursorX += 104;
  }

  return writeFile('icon-preview.png', canvas.toBuffer('image/png'));
}

const sheetOnly = argv['sheet-only'] === true;
const report = [];

if (!sheetOnly) {
  const iconSvg = buildIconSvg({ size: 256, theme, variant, detail: 'full' });
  const maskableSvg = buildIconSvg({ size: 256, theme, variant, detail: 'full', maskable: true });
  const lockupSvg = buildLockupSvg({ theme, variant });
  report.push(['icon.svg', writeFile('icon.svg', iconSvg)]);
  report.push(['icon-maskable.svg', writeFile('icon-maskable.svg', maskableSvg)]);
  report.push(['logo-lockup.svg', writeFile('logo-lockup.svg', lockupSvg)]);

  for (const size of ICON_SIZES) {
    const { buffer, ctx } = await renderPng(buildIconSvg({ size, theme, variant }), size);
    const stats = alphaStats(ctx, size);
    const name = `icon-${size}.png`;
    report.push([
      name,
      writeFile(name, buffer),
      `${size}×${size}  角alpha=${stats.corner} 中心alpha=${stats.center} 覆盖率=${(stats.coverage * 100).toFixed(1)}%`,
    ]);
  }
}

const sheetBytes = await buildSheet();
report.push(['icon-preview.png', sheetBytes]);

console.log(`主题 ${theme}（${THEMES[theme].label}） · 图形 ${variant}（${VARIANTS[variant]}）`);
for (const [name, bytes, extra] of report) {
  console.log(`  ${name.padEnd(22)} ${String(bytes).padStart(7)} B  ${extra ?? ''}`);
}
console.log(`产物目录：${path.relative(process.cwd(), iconsDir)}`);


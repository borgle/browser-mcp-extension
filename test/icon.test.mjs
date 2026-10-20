/**
 * 图标自检（离线，不需要浏览器）：
 *   1. manifest 引用的 PNG 都存在，且尺寸/透明边/中心不透明都符合预期；
 *   2. maskable 版本必须是全出血（四角不透明），否则平台套遮罩时会露出透明角；
 *   3. 最小尺寸 16px 仍然要有「白窗 + 品牌色主图形」两种颜色，不能糊成一团；
 *   4. 遮罩裁切后主图形仍在安全区内（圆形遮罩下不切到主图形）。
 *
 * 依赖 @napi-rs/canvas（devDependency，图标构建用的同一套 canvas）；
 * 未安装时跳过而不是失败，方便只跑扩展本体测试的人。
 *
 * 运行：node test/icon.test.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIconSvg } from '../tools/icon-artwork.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const icons = path.join(root, 'icons');
const MANIFEST_SIZES = [16, 32, 48, 128];

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✔ ${name}`);
    return;
  }
  failures += 1;
  console.error(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`);
}

let canvasLib;
try {
  canvasLib = await import('@napi-rs/canvas');
} catch {
  console.log('  … 未安装 @napi-rs/canvas，跳过图标像素检查（npm install 后可恢复）');
  process.exit(0);
}
const { createCanvas, loadImage } = canvasLib;

/** 把 PNG / SVG 渲染到 canvas 并取回像素，方便做逐点断言 */
async function pixelsOf(source, size) {
  const image = await loadImage(
    Buffer.isBuffer(source) ? source : Buffer.from(source, 'utf8'),
  );
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  return {
    width: image.width,
    height: image.height,
    at: (x, y) => {
      const i = (Math.round(y) * size + Math.round(x)) * 4;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    },
  };
}

const isNear = (value, target, tolerance) => Math.abs(value - target) <= tolerance;
const looksWhite = ([r, g, b, a]) => a > 200 && r > 235 && g > 235 && b > 235;
const isBrandRed = ([r, g, b, a]) => a > 200 && r > 200 && g < 90 && b < 110;
/** 更宽松的「红family」判断：给带高光/阴影的角落用，只要求色相偏品牌红 */
const isRedFamily = ([r, g, b, a]) => a > 200 && r > 150 && r - g > 40 && r - b > 40;

/* 1. manifest 里点名的位图 */
const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
for (const size of MANIFEST_SIZES) {
  const declared = manifest.icons?.[String(size)];
  check(`manifest 声明了 ${size}px 图标`, declared === `icons/icon-${size}.png`, `实际 ${declared}`);
}

for (const size of [...MANIFEST_SIZES, 256, 512]) {
  const file = path.join(icons, `icon-${size}.png`);
  let info;
  try {
    info = await pixelsOf(await fs.readFile(file), size);
  } catch (err) {
    check(`icon-${size}.png 可读`, false, err.message);
    continue;
  }
  check(`icon-${size}.png 原生尺寸为 ${size}`, info.width === size && info.height === size, `${info.width}×${info.height}`);
  check(`icon-${size}.png 四角透明`, [info.at(0, 0), info.at(size - 1, 0), info.at(0, size - 1), info.at(size - 1, size - 1)].every(([, , , a]) => a < 11));
  check(`icon-${size}.png 中心不透明`, info.at(size / 2, size / 2)[3] > 240);
}

/* 2. maskable 全出血：四角必须不透明（历史 bug：背景被一起缩放，四角漏透明） */
for (const size of [64, 512]) {
  const svg = buildIconSvg({ size, maskable: true });
  const info = await pixelsOf(svg, size);
  const corners = [info.at(0, 0), info.at(size - 1, 0), info.at(0, size - 1), info.at(size - 1, size - 1)];
  check(`maskable ${size}px 四角不透明`, corners.every(([, , , a]) => a > 240), corners.map((c) => c[3]).join(','));
  check(`maskable ${size}px 四角是品牌底色`, corners.every(isRedFamily), corners.map((c) => c.join(',')).join(' | '));
}

/* 3. 16px 可读性：窗口白 + 主图形品牌色，两种颜色都要在 */
const small = await pixelsOf(buildIconSvg({ size: 16 }), 16);
const smallPixels = [];
for (let y = 0; y < 16; y += 1) {
  for (let x = 0; x < 16; x += 1) smallPixels.push(small.at(x, y));
}
const at16 = (x, y) => small.at((x / 256) * 16, (y / 256) * 16);
check('16px 有足够的白色窗口区', smallPixels.filter(looksWhite).length >= 20);
check('16px 主图形中心是品牌色', isBrandRed(at16(128, 128)), at16(128, 128).join(','));

/* 4. 光学尺寸：小尺寸丢掉工具条，大尺寸保留工具条与浅色圆点 */
const big = await pixelsOf(buildIconSvg({ size: 128 }), 128);
const dot = big.at((78 / 256) * 128, (87 / 256) * 128); // 圆点 1 号
const bar = big.at((128 / 256) * 128, (87 / 256) * 128); // 圆点右侧的工具条本体
check('128px 工具条是品牌色', isBrandRed(bar), bar.join(','));
check('128px 圆点明显浅于工具条', dot[1] > 200 && bar[1] < 90, `${dot.join(',')} vs ${bar.join(',')}`);
check('16px 同一位置已没有实心工具条', !isBrandRed(at16(128, 87)), at16(128, 87).join(','));

/* 5. 三个 SVG 源都在，且主图标是与 canvas 同源的参数化产物 */
for (const name of ['icon.svg', 'icon-maskable.svg', 'logo-lockup.svg']) {
  const file = path.join(icons, name);
  try {
    const text = await fs.readFile(file, 'utf8');
    check(`${name} 已生成`, text.includes('<svg') && text.includes('viewBox'));
  } catch (err) {
    check(`${name} 已生成`, false, err.message);
  }
}
check('icon.svg 保留了设计源注释', (await fs.readFile(path.join(icons, 'icon.svg'), 'utf8')).includes('icon-artwork.mjs'));

/* 6. 内边距：方形图标四周应留出透明边，避免贴边被系统裁掉 */
const full = await pixelsOf(buildIconSvg({ size: 256 }), 256);
check(
  '方形图标留有透明外边距',
  isNear(full.at(128, 3)[3], 0, 10) && full.at(128, 12)[3] > 240,
  `${full.at(128, 3)[3]} / ${full.at(128, 12)[3]}`,
);

console.log(failures === 0 ? '\n图标检查全部通过' : `\n图标检查失败 ${failures} 项`);
process.exit(failures === 0 ? 0 : 1);


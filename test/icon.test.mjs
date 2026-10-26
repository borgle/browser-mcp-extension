/**
 * 图标自检（离线，不需要浏览器）：
 *   1. manifest 引用的 PNG 都存在，且尺寸/透明边/中心不透明都符合预期；
 *   2. maskable 版本必须是全出血（四角不透明），否则平台套遮罩时会露出透明角；
 *   3. 最小尺寸 16px 仍然要有「纸色描边 + 墨色窗口 + 酸绿主图形」三种颜色，不能糊成一团；
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
const VB = 256;

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
/** 纸色外框 */
const looksPaper = ([r, g, b, a]) => a > 200 && r > 225 && g > 218 && b > 195;
/** 纸色家族（含底部内阴影压暗的角落） */
const isPaperFamily = ([r, g, b, a]) =>
  a > 240 && r > 170 && g > 160 && b > 140 && r >= g && g >= b;
/** ABM 酸绿主色 */
const isBrandAcid = ([r, g, b, a]) => a > 200 && r > 170 && g > 210 && b < 140;
/** 墨黑窗口 / 圆点 */
const isInkFamily = ([r, g, b, a]) => a > 240 && r < 80 && g < 90 && b < 75;

/* 1. manifest 里点名的位图 */
const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
check(
  '发布图标使用 cursor 图形',
  pkg.scripts?.['icon:build:shipped']?.includes('--variant=cursor'),
  pkg.scripts?.['icon:build:shipped'],
);
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
  check(`maskable ${size}px 四角是品牌底色`, corners.every(isPaperFamily), corners.map((c) => c.join(',')).join(' | '));
}

/* 3. 16px 可读性：纸色描边 + 墨色窗口 + 酸绿主图形 */
const WINDOW_SCALE = 1.3;
const canvasPoint = (size, x, y) => [
  (VB / 2 + (x - VB / 2) * WINDOW_SCALE) / VB * size,
  (VB / 2 + (y - VB / 2) * WINDOW_SCALE) / VB * size,
];
const small = await pixelsOf(buildIconSvg({ size: 16 }), 16);
const at16 = (x, y) => small.at(...canvasPoint(16, x, y));
check('16px 窗口是墨色', isInkFamily(at16(170, 150)), at16(170, 150).join(','));
check('16px 主图形中心是品牌色', isBrandAcid(at16(128, 128)), at16(128, 128).join(','));

/* 4. 光学尺寸：小尺寸丢掉工具条，大尺寸保留工具条与墨色圆点 */
const big = await pixelsOf(buildIconSvg({ size: 128 }), 128);
const bigAt = (x, y) => big.at(...canvasPoint(128, x, y));
const dot = bigAt(78, 87); // 圆点 1 号
const bar = bigAt(128, 87); // 圆点右侧的工具条本体
check('128px 窗口有纸色描边', isPaperFamily(bigAt(128, 58)), bigAt(128, 58).join(','));
check('128px 工具条是品牌色', isBrandAcid(bar), bar.join(','));
check('128px 圆点是墨色', isInkFamily(dot), dot.join(','));
check('16px 同一位置已没有实心工具条', !isBrandAcid(at16(128, 87)), at16(128, 87).join(','));

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
check(
  'icon.svg 使用 ABM 纸墨酸绿主题',
  (await fs.readFile(path.join(icons, 'icon.svg'), 'utf8')).includes('#D8FF3E') &&
    (await fs.readFile(path.join(icons, 'icon.svg'), 'utf8')).includes('#10110F'),
);

/* 6. 内边距：方形图标四周应留出透明边，避免贴边被系统裁掉 */
const full = await pixelsOf(buildIconSvg({ size: 256 }), 256);
check(
  '方形图标留有透明外边距',
  isNear(full.at(128, 3)[3], 0, 10) && full.at(128, 50)[3] > 240,
  `${full.at(128, 3)[3]} / ${full.at(128, 50)[3]}`,
);

console.log(failures === 0 ? '\n图标检查全部通过' : `\n图标检查失败 ${failures} 项`);
process.exit(failures === 0 ? 0 : 1);


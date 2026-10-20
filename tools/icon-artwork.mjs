/**
 * browser-mcp 图标设计源（唯一真相）
 * ---------------------------------------------------------------------------
 * 这里把图标拆成「形状 + 配色 + 光学尺寸」三组参数，同一份参数同时产出：
 *   1) SVG 矢量（build 脚本写成 icons/icon.svg、icon-maskable.svg、logo-lockup.svg）
 *   2) canvas 位图（同一份 SVG 交给 @napi-rs/canvas / 浏览器 canvas 逐尺寸栅格化）
 *
 * 设计栅格固定 256×256，所有坐标都相对它给，缩放交给渲染器（矢量无损）。
 *
 * 光学尺寸（optical size）：同一个图形在不同尺寸下需要不同的细节。
 * 16/32px 下浏览器工具条的 3 个圆点只有不到 1 个像素，留着只会糊成一团，
 * 所以按尺寸分三档 detail：full（≥64）、medium（32~63）、small（≤24）。
 */

const VB = 256;

/** 配色：art = 窗口主图形色，accent = 火花与工具条色，shadow = 窗口投影色 */
export const THEMES = {
  xhs: {
    label: '小红书红（默认）',
    from: '#FF4B63',
    to: '#E00D33',
    art: '#FFFFFF',
    accent: '#FF2442',
    shadow: '#7A0018',
    shadowAlpha: 0.3,
  },
  mcp: {
    label: 'MCP 蓝（与 popup 主色一致）',
    from: '#5A93FF',
    to: '#1D4ED8',
    art: '#FFFFFF',
    accent: '#2563EB',
    shadow: '#001C52',
    shadowAlpha: 0.32,
  },
  ink: {
    label: '墨黑（深色工具条）',
    from: '#39404E',
    to: '#0F1319',
    art: '#F8FAFC',
    accent: '#FF2442',
    shadow: '#000000',
    shadowAlpha: 0.46,
  },
};

/** 图形候选：默认 spark「窗口 + AI 火花」 */
export const VARIANTS = {
  spark: 'AI 火花（默认）',
  cursor: '鼠标指针（强调自动点击）',
  bridge: '节点连接（强调 MCP 桥接）',
};

/** 需要导出的常规尺寸（Chrome MV3 只用到前 4 个，大尺寸给文档/商店用） */
export const ICON_SIZES = [16, 32, 48, 128, 256, 512];

/** 尺寸 → 光学档位 */
export function detailFor(size) {
  if (size >= 64) return 'full';
  if (size >= 32) return 'medium';
  return 'small';
}

/* ------------------------------------------------------------------ 基础工具 */

const n = (v) => Math.round(v * 100) / 100;

/** 圆角矩形路径 */
function rr(x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  return [
    `M ${n(x + k)} ${n(y)}`,
    `H ${n(x + w - k)}`,
    `A ${n(k)} ${n(k)} 0 0 1 ${n(x + w)} ${n(y + k)}`,
    `V ${n(y + h - k)}`,
    `A ${n(k)} ${n(k)} 0 0 1 ${n(x + w - k)} ${n(y + h)}`,
    `H ${n(x + k)}`,
    `A ${n(k)} ${n(k)} 0 0 1 ${n(x)} ${n(y + h - k)}`,
    `V ${n(y + k)}`,
    `A ${n(k)} ${n(k)} 0 0 1 ${n(x + k)} ${n(y)}`,
    'Z',
  ].join(' ');
}

/** 只圆上面两个角的矩形路径（用于高光层，省掉 clipPath） */
function topRounded(x, y, w, h, r) {
  const k = Math.min(r, w / 2);
  return [
    `M ${n(x + k)} ${n(y)}`,
    `H ${n(x + w - k)}`,
    `A ${n(k)} ${n(k)} 0 0 1 ${n(x + w)} ${n(y + k)}`,
    `V ${n(y + h)}`,
    `H ${n(x)}`,
    `V ${n(y + k)}`,
    `A ${n(k)} ${n(k)} 0 0 1 ${n(x + k)} ${n(y)}`,
    'Z',
  ].join(' ');
}

/** 只圆下面两个角的矩形路径（用于底部内阴影层） */
function bottomRounded(x, y, w, h, r) {
  const k = Math.min(r, w / 2, h);
  return [
    `M ${n(x)} ${n(y)}`,
    `H ${n(x + w)}`,
    `V ${n(y + h - k)}`,
    `A ${n(k)} ${n(k)} 0 0 1 ${n(x + w - k)} ${n(y + h)}`,
    `H ${n(x + k)}`,
    `A ${n(k)} ${n(k)} 0 0 1 ${n(x)} ${n(y + h - k)}`,
    'Z',
  ].join(' ');
}

/** 四边内凹的火花（AI 星芒）：四条二次曲线，控制点拉向圆心形成内凹 */
function sparkPath(cx, cy, r, k = 0.3) {
  const d = r * k;
  return [
    `M ${n(cx)} ${n(cy - r)}`,
    `Q ${n(cx + d)} ${n(cy - d)} ${n(cx + r)} ${n(cy)}`,
    `Q ${n(cx + d)} ${n(cy + d)} ${n(cx)} ${n(cy + r)}`,
    `Q ${n(cx - d)} ${n(cy + d)} ${n(cx - r)} ${n(cy)}`,
    `Q ${n(cx - d)} ${n(cy - d)} ${n(cx)} ${n(cy - r)}`,
    'Z',
  ].join(' ');
}

/** 单位盒（0~1）里的鼠标指针，缩放到给定矩形 */
function cursorPath(x, y, w, h) {
  const pts = [
    [0, 0],
    [0, 0.783],
    [0.328, 0.609],
    [0.552, 1],
    [0.776, 0.935],
    [0.569, 0.565],
    [1, 0.543],
  ];
  const d = pts
    .map(([px, py], i) => `${i === 0 ? 'M' : 'L'} ${n(x + px * w)} ${n(y + py * h)}`)
    .join(' ');
  return `${d} Z`;
}

/* ------------------------------------------------------------------ 几何定义 */

/** 窗口本体：固定不动，保证所有变体轮廓一致 */
const WIN = { x: 44, y: 58, w: 168, h: 140, r: 22 };

/** 工具条 + 圆点：full 档才画圆点，medium 档只留工具条 */
const BAR = { x: 64, y: 76, w: 128, h: 22, r: 11 };
const DOTS = { y: 87, r: 4.5, xs: [78, 93, 108] };

/** 主图形的尺寸档位：小尺寸放大主图形、去掉工具条，换取干净的小图标 */
const GLYPH = {
  spark: {
    full: { kind: 'spark', cx: 128, cy: 152, r: 38 },
    medium: { kind: 'spark', cx: 128, cy: 152, r: 40 },
    small: { kind: 'spark', cx: 128, cy: 128, r: 46 },
  },
  cursor: {
    full: { kind: 'cursor', x: 100, y: 116, w: 56, h: 56 },
    medium: { kind: 'cursor', x: 102, y: 114, w: 52, h: 52 },
    small: { kind: 'cursor', x: 98, y: 98, w: 60, h: 60 },
  },
  bridge: {
    full: { kind: 'bridge', x: 82, y: 112, w: 92, h: 92 },
    medium: { kind: 'bridge', x: 84, y: 112, w: 88, h: 88 },
    small: { kind: 'bridge', x: 78, y: 78, w: 100, h: 100 },
  },
};

/** 节点连接：按 200×200 参照盒给坐标，再整体缩放到目标盒 */
function bridgeMark(box) {
  const s = box.w / 200;
  const px = (v) => box.x + v * s;
  const py = (v) => box.y + v * s;
  return {
    strokes: [
      `M ${n(px(70))} ${n(py(60))} L ${n(px(52))} ${n(py(128))}`,
      `M ${n(px(130))} ${n(py(60))} L ${n(px(148))} ${n(py(128))}`,
      `M ${n(px(46))} ${n(py(158))} Q ${n(px(100))} ${n(py(190))} ${n(px(154))} ${n(py(158))}`,
    ],
    strokeWidth: 22 * s,
    circles: [
      [px(100), py(44), 22 * s],
      [px(40), py(142), 22 * s],
      [px(160), py(142), 22 * s],
    ],
  };
}

/* ------------------------------------------------------------------ 组装 SVG */

/** 背景层：渐变底 + 顶部高光 + 底部内阴影 */
function backgroundLayers(theme, ids, maskable) {
  const shape = maskable ? rr(0, 0, VB, VB, 0) : rr(8, 8, VB - 16, VB - 16, 56);
  const x = maskable ? 0 : 8;
  const w = maskable ? VB : VB - 16;
  const r = maskable ? 0 : 56;
  return [
    `<path d="${shape}" fill="url(#${ids.bg})"/>`,
    `<path d="${topRounded(x, x, w, 150, r)}" fill="url(#${ids.sheen})"/>`,
    `<path d="${bottomRounded(x, 150, w, VB - 150 - x, r)}" fill="url(#${ids.inner})"/>`,
  ].join('\n    ');
}

/**
 * 窗口投影：单层渐变柔影（不用 feGaussianBlur，各家渲染器结果一致且没有硬边阶梯）
 * 矩形上半截被窗口挡住，露出的部分刚好是一条向下淡出的阴影。
 */
function windowShadow(theme, ids) {
  const drop = 22;
  return `<path d="${rr(WIN.x, WIN.y, WIN.w, WIN.h + drop, WIN.r)}" fill="url(#${ids.shadow})"/>`;
}

/** 主图形（火花 / 指针 / 节点） */
function glyphLayer(variant, detail, theme) {
  const g = GLYPH[variant][detail];
  if (g.kind === 'spark') {
    return `<path d="${sparkPath(g.cx, g.cy, g.r)}" fill="${theme.accent}"/>`;
  }
  if (g.kind === 'cursor') {
    return `<path d="${cursorPath(g.x, g.y, g.w, g.h)}" fill="${theme.accent}"/>`;
  }
  const mark = bridgeMark(g);
  const strokes = mark.strokes
    .map(
      (d) =>
        `<path d="${d}" stroke="${theme.accent}" stroke-width="${n(mark.strokeWidth)}" stroke-linecap="round" fill="none"/>`,
    )
    .join('\n      ');
  const circles = mark.circles
    .map(([cx, cy, r]) => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${theme.accent}"/>`)
    .join('\n      ');
  return `${strokes}\n      ${circles}`;
}

/** 浏览器窗口：工具条（含圆点）+ 主图形 */
function windowLayer(variant, detail, theme) {
  const parts = [`<path d="${rr(WIN.x, WIN.y, WIN.w, WIN.h, WIN.r)}" fill="${theme.art}"/>`];
  if (detail !== 'small') {
    parts.push(`<path d="${rr(BAR.x, BAR.y, BAR.w, BAR.h, BAR.r)}" fill="${theme.accent}"/>`);
    if (detail === 'full') {
      parts.push(
        DOTS.xs
          .map(
            (x, i) =>
              `<circle cx="${x}" cy="${DOTS.y}" r="${DOTS.r}" fill="${theme.art}" opacity="${[0.95, 0.7, 0.45][i]}"/>`,
          )
          .join('\n      '),
      );
    }
  }
  parts.push(glyphLayer(variant, detail, theme));
  return parts.join('\n    ');
}

/**
 * 生成图标 SVG 源码
 * @param {object} [opts]
 * @param {number} [opts.size=256]        输出 width/height（决定栅格化精度，viewBox 不变）
 * @param {string} [opts.theme='xhs']     配色 key
 * @param {string} [opts.variant='spark'] 图形 key
 * @param {string} [opts.detail]          强制光学档位，默认按 size 推导
 * @param {boolean} [opts.maskable]       全出血版本（平台遮罩用）
 */
export function buildIconSvg(opts = {}) {
  const { size = 256, theme = 'xhs', variant = 'spark', maskable = false } = opts;
  const t = THEMES[theme] ?? THEMES.xhs;
  const v = VARIANTS[variant] ? variant : 'spark';
  const detail = opts.detail && GLYPH[v][opts.detail] ? opts.detail : detailFor(size);
  const suffix = `${theme}-${v}-${detail}${maskable ? '-m' : ''}`;
  const ids = {
    bg: `bg-${suffix}`,
    sheen: `sheen-${suffix}`,
    inner: `inner-${suffix}`,
    shadow: `shadow-${suffix}`,
  };
  const shadowTop = WIN.y + WIN.h - 8;
  const shadowBottom = WIN.y + WIN.h + 22;

  // maskable：主图形收到 76%，落在 80% 安全区内，四周留给平台遮罩
  const markTransform = maskable
    ? ` transform="translate(${VB / 2} ${VB / 2}) scale(0.76) translate(${-VB / 2} ${-VB / 2})"`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- 由 tools/icon-build.mjs 从 tools/icon-artwork.mjs 生成，请勿手改 -->
<svg width="${size}" height="${size}" viewBox="0 0 ${VB} ${VB}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="${ids.bg}" x1="0" y1="0" x2="${VB}" y2="${VB}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${t.from}"/>
      <stop offset="1" stop-color="${t.to}"/>
    </linearGradient>
    <linearGradient id="${ids.sheen}" x1="0" y1="0" x2="0" y2="${VB}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.16"/>
      <stop offset="0.55" stop-color="#FFFFFF" stop-opacity="0.03"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="${ids.inner}" x1="0" y1="150" x2="0" y2="${VB}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.16"/>
    </linearGradient>
    <linearGradient id="${ids.shadow}" x1="0" y1="${shadowTop}" x2="0" y2="${shadowBottom}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${t.shadow}" stop-opacity="0"/>
      <stop offset="${n(8 / (shadowBottom - shadowTop))}" stop-color="${t.shadow}" stop-opacity="${t.shadowAlpha}"/>
      <stop offset="1" stop-color="${t.shadow}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  ${backgroundLayers(t, ids, maskable)}
  <g${markTransform}>
    ${windowShadow(t, ids)}
    ${windowLayer(v, detail, t)}
  </g>
</svg>
`;
}

/** 文档用横版组合：图标 + 中英文字标 */
export function buildLockupSvg(opts = {}) {
  const { theme = 'xhs', variant = 'spark', width = 760, height = 176 } = opts;
  const icon = buildIconSvg({ size: 256, theme, variant, detail: 'full' })
    .replace(/^<\?xml[^>]*\?>\n/, '')
    .replace(/^<!--[^>]*-->\n/, '')
    .replace(/<svg[^>]*>/, '<g transform="translate(24 24) scale(0.5)">')
    .replace(/<\/svg>\s*$/, '</g>');
  const family =
    "'Inter', 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', system-ui, sans-serif";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- 由 tools/icon-build.mjs 从 tools/icon-artwork.mjs 生成，请勿手改 -->
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  ${icon}
  <text x="172" y="78" font-family="${family}" font-size="44" font-weight="700" fill="#111827">浏览器 MCP 助手</text>
  <text x="174" y="116" font-family="${family}" font-size="19" fill="#6B7280">a browser mcp · 把浏览器交给 AI</text>
</svg>
`;
}


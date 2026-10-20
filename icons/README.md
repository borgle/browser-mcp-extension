# browser-mcp 图标

图形语言：一个白色「浏览器窗口」里放一枚品牌色标记——窗口代表浏览器控制权，标记代表 AI 在驱动它。
窗口带一条工具条（含三个圆点）和一层向下淡出的柔影，底色是品牌渐变，
整体在 16px 下仍能读出「白窗 + 品牌色标记」。

标记有三种候选（`--variant`）：`spark` AI 火花（设计源默认）、`cursor` 鼠标指针（强调自动点击）、
`bridge` 节点连接（强调 MCP 桥接）。

> **仓库里当前提交的是 `mcp` 配色（蓝 `#2563EB`，与 popup 主色一致）+ `cursor` 指针变体**
> ——即 `npm run icon:build:shipped` 的结果。换配色/图形见下方命令，
> 改完请把这一段一起更新（这几行说的就是仓库里实际提交的那套）。

## 文件

| 文件 | 用途 |
| --- | --- |
| `icon.svg` | 主图标矢量源（256 栅格、全细节），改色改形都从这里重新生成 |
| `icon-maskable.svg` | 全出血版本，主图形收在 80% 安全区内，给会套圆形/圆角遮罩的平台用 |
| `logo-lockup.svg` | 文档/截图用横版组合：图标 + 中英文字标 |
| `icon-16.png` / `32` / `48` / `128` | manifest 实际引用的四档位图（工具栏、扩展页、商店） |
| `icon-256.png` / `icon-512.png` | 大尺寸位图，给文档、商店页面、宣传图用 |
| `icon-preview.png` | 对照图：浅色底尺寸阶梯、深色底 + 遮罩裁切、三套配色与三个图形候选 |

## 生成方式：SVG + canvas

图标不是手绘位图，而是**一份参数化设计源**同时产出矢量与位图：

```
tools/icon-artwork.mjs          参数化的几何 / 配色 / 光学尺寸（唯一真相）
        ├─ tools/icon-build.mjs   → icons/*.svg（矢量源码）
        └─ @napi-rs/canvas        → icons/icon-*.png（Skia 内核 canvas 逐尺寸栅格化）
```

两点值得说明：

1. **按目标尺寸原生栅格化**。每个 PNG 都把 SVG 的 `width`/`height` 直接写成目标像素再交给 canvas，
   而不是先渲染大图再缩小，所以 16/32px 的边缘更干净。
2. **光学尺寸（optical size）**。同一个图形在不同尺寸需要不同细节，脚本按尺寸自动取舍：

   | 档位 | 尺寸 | 保留的细节 |
   | --- | --- | --- |
   | `full` | ≥ 64px | 窗口 + 工具条 + 三个圆点 + 标记 |
   | `medium` | 32~63px | 窗口 + 工具条（去掉圆点：该尺寸下圆点不足 1px，留着只会糊） |
   | `small` | ≤ 24px | 窗口 + 放大的标记（去掉工具条，换取干净的小图标） |

## 命令

首次需要装一次依赖（只为图标工具链，扩展本身仍然是无构建步骤的纯源码）：

```bash
npm install
```

```bash
npm run icon:lab                          # 打开 canvas 工作台：改配色/图形/尺寸，实时预览与导出
npm run icon:build                        # 按当前参数重写 icons/ 下的 SVG、PNG 与对照图（xhs 红）
npm run icon:build:shipped                # 仓库当前提交的组合：mcp 蓝 + cursor 指针
npm run icon:build:mcp                    # 只换配色：mcp（蓝，与 popup 主色一致）
npm run icon:build:ink                    # 换配色：ink（深色）
node tools/icon-build.mjs --theme=mcp --variant=cursor   # 需要其它组合时直接调脚本（spark / cursor / bridge）
```

> 注意：`npm run icon:build -- --theme=xxx` 这种透传写法在部分 npm 版本上会被当成 npm 自身参数报错，
> 所以常用配色都做成了独立脚本；需要任意组合时用上面的 `node tools/icon-build.mjs --theme=…`。

> 手工在工作台里导出、或从别处拷进来的 PNG **不会**经过构建脚本的尺寸/透明度自检，
> 容易出现「像素尺寸不是标称值」（例如 128 的图标实际是 160×160）这类问题。
> 建议一律用 `icon:build*` 产出，并用 `npm test`（含 `test/icon.test.mjs`）把关。

工作台（`tools/icon-lab.html`）用同一个模块画图，便于逐项检查：像素网格、浅色/深色/棋盘底、
圆形与圆角方形遮罩裁切、16/24/32/48/128 尺寸阶梯，以及按尺寸导出 PNG / SVG。
改完参数后建议接着跑一次 `npm run icon:build`，让仓库文件和工作台看到的一致。

## 装进扩展

`manifest.json` 引用的就是 `icons/icon-16.png`、`32`、`48`、`128`，路径和文件名都没变，
所以重做图标不需要改 manifest。Chrome 只接受位图，因此 SVG 保留为设计源、由脚本导出 PNG。

## 自检口径

构建脚本每次都会核对：每个 PNG 的宽高等于目标尺寸、四角 alpha = 0（圆角和透明底没丢）、
中心 alpha = 255（图形没被裁空）、覆盖率达到预期量级（约 84%~95%，与圆角半径和内边距相符）。

工作台上另有肉眼检查项：16px 下是否还能看出白窗与标记、深色底上白窗对比是否足够、
遮罩裁切后标记是否仍在安全区内。


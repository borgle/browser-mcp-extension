# ABM（a browser mcp）浏览器扩展

ABM 是 **a browser mcp** 的简称。本仓库是 ABM 的 Chrome 扩展端，开源。它把用户自己的浏览器连接到 ABM 托管服务，让 MCP 客户端执行页面自动化、数据提取、网络检查和文件/视频投递。

- 官方服务：https://abm.borgle.io
- 隐私政策：[docs/PRIVACY.md](docs/PRIVACY.md)
- 发布与签名：[docs/RELEASING.md](docs/RELEASING.md)

## 功能

- 标签管理：导航、创建、查询、更新、激活和关闭；按站点、同源或 `reuseKey` 复用标签。
- 页面自动化：等待元素、点击、填表、键盘输入、CDP 鼠标点击和滚动。
- 页面数据：提取 DOM、读取 `window`/`document`、在 MAIN world 执行脚本；页面 CSP 禁止 eval 时自动用 CDP 兜底。
- 网络与文件：拦截并检查网络请求，上传 base64、URL 或本地路径文件。
- 视频投递：通过 bridge 或 URL 通道暂存视频并注入文件输入框。
- 连接与通知：WebSocket 自动重连、Key 失效处理、通知角标和可信视频桥配置。

## 快速开始

### 1. 获取 API Key

打开 [ABM 官方服务](https://abm.borgle.io)，创建 API Key 后即可免费使用。

### 2. 加载扩展

1. 克隆本仓库。
2. 打开 `chrome://extensions`，启用开发者模式。
3. 点击“加载已解压的扩展程序”，选择本仓库目录。
4. 打开扩展 popup，填写服务地址和 API Key。

扩展源码可直接加载，不需要构建步骤。`npm install` 只用于运行测试、生成预览和打包。

服务地址默认是：

```text
https://abm.borgle.io
```

扩展会自动派生 WebSocket 地址：

```text
wss://<server>/api/v1/extension/ws
```

API Key 格式：

```text
abm_<public-prefix>_<secret>
```

需要控制该浏览器连接的 MCP 客户端必须使用同一把 Key。

## 工作方式

```text
MCP 客户端 <-> ABM 托管服务 <-> WebSocket（abm/1） <-> Chrome 扩展 <-> 页面
```

扩展主动连接 ABM 服务，只执行已认证的工具请求；页面操作结果通过 ABM 服务返回给 MCP 客户端。消息使用 `abm/1` 信封：

```json
{"v":"abm/1","id":"message-id","type":"tool.invoke","payload":{}}
```

扩展端只实现客户端协议，通过 WebSocket 连接 ABM 托管服务。

## 标签复用

`browser_navigate` 根据目标 URL 推导复用范围，不需要维护站点白名单：

| `reuse` | 复用范围 |
| --- | --- |
| `true` / `"site"`（默认） | 同主机，忽略 `www.`、`m.`、`mobile.` 前缀，不跨子域 |
| `"origin"` | 协议、主机、端口完全一致 |
| `false` | 总是新建标签 |

只复用属于 `abm:browser` 自动分组的标签，不会接管用户的私人标签页。同一站点需要多个独立工作标签时传 `reuseKey`：同一 key 始终落到同一个标签，首次出现会新建，不复用同站点其他标签。

## 开发

```bash
npm install
npm test
npm run syntax
npm run preview
```

- `npm test`：单元测试和契约检查
- `npm run syntax`：检查全部 JS 和 manifest 引用
- `npm run preview`：生成 popup 预览
- 打包、CRX 签名、GitHub Release 和 Chrome Web Store 发布见 [docs/RELEASING.md](docs/RELEASING.md)

目录概览：

```text
src/             扩展后台、工具和连接逻辑
inject-scripts/  ISOLATED/MAIN world 注入桥与执行器
popup/           扩展设置和状态界面
test/            自动化测试
docs/            隐私政策和发布说明
```

## 安全与隐私

- API Key 只保存在扩展本地存储，不向普通网页暴露。
- 视频桥只接受 manifest `externally_connectable.matches` 中声明的可信来源。
- 域名权限必须显式申请，用户可随时撤销。
- 扩展不保存账号密码或账号会话 Cookie。
- `browser_inject_script` 在 MAIN world 执行；页面 CSP 禁止 eval 时才会临时附加 CDP，并在执行后释放。

完整的数据处理说明见 [隐私政策](docs/PRIVACY.md)。

## 贡献范围

本仓库只维护 Chrome 扩展端；账号和托管服务相关问题请通过官方服务渠道反馈。扩展端的 Bug 和 PR 欢迎提交到本仓库。

## 许可证

扩展端代码采用 MIT 许可证。

## 鸣谢

本扩展的浏览器自动化能力与交互设计根据 [X-MCP](https://github.com/xpzouying/x-mcp) 演化而来。感谢 `xpzouying` 及 X-MCP contributors 的公开工作。

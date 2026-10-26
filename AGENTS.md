# ABM（a browser mcp）浏览器扩展 开发指南

## 开始前必读

ABM 是 **a browser mcp** 的简称。

修改代码前先阅读：

1. 配套 `browser-mcp-server` 仓库中的 `docs/architecture.md`。
2. 本仓库的 `docs/architecture.md`、`docs/detailed-design.md`。
3. `docs/data-flow.md` 与 `docs/scenarios.md` 中受影响链路。
4. 配套仓库中的 `docs/development-plan.md`。
5. 当前模块的 README、manifest 与测试。

两个仓库完全独立，只通过文档化的 HTTP、WebSocket 和扩展外部消息契约通信。

## 功能范围

扩展负责将用户浏览器接入 ABM（a browser mcp），能力包括：

- 标签导航、创建、查询、更新、激活和关闭。
- DOM 查询、元素等待、点击、填表、键盘输入和数据提取。
- 在页面主环境执行脚本；隔离世界仅用于扩展内部注入桥和视频执行器。
- 通过 Chrome DevTools Protocol 拦截网络请求并读取响应。
- CDP 鼠标点击、滚轮滚动和定时输入事件序列。
- 单文件、多文件、URL 文件和本地路径文件上传。
- base64 文件组装和浏览器文件输入框注入。
- 视频字节暂存、URL 下载、页面视频注入和投递进度。
- 页面脚本桥与自定义事件处理。
- 通知存储、未读角标和可操作链接。
- WebSocket 连接、鉴权、心跳、重连和 Key 失效处理。
- 下载域名权限、可信视频桥来源、连接设置和账号入口。

## 强制命名

- 服务端 API 根路径：`/api/v1`
- 扩展 WebSocket 路径：`/api/v1/extension/ws`
- WebSocket 协议：`abm/1`
- WebSocket 子协议：`abm.v1`
- 扩展存储命名空间：`abm.*`
- API Key：`abm_<prefix>_<secret>`
- 业务错误：`ABM_*`
- 浏览器工具：`browser_*`
- 桥页面消息：`abm.*`

不得引入其他产品前缀、重复协议枚举或跨仓库源码导入。

## 模块边界

- `core/protocol.js`：信封校验、消息构造和错误码。
- `core/connection.js`：连接生命周期、心跳、退避和替换处理。
- `core/storage.js`：统一访问 `abm.*` 设置和运行状态。
- `core/ui-language.js`：页面 toast 语言解析（`abm.lang` 优先，其次 Chrome UI 语言，非中文回退英文）。
- `core/lifecycle.js`：service worker 初始化和恢复。
- `tools/registry.js`：工具注册与分发。
- `tools/*.js`：浏览器、DOM、上传、CDP 和页面数据操作（19 个扩展工具）。
- `tabs.js` / `reuse.js`：标签等待、自动分组和复用范围。
- `cdp.js` / `injectable.js`：CDP 生命周期和 MAIN/ISOLATED 注入。
- `video/receiver.js` / `video/store.js`：视频桥外部消息和内存暂存。
- `permissions/`：Chrome 域名权限管理。
- `notices/`：通知持久化与角标状态。
- `popup/`：概览、设置、通知、账号入口和关于。
- `popup/i18n.js`：popup 中英文词典、语言持久化和错误文案映射。
- `_locales/`：扩展名称/描述的中英文 manifest 资源。
- `inject-scripts/`：页面注入桥和 MAIN world 执行器。

不要在 service worker 入口堆积无关职责。

## 协议规则

所有 WebSocket 消息使用：

```json
{"v":"abm/1","id":"...","type":"...","payload":{}}
```

必需消息类型：

- `session.hello`
- `session.ready`
- `session.identify`
- `session.ping`
- `session.pong`
- `tool.invoke`
- `tool.result`
- `notice.push`
- `error`

客户端行为：

- 连接建立后立即发送 `session.hello`。
- 每条消息都校验协议版本。
- 使用信封 `id` 关联工具请求和结果。
- `retryable=false` 表示当前凭证需要用户处理。
- 根据 `action` 选择用户可执行的恢复路径。
- 可重试错误使用带抖动的指数退避。
- Key 被拒绝、吊销或账号停用后停止重连。

WebSocket 关闭码只使用标准协议值，业务语义来自 `ABM_*`、`retryable` 和 `action`。

## 安全规则

- API Key 只保存在扩展本地存储。
- API Key 不得暴露给页面内容或任意网站。
- 只向 manifest `externally_connectable.matches` 中声明的来源开放视频桥能力。
- 处理外部消息前校验消息结构和来源。
- 注入脚本与扩展配置保持隔离。
- 扩展不保存密码或账号会话 Cookie。
- 日志不得包含完整 API Key。

## 工具规则

- 全部公开工具使用 `browser_*` 命名。
- 工具名称和参数与服务端架构契约一致。
- 扩展注册 19 个浏览器工具；`browser_open_session`、`browser_close_session`、`browser_stage_video`、`browser_send_notice` 由服务端执行。
- 工具结果必须可序列化并限制体积。
- 长任务遵守超时和取消规则。
- 需要域名访问的操作必须先检查浏览器权限。
- 视频工具统一使用暂存接收器，不维护独立缓存。
- popup 文案必须走 `popup/i18n.js`，新增字符串同时补齐 `zh` 和 `en`；不得只写单一语言。
- manifest 的 name/description 使用 `_locales`，修改后运行 `test/popup-i18n.test.mjs`。

## 开发流程

1. 确定所属模块与公开契约。
2. 添加或更新聚焦测试。
3. 在不破坏模块边界的前提下实现改动。
4. 执行语法、单元和契约测试。
5. 在 Chrome 中验证受影响的浏览器行为。
6. 公共行为变化时更新 README 或契约说明。
7. 提交只发生在本仓库。

测试命令：

```bash
npm test
npm run syntax
npm run preview
```

浏览器验证通过 `chrome://extensions` 加载当前目录的 unpacked extension。

## 完成标准

- 工具和消息命名符合 ABM 契约。
- 错误与重试行为符合架构表。
- 新增浏览器权限有明确依据和文档。
- API Key 保持本地存储和脱敏。
- 自动化测试通过。
- 依赖浏览器的改动已完成 Chrome 验证。
- 文档与可观察行为一致。



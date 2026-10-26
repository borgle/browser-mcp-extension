# ABM 浏览器扩展使用场景

> 本文从扩展使用者/开发者视角给出典型场景。工具参数以配套 `browser-mcp-server` 仓库的 `docs/architecture.md` 和 `docs/scenarios.md` 为准。

## 0. 前置条件

- Chrome 已加载本扩展（`chrome://extensions` → 加载已解压的扩展）。
- 已有 ABM 服务地址和 `abm_...` API Key。
- 扩展 popup 显示“已连接”。
- MCP 客户端已完成 OAuth；`pinned` 模式可直接调用浏览器工具，`pool`/`auto` 多连接时先 `browser_open_session`。

## 1. 安装并连接

1. 克隆仓库。
2. 打开 `chrome://extensions`，开启开发者模式。
3. 点击“加载已解压的扩展程序”，选择仓库目录。
4. 打开 popup：
   - 服务端：`https://abm.example.com`
   - API Key：完整 `abm_<prefix>_<secret>`
   - 自动重连：开启
5. 点击“连接”。

预期：

- 状态变为“已连接”。
- 概览显示账号名、套餐、扩展 ID。
- 服务端 `/api/v1/session/status` 能看到该连接。

失败：

| 现象 | 处理 |
|---|---|
| `ABM_INVALID_API_KEY` | 检查 Key 是否完整、是否已吊销 |
| `ABM_API_KEY_REVOKED` | 在控制台创建新 Key，替换后重连 |
| `ABM_ACCOUNT_DISABLED` | 联系管理员恢复账号 |
| 连接超时 | 检查服务器地址、WSS、反向代理和证书 |

## 2. 打开页面并复用标签

```json
{"name":"browser_navigate","arguments":{
  "url":"https://example.com/search?q=abm",
  "waitUntil":"load",
  "reuse":"site"
}}
```

行为：

- 若已有同站点 `abm:browser` 标签，直接复用。
- 否则新建标签并加入 `abm:browser` 分组。
- 返回 `tabId`、`reused`、`reuseMode`。

同一站点两个独立工作区：

```json
{"name":"browser_navigate","arguments":{
  "url":"https://example.com/search?q=A",
  "reuseKey":"search-A"
}}
```

```json
{"name":"browser_navigate","arguments":{
  "url":"https://example.com/search?q=B",
  "reuseKey":"search-B"
}}
```

两个 key 不会落到同一标签。标签被关闭后，下次按站点规则重建。

## 3. 等待、点击、填表

```json
{"name":"browser_wait_elements","arguments":{"selector":"#email","count":1,"timeout":10000}}
```

```json
{"name":"browser_fill","arguments":{
  "selector":"#email",
  "value":"ada@example.com",
  "clearBefore":true
}}
```

```json
{"name":"browser_fill","arguments":{"selector":"#password","value":"secret"}}
```

```json
{"name":"browser_click","arguments":{
  "selector":"button[type=submit]",
  "waitClickable":true
}}
```

如果点击会触发跳转，建议紧接着等待目标元素：

```json
{"name":"browser_wait_elements","arguments":{"selector":".dashboard","count":1,"timeout":15000}}
```

## 4. 提取数据

提取所有结果行文本：

```json
{"name":"browser_extract_data","arguments":{
  "selector":".result-row",
  "source":"element",
  "attribute":"textContent",
  "all":true
}}
```

读取页面全局变量：

```json
{"name":"browser_read_page_data","arguments":{
  "path":"__NEXT_DATA__.props.pageProps"
}}
```

在页面主环境执行脚本：

```json
{"name":"browser_inject_script","arguments":{
  "code":"return document.title + ' / ' + args.suffix",
  "args":{"suffix":"ABM"}
}}
```

页面 CSP 禁止 eval 时，扩展会自动使用 CDP 兜底。

## 5. 上传文件

### 5.1 单文件

```json
{"name":"browser_upload_file","arguments":{
  "selector":"input[type=file]",
  "base64Data":"<base64>",
  "fileName":"report.pdf",
  "mimeType":"application/pdf"
}}
```

### 5.2 多文件

```json
{"name":"browser_set_files","arguments":{
  "selector":"input[type=file]",
  "files":[
    {"base64Data":"<base64>","fileName":"a.png","mimeType":"image/png"},
    {"base64Data":"<base64>","fileName":"b.png","mimeType":"image/png"}
  ]
}}
```

### 5.3 URL 文件

```json
{"name":"browser_set_files_from_urls","arguments":{
  "selector":"input[type=file]",
  "urls":[{"url":"https://example.com/a.png","fileName":"a.png"}]
}}
```

如果返回：

```json
{"success":false,"needPermission":true,"host":"example.com"}
```

在 popup 的“权限”页添加 `example.com`，或一键授权所有域名，然后重试。

### 5.4 本机路径

```json
{"name":"browser_set_files_native","arguments":{
  "selector":"input[type=file]",
  "paths":["C:\\Users\\ada\\Documents\\report.pdf"]
}}
```

只能使用扩展所在机器可访问的绝对路径。

## 6. 视频投递

### 6.1 Bridge

1. 保持扩展在线。
2. 打开 `/video-bridge`。
3. 调用：

```json
{"name":"browser_stage_video","arguments":{
  "fileName":"demo.mp4",
  "fileType":"video/mp4",
  "url":"https://example.com/demo.mp4",
  "delivery":"bridge"
}}
```

4. 桥页面分片推送，扩展组装到暂存区。
5. 注入页面：

```json
{"name":"browser_set_video_to_page","arguments":{
  "selector":"input[type=file]",
  "clearAfterSet":true
}}
```

### 6.2 URL

```json
{"name":"browser_stage_video","arguments":{
  "fileName":"demo.mp4",
  "url":"https://example.com/demo.mp4",
  "delivery":"url"
}}
```

扩展自己下载到暂存区；需要视频域名权限。

### 6.3 Auto

省略 `delivery` 或设为 `auto`：

- 扩展在线 → 先 URL。
- URL 失败 → 回退 bridge。
- 扩展离线 → bridge。

注意：视频字节在 service worker 内存，30 分钟后或 SW 回收后丢失，需要重新投递。

## 7. 网络抓包

```json
{"name":"browser_network_intercept","arguments":{"cmd":"start","tabId":123}}
```

```json
{"name":"browser_network_intercept","arguments":{"cmd":"list","filter":"/api/"}}
```

```json
{"name":"browser_network_intercept","arguments":{
  "cmd":"detail",
  "requestId":"12345.67",
  "compress":true
}}
```

```json
{"name":"browser_network_intercept","arguments":{"cmd":"stop","tabId":123}}
```

抓包数据只在 service worker 生命周期内有效；大响应默认压缩。

## 8. 真实鼠标/键盘

```json
{"name":"browser_mouse_click","arguments":{
  "x":420,
  "y":360,
  "button":"left",
  "clickCount":1
}}
```

```json
{"name":"browser_mouse_scroll","arguments":{
  "deltaY":600,
  "steps":3,
  "intervalMs":80
}}
```

```json
{"name":"browser_input_sequence","arguments":{
  "events":[
    {"type":"mouseMoved","x":400,"y":300},
    {"type":"mousePressed","x":400,"y":300,"button":"left","clickCount":1},
    {"type":"mouseReleased","x":400,"y":300,"button":"left","clickCount":1},
    {"type":"insertText","text":"hello","after":100}
  ]
}}
```

CDP 会在空闲 90 秒后自动 detach；如果输入事件没有响应，会进入 60 秒冷却。

## 9. 通知

服务端调用 `browser_send_notice` 后：

- 扩展保存通知，popup 通知板可见。
- 未读时扩展图标显示红点。
- 点击通知可打开 `actionUrl`（仅 http/https）。
- 最多保留 20 条。

## 10. Key 轮换与撤销

1. 在控制台创建新 Key。
2. 在 popup 编辑 API Key，保存。
3. 旧连接被断开，新连接建立。
4. 在控制台吊销旧 Key。

预期：

- 旧 Key 立即无法连接。
- 使用旧 Key 的连接被服务端关闭。
- 扩展不会继续用旧 Key 重连。
- 当前 Key 被吊销时，popup 显示“Key 已失效”，需要用户更换。

## 11. 多个工作标签

场景：同时处理两个搜索结果或两个后台页面。

```json
{"name":"browser_navigate","arguments":{
  "url":"https://example.com/search?q=A",
  "reuseKey":"search-A"
}}
```

```json
{"name":"browser_navigate","arguments":{
  "url":"https://example.com/search?q=B",
  "reuseKey":"search-B"
}}
```

后续工具通过 `tabId` 精确指定：

```json
{"name":"browser_extract_data","arguments":{
  "tabId":123,
  "selector":".result",
  "all":true
}}
```

`reuseKey` 映射最多 50 个，超出后最旧的记录被清理。

## 12. 权限管理

- 内置域名：`127.0.0.1`、`localhost`，安装时已授权，不能移除。
- 固定 manifest 站点：静态授权，不能通过 popup 移除。
- 可选域名：用户添加后授权，随时可移除。
- 一键授权所有域名：授予 `<all_urls>`，适合频繁下载不同站点。
- 撤销后，URL 下载/上传会重新返回 `needPermission`。

## 13. 切换界面语言

popup 右上角有 `中文 / EN` 切换：

1. 点击目标语言。
2. 静态标签、状态、权限、通知、相对时间和错误提示会立即切换。
3. 选择保存在 `abm.lang`，下次打开 popup 继续使用。
4. 扩展名称和描述由 `_locales/en`、`_locales/zh_CN` 根据 Chrome UI 语言本地化。

注意：通知的标题和正文来自服务端/Agent 内容，不会自动翻译；界面按钮、状态和提示会翻译。

## 14. 故障排查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| popup 一直“未连接” | 服务器地址错误、WSS 不可达 | 检查地址、证书、反向代理 |
| 连接后马上断开 | Key 无效/吊销/账号停用 | 查看 popup 错误，创建新 Key |
| 工具返回 `Tool not found` | 服务端/扩展工具名不一致 | 检查 `test/parity.mjs` 和版本 |
| 点击无效 | 元素被遮挡/未加载 | 先 `browser_wait_elements`，或改用 CDP 点击 |
| 上传 `needPermission` | host 未授权 | 在权限页添加域名 |
| 视频注入 `needUpload` | 暂存区为空/已过期 | 重新 `browser_stage_video` 或下载 |
| 网络抓包为空 | 未 start / 请求已完成 / SW 回收 | 重新 start，检查 tabId |
| 输入事件无响应 | 页面吞事件 | 等待 60 秒冷却，或改用 DOM click |
| 标签复用错 | 目标标签不在 `abm:browser` | 只用自动分组标签，或传 `tabId` |
| 扩展更新后行为异常 | 旧 SW 缓存 | 在 `chrome://extensions` 重新加载扩展 |

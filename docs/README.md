# ABM 浏览器扩展文档索引

本目录是 `browser-mcp-extension` 的设计与操作文档。服务端文档位于配套仓库 `browser-mcp-server/docs/`。

## 文档地图

| 文档 | 回答的问题 | 主要读者 |
|---|---|---|
| [architecture.md](architecture.md) | 扩展在系统中的位置、组件、协议、安全边界 | 所有人 |
| [detailed-design.md](detailed-design.md) | 连接状态机、工具实现、注入、CDP、视频、权限、存储 | 扩展开发者 |
| [data-flow.md](data-flow.md) | 配置、连接、工具、上传、视频、通知如何流动 | 开发者、联调、排障 |
| [scenarios.md](scenarios.md) | 安装、导航、填表、上传、视频、故障排查的具体步骤 | 使用者、测试 |
| [PRIVACY.md](PRIVACY.md) | 数据处理和隐私说明 | 用户、审核 |
| [RELEASING.md](RELEASING.md) | 打包、签名、GitHub Release、商店发布 | 维护者 |

## 推荐阅读顺序

**第一次接触扩展**

1. `architecture.md` 第 1–5 节。
2. `data-flow.md` 的安装、配置、握手三张图。
3. `detailed-design.md` 第 3–5 节：连接、协议、工具分发。
4. `scenarios.md` 的安装连接、导航、填表。

**开发一个新工具**

1. `architecture.md` 第 5–6 节。
2. `detailed-design.md` 第 5–7 节。
3. `data-flow.md` 的工具调用图。
4. 服务端 `docs/architecture.md` 的工具 Schema。
5. `test/parity.mjs` 与相关测试。

**排查连接/视频/权限问题**

1. `data-flow.md` 对应链路。
2. `detailed-design.md` 第 3、7、8、12 节。
3. `scenarios.md` 的故障排查表。

## 权威顺序

1. 代码和自动化测试。
2. `architecture.md` 的公开契约。
3. `detailed-design.md` 的实现说明。
4. `data-flow.md` 与 `scenarios.md` 的示例。

发现冲突时，先修实现或契约，再改示例。

## 跨仓库契约

- WebSocket：`/api/v1/extension/ws`，协议 `abm/1`，子协议 `abm.v1`。
- 视频桥：`abm.bridge.*`、`abm.video.*`。
- HTTP：视频 URL 下载、配置查询。

不得从扩展仓库导入服务端源码，也不得让扩展承担 OAuth、账号或 MCP 服务职责。

服务端对应文档：

- `browser-mcp-server/docs/architecture.md`
- `browser-mcp-server/docs/detailed-design.md`
- `browser-mcp-server/docs/data-flow.md`
- `browser-mcp-server/docs/scenarios.md`

## 维护规则

- 修改 `abm/1` 消息、工具名/参数、错误码、权限或视频桥消息时，同步更新 `architecture.md`、`data-flow.md` 和相关场景。
- 修改连接状态机、CDP、注入、存储键或工具实现时，同步更新 `detailed-design.md`。
- 新增工具时，同时更新服务端 Schema、扩展注册表和 `test/parity.mjs`。
- 文档示例不得包含真实 API Key、会话 Cookie、密码或视频字节。
- Mermaid 图必须能渲染；命令和路径必须与当前仓库一致。

# ABM 浏览器扩展数据流

> 本文描述扩展内部和跨进程的数据流。协议字段见 [architecture.md](architecture.md)，实现细节见 [detailed-design.md](detailed-design.md)。

## 0. 参与方

| 参与方 | 说明 |
|---|---|
| Popup | 扩展弹窗，读写配置和权限 |
| SW | service worker，运行连接和工具 |
| Store | `chrome.storage.local` / `chrome.storage.session` |
| Server | ABM 服务端 |
| Tab | 用户标签页 |
| Bridge | 受信视频桥页面 |
| CDP | Chrome DevTools Protocol |
| Inject | `inject-scripts/*` |

## 1. 安装与启动

```mermaid
sequenceDiagram
    autonumber
    participant C as Chrome
    participant SW as Service Worker
    participant S as chrome.storage
    participant Server as ABM Server
    C->>SW: 启动 src/background.js
    SW->>SW: startLifecycle()
    SW->>SW: registerBuiltinTools()
    SW->>SW: 安装 popup / external / tab / debugger 监听
    SW->>S: initHostListOnce + refreshBadge
    SW->>S: loadConnectionConfig()
    SW->>SW: wsClient.updateConfig()
    SW->>S: 读取 rejectedApiKey + shouldReconnect
    alt 有有效配置且应重连
        SW->>Server: WebSocket connect
    else 无配置或已拒绝
        SW->>SW: 保持 disconnected
    end
```

失败点：

- 配置读取失败 → 使用默认值。
- 被拒绝 Key 与当前 Key 相同 → 不自动连接。
- 权限/角标 API 失败 → 忽略，不阻塞连接。

## 2. Popup 保存配置并连接

```mermaid
sequenceDiagram
    autonumber
    participant U as 用户
    participant P as Popup
    participant SW as Service Worker
    participant S as chrome.storage
    participant Server as ABM Server
    U->>P: 输入服务器地址和 API Key
    P->>SW: abm.popup.saveConfig
    SW->>S: 写入 abm.connection
    SW->>SW: wsClient.updateConfig
    alt 服务器或 Key 变化
        SW->>SW: 清除拒绝状态 + 断开旧连接
    end
    U->>P: 点击连接
    P->>SW: abm.popup.connect
    SW->>Server: WebSocket + session.hello
    Server-->>SW: session.ready
    SW-->>P: 状态广播 ABM_SERVER_STATUS_CHANGED
    P-->>U: 显示已连接
```

规则：

- 只切换“自动重连”不会断开现有连接。
- 修改服务器/Key 会断开旧连接。
- 连接状态通过 `chrome.runtime.sendMessage` 广播，popup 也可主动查询。

## 3. 握手、心跳与重连

```mermaid
sequenceDiagram
    autonumber
    participant SW as Service Worker
    participant Server as ABM Server
    participant A as chrome.alarms
    SW->>Server: WS open（abm.v1）
    SW->>Server: session.hello
    alt 10 秒内未 hello
        Server-->>SW: ABM_HELLO_TIMEOUT + close 1013
    else 鉴权失败
        Server-->>SW: ABM_INVALID_API_KEY / ABM_API_KEY_REVOKED + close 1008
        SW->>SW: authRejected=true，停止重连
    else 成功
        Server-->>SW: session.ready
        loop 每 30 秒
            Server->>SW: session.ping
            SW->>Server: session.pong
        end
    end
    Server--xSW: close（网络/服务重启）
    SW->>SW: 计算退避 5s → 30s（±10% 抖动）
    SW->>A: armRecovery（0.5 分钟周期）
    A->>SW: reconnectIfNeeded
    SW->>Server: 重新连接
```

失败点：

- `session.ready` 15 秒超时 → 关闭并重试。
- 关闭码 1000/1008 → 不再自动重连。
- 连接卡在 connecting 超过 45 秒 → alarms 允许重新发起。
- Key 被拒绝后，用户更换 Key 才会清除拒绝状态。

## 4. 工具调用

```mermaid
sequenceDiagram
    autonumber
    participant Server as ABM Server
    participant SW as Service Worker
    participant R as Tool Registry
    participant T as Tool
    participant Tab as Tab / CDP
    Server->>SW: tool.invoke { id, name, arguments }
    SW->>R: executeTool
    R->>R: registry.get(name)
    alt 未注册
        R-->>SW: error result
    else 已注册
        R->>T: execute(arguments)
        T->>Tab: scripting / tabs / debugger / storage
        Tab-->>T: 页面/网络/文件结果
        T-->>R: { content, isError }
        R-->>SW: result
    end
    SW->>Server: tool.result { id, status, content/error }
```

规则：

- 结果中的文本必须是字符串；非字符串会被 JSON 序列化。
- 工具异常统一包装为 `ABM_TOOL_EXECUTION_FAILED`。
- 相同 `tool.invoke` 的 `id` 原样回传，服务端据此完成 pending Future。

## 5. 导航与标签复用

```mermaid
flowchart TD
    A[browser_navigate] --> B[校验 url / reuse / reuseKey]
    B --> C[resolveReusePlan]
    C --> D{reuse=false?}
    D -->|是| E[新建标签]
    D -->|否| F{reuseKey?}
    F -->|是| G[查 key → tabId]
    G --> H{标签存在且在 abm:browser?}
    H -->|是| I[复用]
    H -->|否| E
    F -->|否| J[按 site/origin 查询候选]
    J --> K[只保留 abm:browser 分组]
    K --> L{有候选?}
    L -->|是| I
    L -->|否| E
    I --> M[先挂 onCommitted 再 tabs.update]
    E --> N[tabs.create]
    M --> O[归组 + 记录 reuseKey]
    N --> O
    O --> P[等待 commit/load/networkidle]
    P --> Q[返回 tabId/reused/reuseMode]
```

要点：

- 复用范围由目标 URL 推导，不维护站点枚举。
- `reuseKey` 标签关闭后按站点规则兜底重建。
- 自动分组失败不影响导航本身。
- 只复用 `abm:browser` 分组，不接管私人标签。

## 6. MAIN world 注入

```mermaid
sequenceDiagram
    autonumber
    participant SW as Service Worker
    participant I as inject-bridge ISOLATED
    participant M as main-world-executor MAIN
    participant P as Page
    SW->>I: executeScript inject-bridge
    SW->>M: executeScript main-world-executor
    SW->>I: tabs.sendMessage EXECUTE_SCRIPT {code,args}
    I->>P: dispatchEvent abm:execute
    M->>M: new Function(code)(args)
    alt 成功
        M-->>I: abm:response {success,result}
    else 页面异常
        M-->>I: abm:response {success:false,error}
    end
    I-->>SW: response
    SW->>I: cleanup（下次注入前）
```

失败点：

- 页面没有监听器 → `chrome.runtime.lastError`。
- 页面 CSP 禁止 eval → `browser_inject_script` 走 CDP 兜底。
- 注入桥重复注入 → 首次注入前先 cleanup，避免监听器叠加。

## 7. 文件上传

### 7.1 Base64

```mermaid
sequenceDiagram
    autonumber
    participant Tool as upload tool
    participant Tab as Page
    Tool->>Tool: base64 → Uint8Array
    Tool->>Tab: 等待 file input
    Tool->>Tab: 构造 File + DataTransfer
    Tab->>Tab: input.files = dt.files
    Tab-->>Tool: success
```

### 7.2 URL 文件

```mermaid
sequenceDiagram
    autonumber
    participant Tool as set_files_from_urls
    participant Perm as Permissions
    participant Net as fetch
    participant Tab as Page
    Tool->>Perm: hasHostPermission(url)
    alt 无权限
        Perm-->>Tool: false
        Tool-->>Tool: {needPermission:true,host}
    else 有权限
        Tool->>Net: GET url
        Net-->>Tool: bytes
        Tool->>Tab: File + DataTransfer 注入
    end
```

### 7.3 本机路径

```mermaid
sequenceDiagram
    autonumber
    participant Tool as set_files_native
    participant CDP as chrome.debugger
    participant Tab as Page
    Tool->>CDP: ensureDebugger(tabId)
    Tool->>Tab: DOM.querySelector(selector)
    Tool->>CDP: DOM.setFileInputFiles(paths)
    CDP-->>Tool: success
```

## 8. 网络抓包

```mermaid
sequenceDiagram
    autonumber
    participant Tool as network_intercept
    participant CDP as chrome.debugger
    participant Net as Network events
    participant Mem as 内存 Map
    Tool->>CDP: attach + Network.enable
    Tool->>CDP: Network.setCacheDisabled(true)
    loop 页面请求
        CDP-->>Net: requestWillBeSent
        Net->>Mem: 记录请求
        CDP-->>Net: responseReceived
        Net->>Mem: 记录状态/mime
    end
    Tool->>Mem: list / detail
    Tool->>CDP: stop + detach
```

失败点：

- 页面关闭 / 调试器被外部断开 → 清理该 tab。
- 抓包数据只在 service worker 生命周期内有效。
- detail 响应体 >50KB 时 gzip + base64。

## 9. 视频桥

```mermaid
sequenceDiagram
    autonumber
    participant Bridge as 视频桥页面
    participant SW as Service Worker
    participant S as video/store
    participant Tab as Page
    Bridge->>SW: abm.bridge.config
    SW-->>Bridge: extensionId + serverBaseUrl + apiKey
    Bridge->>Bridge: 校验服务端配置
    Bridge->>SW: abm.video.begin {sessionId,totalChunks}
    loop 每个分片
        Bridge->>SW: abm.video.chunk {index,base64}
        SW->>SW: 追加分片，累计大小
    end
    Bridge->>SW: abm.video.finish
    SW->>S: 合并后 storeVideo
    SW-->>Bridge: {fileSize}
    Bridge->>SW: abm.bridge.check
    SW-->>Bridge: storedVideo 元数据
    Bridge->>Tab: 由服务端/工具调用注入页面
```

失败点：

- 来源不受信任 → 拒绝。
- 分片不完整 → finish 失败。
- 会话 30 分钟未完成 → 清理。
- 暂存区被 SW 回收 → 需要重新投递。

## 10. URL 视频下载

```mermaid
sequenceDiagram
    autonumber
    participant Tool as download_video_from_url
    participant Perm as Permissions
    participant Net as fetch
    participant S as video/store
    Tool->>Tool: 校验 http/https
    Tool->>Perm: hasHostPermission
    alt 无权限
        Tool-->>Tool: needPermission
    else 有权限
        Tool->>Net: GET video
        Net-->>Tool: stream/bytes
        Tool->>Tool: Content-Type/扩展名/大小校验
        Tool->>S: storeVideo
        Tool-->>Client: {fileName,fileType,fileSize}
    end
```

URL 源由扩展直接下载原始地址，服务端只传 URL，不接触视频字节。base64 源才由服务端临时托管；本机大文件优先使用 `browser_set_files_native`，只传绝对路径。

## 11. 通知

```mermaid
sequenceDiagram
    autonumber
    participant Server as ABM Server
    participant SW as Service Worker
    participant S as chrome.storage.local
    participant Popup as Popup
    Server->>SW: notice.push {id,title,level,body,actionUrl}
    SW->>S: 写入 abm.notice:<id>
    SW->>SW: trim 到 20 条
    SW->>SW: refreshBadge（有未读显示红点）
    Popup->>S: 读取通知
    Popup->>SW: markRead/remove（直接操作 storage）
    SW->>SW: refreshBadge
```

## 12. Key/账号失效传播

```mermaid
sequenceDiagram
    autonumber
    participant Server as ABM Server
    participant SW as Service Worker
    participant S as chrome.storage
    Server->>SW: error ABM_API_KEY_REVOKED / ABM_ACCOUNT_DISABLED
    SW->>S: 写 abm.rejectedApiKey
    SW->>SW: authRejected=true，shouldReconnect=false
    SW->>SW: 关闭 socket，停止 alarms
    SW-->>Popup: 状态 authRejected
    Note over SW: 用户更换 Key 后清除拒绝状态并允许重连
```

## 13. Service Worker 回收与恢复

```mermaid
flowchart TD
    A[SW 被回收] --> B[Chrome 唤醒 SW]
    B --> C[background.js → startLifecycle]
    C --> D[重新注册工具和监听器]
    D --> E[读取 abm.connection]
    E --> F{rejectedApiKey == 当前 Key?}
    F -->|是| G[保持断开，展示需要处理]
    F -->|否| H{shouldReconnect 或 autoReconnect?}
    H -->|是| I[connect 上次 baseUrl]
    H -->|否| J[保持断开]
    I --> K[恢复连接和通知角标]
```

会丢失的状态：

- 视频暂存区。
- 网络抓包数据。
- 注入桥/CDP 附件（通过监听器和按需 attach 重建）。
- 视频桥上传会话。

会恢复的状态：

- 连接配置、拒绝 Key、自动分组、reuseKey、通知、host 权限。
- 连接意图（`storage.session` + alarms）。

## 14. 数据所有权

| 数据 | 位置 | 生命周期 |
|---|---|---|
| API Key | `abm.connection` | 用户删除/更换 |
| 连接状态 | 内存 + 广播 | 进程/连接期间 |
| 视频字节 | SW 内存 | 30 分钟 / 交付后 |
| 视频桥会话 | SW 内存 | 30 分钟 |
| 网络抓包 | SW 内存 | SW 生命周期 |
| 通知 | `chrome.storage.local` | 最近 20 条 |
| 自动分组 / reuseKey | `chrome.storage.local` | 持久 |
| host 权限 | Chrome permissions + storage | 用户撤销前 |
| 注入桥/CDP | 页面/调试器 | 标签/会话期间 |

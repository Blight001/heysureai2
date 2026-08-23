# 远程控制统一工作台与灵活表面设计

## 1. 目标与边界

HeySure 的远程控制应当是一个统一工作台，而不是一个只播放视频的窗口。工作台按设备实际声明的能力组合以下表面：

- **视频画面**：现有 WebRTC 视频轨，适用于桌面、Android 和所有无法结构化镜像的页面。
- **交互终端**：现有 `rt:*` PTY 字节流，适用于命令行、ANSI 和 TUI。
- **网页原生镜像**：Remote Web Mirror v1（下称 RWM），把普通 HTML/CSS/文字作为不可执行的结构化镜像显示，并把交互意图送回设备的真实页面执行。
- **预设控制器**：遥控器、方向键、媒体键、游戏手柄式面板等声明式组件；它们只生成协议允许的输入动作。

RWM 的目标是让普通网页中的文字、边框和常规控件保持矢量清晰，并提供比视频坐标点击更稳定的元素级交互。它**不承诺任意网页 100% 无损**。Canvas、WebGL、视频、DRM、PDF、受限浏览器页面、closed Shadow DOM 或不可读取的跨域内容，必须使用像素岛或回退到视频画面。

## 2. 当前真实完成度

| 能力 | 当前状态 |
| --- | --- |
| `remote_control` 视频轨、`control` DataChannel、`rc:*` 信令 | 已有实现 |
| `remote_terminal` 的 `rt:*` PTY relay | Server 已加固；Web 已恢复 xterm 工作台，端侧仍以各平台实际版本为准 |
| 浏览器标签、地址栏和 `browser-state` | Web 已能消费现有设备消息 |
| 画面/终端标签与方向、媒体、演示、浏览器预设控制器 | Web Phase 1 已实现 |
| `remote_web_mirror` / `remote.web_mirror` 作为非 MCP 能力 | P0 Server 已保留 |
| `rc:start.requestedSurfaces` / `protocolVersions` 有界转发 | P0 Server 已实现 |
| RWM 快照、Patch、资源、原生镜像 UI、端侧采集 | 尚未实现 |
| HTML/资源经 Server relay | 明确不实施 |

因此当前可交付的是视频、终端和预设控制器；RWM P0 只建立合同、能力边界和安全的协商入口，不应在产品中宣称网页原生镜像已经可用。

## 3. 统一会话与数据面

统一工作台沿用 `rc:start` 的 JWT、设备属主、在线状态和 `remote_control` 能力校验。设备若额外声明 `remote_web_mirror` 或 `remote.web_mirror`，控制台才可请求 DOM 表面。RWM 不创建第二套登录态，也不携带网页 Cookie、Token 或存储内容。

数据面如下：

```text
Socket.IO rc:*             仅建立会话、SDP/ICE、ready、stop
WebRTC video track         设备 -> 控制台；通用画面与自动回退
WebRTC control             双向；既有输入、浏览器命令、RWM action/协商
WebRTC web-state           设备 -> 控制台；可靠有序的 snapshot/patch/ack/resync
WebRTC web-resource        设备 -> 控制台；可靠的资源和大快照二进制分块
Socket.IO rt:*             控制台 <-> Server <-> 设备；PTY 原始字节 base64
```

`web-state` 和 `web-resource` 是 RWM v1 的两个新增 DataChannel。现有 `control` 通道继续承担低延迟输入，避免大快照阻塞交互。RWM 内容通过 WebRTC DTLS 传输，Connector 不转发、不解析、不持久化 HTML、DOM Patch 或资源。

## 4. `rc:start` 协商

控制端可选请求：

```json
{
  "deviceId": "browser-1",
  "token": "<user-jwt>",
  "qualityPreset": "balanced",
  "requestedSurfaces": ["dom", "video"],
  "protocolVersions": [1]
}
```

Server P0 只允许表面 `dom`、`video`，只允许协议版本 `1`，去重后转发；不是数组、类型错误、未知值或超过扫描上限的尾部内容均不转发。字段缺失或清洗后为空时省略它们，设备收到的消息与旧版 `rc:start` 等价，从而保持旧端兼容。

RWM 能力不能替代 `remote_control`。会话仍需通过原有画面远程闸门，`remote_web_mirror` 只表示该会话可升级到网页原生表面。

WebRTC 建立后，控制端可在 `control` 通道发送：

```json
{
  "kind": "rc-hello",
  "versions": [1],
  "surfaces": ["dom", "video"],
  "encodings": ["cbor", "json"],
  "compressions": ["br", "gzip", "none"],
  "maxChunkBytes": 16384,
  "permissions": ["view", "interact"]
}
```

设备返回 `rc-hello-ack`，选择单一版本、编码和压缩算法，并公布 `features`、`limits`、viewport、`pageId`、`epoch`。在限定时间内无响应、版本无交集或 DataChannel 不存在时，控制台继续使用视频，不把旧端判定为故障。

## 5. RWM v1 消息合同

控制消息共用 envelope：

```json
{
  "v": 1,
  "type": "patch",
  "sessionId": "rc_xxx",
  "pageId": "page_xxx",
  "epoch": 3,
  "seq": 42,
  "ts": 1787558400000,
  "body": {}
}
```

- `sessionId` 必须等于当前 WebRTC 会话。
- `pageId` 标识标签页中的当前 document。
- 顶层导航、document 替换或采集器重建时 `epoch` 递增。
- `seq` 在一个 epoch 内严格递增。
- 接收端必须验证版本、消息类型、字段类型、大小、session、epoch 和序列。

### 5.1 全量快照

大消息使用 `snapshot.begin`、二进制分块、`snapshot.end`：

```json
{
  "snapshotId": "snap_xxx",
  "baseSeq": 0,
  "encoding": "cbor",
  "compression": "br",
  "uncompressedBytes": 123456,
  "chunks": 18,
  "sha256": "...",
  "viewport": {"width": 1440, "height": 900, "dpr": 2},
  "reason": "initial"
}
```

分块建议不超过 16 KiB，并包含 transfer id、index、total 和原始 bytes。完整 payload：

```text
snapshot = {
  rootId, nodes[], styles[], resources[], scroll, selection, focusId,
  pixelIslands[]
}
node = {
  id, parent, index, kind, tag, ns, text, attrs, styleId, box, flags, state
}
```

节点 ID 由设备端分配，仅在当前 epoch 内稳定。样式是去重、版本化的 computed-style 属性表；表单当前状态单独传输。密码字段不传 value，只标记 `sensitive=true`。Open Shadow DOM、伪元素和 iframe 只有在安全可读时结构化；其他内容标记为降级区域。

### 5.2 增量 Patch

设备合并 MutationObserver、ResizeObserver、scroll、input、focus 和 selection 变化，发送：

```json
{
  "baseSeq": 41,
  "seq": 42,
  "ops": [
    {"op": "text.set", "id": 17, "text": "已完成"},
    {"op": "state.set", "id": 23, "checked": true}
  ]
}
```

v1 固定操作枚举：`node.add/remove/move`、`attr.set/remove`、`text.set`、`style.set`、`state.set`、`box.set`、`scroll.set`、`focus.set`、`selection.set`、`resource.bind`、`pixel.update`。

只有 `baseSeq == lastSeq` 时才能应用。序列断档、未知节点、hash 错误、超限 Patch 或 epoch 不符时发送 `resync.request`；设备重新发送全量快照。控制端定期发送 `ack`。导航先发送 `page.reset`，旧 epoch 的消息和 action 全部作废。

### 5.3 Action

镜像页面本身不执行源页面 JavaScript。所有交互只生成意图：

```json
{
  "kind": "web-action",
  "requestId": "act_xxx",
  "pageId": "page_xxx",
  "epoch": 3,
  "target": {"nodeId": 23},
  "action": "click",
  "args": {},
  "clientSeq": 42
}
```

动作枚举为 `click`、`doubleClick`、`contextMenu`、`type`、`key`、`scroll`、`select`、`focus`。设备必须重新确认节点仍连接、可见、未遮挡且属于当前 epoch，再在真实页面执行，并返回：

```json
{
  "kind": "web-action-result",
  "requestId": "act_xxx",
  "status": "ok",
  "appliedSeq": 43
}
```

状态为 `ok|stale|denied|failed`。`stale` 必须触发重同步，不能退化为盲目点击旧坐标。直接导航只允许 `http`、`https`，并由设备策略再次检查。剪贴板、文件上传/下载和任意 JavaScript 执行不属于 v1。

## 6. 资源与渲染隔离

控制端不得自行访问网页域名获取资源。设备从已加载页面或浏览器缓存读取允许的资源，按 SHA-256 内容寻址，经 `web-resource` 分块发送。初始建议上限：快照 8 MiB、5 万节点、单资源 4 MiB、会话资源缓存 64 MiB；双方可向下协商。

只允许经过魔数和 MIME 校验的位图、WOFF/WOFF2 等必要资源。SVG 应先安全栅格化；HTML、JavaScript 和原始可执行 CSS 不作为资源发送。接收端校验 hash、压缩后/解压后大小和图像尺寸，并使用内存 LRU；会话结束即清除。

控制台必须使用受限 iframe 和受信任的固定骨架，通过 DOM API、tag/attribute/style allowlist 构树；不得使用设备提供的 `innerHTML`、`v-html` 或执行脚本。建议：

```text
sandbox="allow-same-origin"
default-src 'none'; img-src blob: data:; media-src blob:; font-src blob:;
style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none';
object-src 'none'; base-uri 'none'; form-action 'none'
```

剥离 `script`、`base`、meta refresh、`iframe/object/embed`、`on*`、`srcdoc`、`javascript:`、`data:text/html` 和 SVG `foreignObject`。跨域 iframe 应扁平化为独立安全快照或像素区域，绝不在控制台加载原始 URL。镜像 iframe 中没有 HeySure 登录凭据或设备网页 Cookie。

## 7. 视频回退与可观测状态

工作台提供“自动 / 网页原生 / 视频流”三档。以下情况自动发出 `surface.status` 并切回视频：

- 协商、DataChannel 或端侧采集器不可用；
- 浏览器受限页、PDF、DRM 或权限不足；
- 快照、节点、资源超过限制；
- 连续重同步失败或 Patch 积压超过阈值；
- Canvas、WebGL、视频或关键布局无法可信镜像。

失败不能关闭已有 `control` 通道；操作员应能立即继续用视频控制。后续版本可对 Canvas 等区域发送无损 PNG 像素岛，动态视频仍使用 WebRTC 视频轨。

## 8. 声明式控制器 Schema

遥控器等预设 UI 不允许携带脚本或任意 Socket 事件。建议 schema：

```json
{
  "schemaVersion": 1,
  "id": "media-remote",
  "name": "媒体遥控器",
  "deviceKinds": ["desktop", "android", "browser"],
  "layout": {"columns": 3, "gap": "sm"},
  "controls": [
    {
      "id": "play-pause",
      "kind": "button",
      "label": "播放/暂停",
      "icon": "play-pause",
      "action": {"type": "key", "key": "MediaPlayPause", "action": "tap"}
    },
    {
      "id": "dpad",
      "kind": "dpad",
      "actions": {
        "up": {"type": "key", "key": "ArrowUp", "action": "tap"},
        "confirm": {"type": "key", "key": "Enter", "action": "tap"}
      }
    }
  ]
}
```

`kind` 初始只允许 `button|dpad|keypad|slider|joystick|textInput`；action 必须映射到既有 `RcInput` 或 RWM action 白名单。限制控件数量、文本长度、键名、重复频率和坐标范围；不允许 shell、URL、HTML、CSS、模板表达式或 JavaScript。服务器只存储/返回通过 schema 校验的配置，执行仍在当前控制会话内完成。

## 9. 安全与隐私

- 沿用用户 JWT、设备属主、在线状态和 capability 闸门；默认同一设备只有一个可写控制租约。
- `view` 与 `interact` 分 scope；设备端可要求每次显式同意并持续显示“正在远控”。
- DTLS/TURN 只传密文；Server 日志仅记录用户、设备、session、模式、开始结束、字节计数和错误码。
- 不记录 DOM、输入文本、完整 URL path/query、资源内容、Cookie、Token、密码或网页存储。
- 密码、支付、密钥等敏感字段按策略遮罩；动作限流，`requestId` 幂等，重复或伪造 session/epoch 拒绝。
- 未压缩/解压大小、节点数、资源数、Patch 数、队列和 `bufferedAmount` 都必须有硬上限；连续违规终止 DOM 表面但保留安全的视频回退。

## 10. 分阶段落地

1. **P0 合同与 Server 闸门**：非 MCP 能力保留、`rc:start` 有界协商字段转发、断线清理回归测试、本文和设备开发文档。
2. **P1 可用闭环**：Chromium 设备端全量 snapshot；控制台安全 DOM 构树；click/type/key/scroll/navigation；手动刷新；DOM/视频切换。
3. **P2 实时同步**：Mutation/Resize Patch、资源和字体、表单/focus/selection、ack/resync、背压。
4. **P3 混合渲染**：Open Shadow DOM、跨 frame、像素岛和性能自适应。
5. **P4 治理和组件**：view-only、设备审批、审计指标、声明式遥控器编辑器和预设库。

## 11. 验收标准

- 旧控制端和旧设备不发送新字段时，视频远控行为不变。
- `remote_web_mirror` 两种名称不会出现在 MCP 工具、Prompt 或权限表面。
- Server 仅转发清洗后的协商元数据，从不 relay HTML、DOM Patch 或资源。
- JSON Schema/CBOR golden vectors 可跨 Web 与端侧解析；丢包、乱序、重复、截断和 hash 错误必然重同步。
- XSS 样本覆盖脚本、事件属性、SVG、meta refresh、表单、顶层导航和 CSS URL，控制端 mock exfil 服务收到零请求。
- 属主越权、伪造 session/epoch、重复 requestId 和 view-only 写操作全部拒绝。
- SPA、表单、中文 IME、Open Shadow DOM、同源/跨域 iframe、字体、Canvas、视频和强 CSP 页面均有端到端用例。
- 普通网页镜像文字可选择，元素 action 改变的是设备真实页面；受限页面在 2 秒内回退视频。
- 5 万节点、持续 mutation 和弱网条件下有背压且不阻塞输入；目标为输入 P95 小于 150 ms、普通 Patch P95 小于 250 ms。

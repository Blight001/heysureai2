# 远程控制统一工作台与灵活表面设计

## 1. 目标与边界

HeySure 的远程控制是一个按设备实际 capability 组合表面的统一工作台：

- **视频画面**：既有 WebRTC 视频轨，适用于桌面、Android、托管浏览器，以及所有不能结构化镜像的页面。
- **交互终端**：既有 `rt:*` PTY 字节流，适用于 shell、ANSI 和 TUI。
- **网页原生镜像**：Remote Web Mirror v1（RWM），把普通 DOM、允许的 computed style 和位图资源作为不可执行的结构化镜像显示，并把元素交互意图送回设备真实页面执行。
- **预设控制器**：`remote_controller_template.v1` 声明式模板，包含方向键、媒体键、浏览器键、滑杆、摇杆和文本输入等可信 UI 组件。

RWM 让普通网页文字保持矢量清晰、可选择，并让元素级动作比视频坐标点击稳定；它不承诺任意网页 100% 像素无损。当前没有像素岛，iframe、closed Shadow DOM、Canvas、WebGL、视频、video poster、CSS background、字体、PDF、DRM 和不在 allowlist 的样式，其准确显示依赖切回视频流。

## 2. 当前真实完成度

下表描述当前仓库代码的事实。Server/Web 需要完成对应发布，Browser 用户也需要安装包含本实现的新扩展版本，才能在实际环境获得整条链路。

| 能力 | 当前状态 |
| --- | --- |
| `remote_control` 视频轨、`control` DataChannel、`rc:*` 信令 | 已实现并保持旧端兼容 |
| `remote_terminal` 的 `rt:*` PTY relay 和 Web xterm 工作台 | Server/Web 已实现；端侧按各平台 capability 开放 |
| Browser 标签、地址栏和 `browser-state` | Browser/Web 已实现 |
| `remote_web_mirror` / `remote.web_mirror` 非 MCP 能力保留 | Server 已实现；不会进入工具目录、Prompt 或 MCP 权限面 |
| `rc:start.requestedSurfaces` / `protocolVersions` 有界协商 | Server 已实现，只转发 `dom|video` 和版本 1 |
| Browser RWM 采集端 | 源实现位于 `device/browser/browser_MCP`；标准扩展及共享该源码构建的 `browser_MCP_win` 均可获得 top-frame DOM snapshot、首快照 ACK 后放行 Patch、style definition、位图资源、严格 action、resync 和安全降级 |
| Web RWM UI | 已实现安全 iframe/DOM API renderer、snapshot/Patch/resource 接收、action、自动/网页原生/视频切换与超时回退 |
| 遥控器模板治理 | Server 已实现严格 schema、四个内置模板、按用户 CRUD、revision 乐观锁和 Alembic；Web 已实现离线内置、模板管理器和可信组件 |
| 遥控器快速数据面 | Web 与 `browser_MCP` 已实现 `controller-fast`、60 Hz 合并、背压、可靠 start/end 和 500 ms dead-man |
| HTML、DOM Patch、资源、模板实时输入经 Server relay | 明确不实施；它们只走 P2P DataChannel，模板文档仅低频走 REST |

平台边界必须和“实现完成”一起说明：只有 Browser 家族声明并实际实现 `remote_web_mirror` 与 `remote_controller_templates` 原生 emit；代码真源是 `browser_MCP`，`browser_MCP_win` 的 build 也直接使用这套源码。Windows 桌面端、Android、Linux、AI-FREE 等其它端没有本轮 RWM/RCT 原生接收器，继续使用各自已有的视频/终端和 Web 翻译出的 legacy key/browser 预设，不得仅按 `deviceType` 推定新能力。两种 Browser 扩展都必须重新构建/安装新版本，不能用共享源码关系推断旧安装包已经升级。

## 3. 统一会话与数据面

所有表面沿用 `rc:start` 的 JWT、设备属主、在线状态和 `remote_control` capability 闸门。同一设备同一时刻只允许一个远控 operator；第二个 `rc:start` 原子返回 `busy`，端侧收到新会话时也会先清理任何遗留 peer。RWM 额外要求 `remote_web_mirror` 或 `remote.web_mirror`；原生模板 emit 额外要求 `remote_controller_templates`。它们不创建第二套登录态，也不携带网页 Cookie、Token 或存储内容。

```text
Socket.IO rc:*             仅会话鉴权、SDP/ICE、ready、stop
WebRTC video track         设备 -> 控制台；通用画面与回退面
WebRTC control             双向可靠；既有输入、browser、RWM hello/action、RCT trigger/start/end/降级 update
WebRTC web-state           双向可靠有序；设备 snapshot/Patch 状态，控制端 ack/resync
WebRTC web-resource        设备 -> 控制台；大快照和资源二进制分块
WebRTC controller-fast     控制端 -> 设备；无序不重传的连续 RCT update
Socket.IO rt:*             控制端 <-> Server <-> 设备；PTY 原始字节 base64 relay
HTTPS Template API         Web <-> Server；低频模板 CRUD，不承载实时输入
```

命令行会话中 `rt:opened` 只表示 Server 已受理；新设备在 PTY 真正建立后发
`rt:ready`，Web 收到匹配会话的 ready 才开放输入。为不发 ready 的旧端保留的兼容
窗口固定为 `rt:opened` 后 500 ms，会话结束时必须取消该计时器。

新增 DataChannel 都位于既有 WebRTC DTLS 会话内。Connector 不转发、不解析、不持久化 HTML、DOM Patch、资源或 `controller-action`。

## 4. `rc:start` 与 RWM 协商

控制端在 RWM capability 存在时请求：

```json
{
  "deviceId": "browser-1",
  "token": "<user-jwt>",
  "qualityPreset": "balanced",
  "requestedSurfaces": ["dom", "video"],
  "protocolVersions": [1]
}
```

Server 对两个协商数组各最多扫描 8 项，去重后只保留 `dom|video` 和整数版本 `1`。设备未声明 RWM 时会剥离 `dom`；字段缺失、类型错误或清洗后为空时省略，旧设备收到的 `rc:start` 与既有视频会话等价。Server 不因 RWM capability 绕过基础 `remote_control` 闸门。

WebRTC `control` 通道建立后，Web 发送当前实现的 hello：

```json
{
  "kind": "rc-hello",
  "versions": [1],
  "surfaces": ["dom", "video"],
  "encodings": ["json"],
  "compressions": ["gzip", "none"],
  "maxChunkBytes": 16384,
  "permissions": ["view", "interact"]
}
```

`browser_MCP` v1 当前选择 JSON + `none`，不生成 gzip 快照；Web 已能接收 `gzip|none`，不能据此宣称 Browser 已启用压缩。典型成功应答：

```json
{
  "kind": "rc-hello-ack",
  "version": 1,
  "surfaces": ["dom", "video"],
  "encoding": "json",
  "compression": "none",
  "features": {
    "snapshot": true,
    "patch": true,
    "resource": true,
    "semanticAction": true,
    "controllerFast": {"version": 1, "encodings": ["json"]}
  },
  "limits": {"maxChunkBytes": 16384}
}
```

`controllerFast` 只在该通道已经 open 时出现。Browser 最长等待 3 秒让 RWM DataChannel 打开，Web 使用 5 秒 hello watchdog，避免慢开通被提前卸载；协议不兼容或 `web-state` / `web-resource` 未能打开时，Browser 返回 `surface.status` unavailable，旧端不会被判成整个远控故障。

## 5. RWM v1 传输合同

### 5.1 状态 envelope

`web-state` 消息统一为：

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
- `pageId` 标识当前标签页 document；导航、切换标签或采集器重建会生成新 page ID 并递增 epoch。
- `page.reset` 建立新 epoch，seq 从 0 上下文开始；旧 epoch 的 state 和 action 全部失效。
- Web 严格验证版本、类型、身份、epoch、seq、body 和大小；单条 state 上限 256 KiB。

### 5.2 全量快照与二进制分块

Browser 先在 `web-state` 发送 `snapshot.begin`，当前 body 为：

```json
{
  "transferId": "snap_xxx",
  "kind": "snapshot",
  "baseSeq": 1,
  "encoding": "json",
  "compression": "none",
  "bytes": 123456,
  "chunks": 8,
  "sha256": "<64 hex>",
  "reason": "initial"
}
```

二进制包的固定 framing 是 `4-byte big-endian header length + UTF-8 JSON header + raw bytes`；little-endian 必须拒绝。chunk header 包含 `v/type/sessionId/transferId/index/total`，单块不超过 16 KiB。完整后再发送带同一 transfer ID/hash 的 `snapshot.end`。

快照 payload 当前包含 `rootId`、`nodes[]`、去重 `styles[]`、viewport、scroll、focusId，以及为协议兼容保留但当前 producer 固定为空的 `resources: []`。Browser 会先发布可交互 DOM，随后才以独立 resource transfer 尽力补发图片和 `{nodeId,slot}` bindings，慢图片不能阻塞首屏。节点 ID 由 Browser 分配，在当前 epoch 内稳定；持续存活的 DOM 节点跨全量快照保持 ID，删除后的 ID 不复用，因此旧 action 不会误命中新节点。表单 state 单独传输，密码 input 的 value 永远为空。Browser 采集 top frame 与可读的 open Shadow DOM，并把 shadow 内容安全扁平到宿主节点下。

硬上限为 5 万节点、快照 8 MiB、最多 1024 chunks。Web 重建完整树、校验 SHA-256 和树连通性后提交快照并回 exact ACK。Browser 只有收到该快照 seq 的 ACK 才放行后续 Patch；采集期间持续变化的页面最多立即重试一次，其余刷新延后到 ACK 后，避免无限快照循环。

### 5.3 增量 Patch、ACK 与重同步

Browser 合并 MutationObserver、ResizeObserver、scroll、input/change 和 focus 变化，通常以 32 ms 批次发送。当前 Browser 产生的操作包括：

```text
node.add / node.remove
attr.set / attr.remove
text.set
style.define / style.set
state.set / box.set / scroll.set / focus.set
```

`style.define {styleId,style}` 必须先于引用新 style ID 的 `style.set`。每个 Patch 带 `baseSeq`，envelope `seq` 必须等于上一 seq + 1；Web 只有在 `baseSeq == lastSeq` 时应用并回 ACK。Browser 的待合并 mutation 队列上限为 500（发送时还会前置新 style definitions），Web 对最终 Patch 的防御上限同样为 500 ops；队列溢出或一条 state 超过 256 KiB 时重新发快照或降级。

未知节点、非法 op、hash/transfer 错误、序列断档、epoch 不符、快照前收到 Patch 都会触发 `resync.request`。Web 连续三次重同步失败，或 10 秒没有传输进展，会切回视频。

### 5.4 元素 action

镜像 iframe 不运行源页面脚本；它只把可信 UI 事件转成：

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

v1 动作固定为 `click|doubleClick|contextMenu|type|key|scroll|select|focus`，每种 action 都有独立 args allowlist。Browser 校验未知字段、大小、page/epoch、节点连接状态、可见性、requestId 重放和每秒 120 次限流；除 scroll 外的目标动作还会验证目标中心未被遮挡，scroll 则校验可滚动目标/祖先。动作只在设备真实页面执行，结果经可靠 `control` 返回：

```json
{
  "kind": "web-action-result",
  "requestId": "act_xxx",
  "pageId": "page_xxx",
  "epoch": 3,
  "status": "ok",
  "appliedSeq": 43
}
```

状态只允许 `ok|stale|denied|failed`；Browser 失败原因使用有界 `errorCode`。`stale` 会触发 Web 重同步，不能盲点旧坐标。剪贴板、文件上传/下载和任意 JavaScript 执行不属于 v1。

## 6. 资源与渲染隔离

控制端绝不按源页面 URL 自行取资源。当前 Browser producer 在 DOM snapshot 发布后，每轮最多采集 64 个 `HTMLImageElement.currentSrc || src`（`picture` 通过内部 `img.currentSrc` 间接覆盖）的 PNG/JPEG/GIF/WebP/AVIF，并以独立 resource transfer 补发；不采集 video poster、CSS `background-image` 或其它 `url()`。同源/data/blob 在隔离 content world 有界读取；跨源 public HTTP(S) 由 extension-origin 代理以 `credentials:"omit"` 获取，代理严格绑定当前 top-frame session/page/epoch，拒绝凭据 URL、localhost、字面私网/loopback/link-local 地址和不安全重定向，每请求 2 秒、最多 8 并发。Chrome 消息只回有界 base64，不形成通用 URL 代理。响应再经 MIME、魔数、长度和 SHA-256 校验后内容寻址传输。单资源上限 4 MiB、会话唯一 hash 预算 64 MiB，每轮全量快照后会重发其图片与当轮 bindings，使 Web 在 resync 后不依赖旧绑定。资源可能晚于删除节点的 Patch 到达；这是可选视觉增强，Web 必须忽略 stale binding，不能为此破坏 DOM surface。动态新增图片、`src/srcset` 变化和图片 load 会合并触发限频全量快照，连续 burst 最多每秒运行一次，避免新图片永久空白或忙页自旋。

Web 用 64 MiB 内存 LRU 保存经校验的 blob URL，会话停止立即 revoke。位图解码后还必须满足宽高各不超过 16384、总像素不超过 4000 万。生产 HTTP IP 不提供 WebCrypto secure context 时，Web 和 HTTP 页面内的 Browser collector 都使用带 golden vector 的本地 SHA-256 fallback，不能因此跳过完整性校验；最大载荷可能产生约亚秒级主线程计算开销。Web 接收器的资源 allowlist 还包含 WOFF/WOFF2，但当前 Browser 不采集字体，因此当前有效实现范围仍是位图，不能宣称网页字体已无损同步。

RWM pane 使用 `sandbox="allow-same-origin"` 且没有 `allow-scripts` 的 iframe。`srcdoc` 只包含 Web 自己的固定空骨架和 CSP：

```text
default-src 'none'; img-src blob:; media-src blob:; font-src blob:;
style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none';
object-src 'none'; base-uri 'none'; form-action 'none'
```

Web 通过 DOM API 和 tag/attribute/style allowlist 构树，不使用设备提供的 `innerHTML`、`v-html`、HTML、CSS stylesheet 或脚本。源 `script/style/link/meta/base/iframe/object/embed/template/noscript` 不进入快照；`on*`、`srcdoc`、原始 `src` URL、`javascript:`、CSS `url()` 等不会进入 renderer。Canvas/video 只成为不可执行占位节点，准确内容需视频表面。

## 7. 声明式控制器与快速输入

遥控器模板的严格 schema、DTO、CRUD 和实时合同见 [`remote-controller-template-v1.md`](remote-controller-template-v1.md)。当前闭环包括：

- Server 的 `/api/remote-controller-templates` 列表、schema、创建、读取、更新、删除和恢复接口，以及 revision 冲突处理。
- Web 的四个离线内置模板、管理 UI、六种可信组件和 capability 过滤。
- legacy `key` / `browser` 动作继续走既有 `RcInput` / browser 消息。
- 原生 `emit` 使用必填 `event` 的 `kind:"controller-action"`；标准 `browser_MCP` 与共享源码构建的 `browser_MCP_win` 当前接收并派发固定 `heysure.controller-action`。
- 连续 update 优先走 `controller-fast`（`ordered:false,maxRetransmits:0`）：Web 每动画帧仅保留每控件最新值，最高 60 Hz；`bufferedAmount > 64 KiB` 时丢中间 update，16 KiB 低水位后只恢复最新值。
- start/end 永远走可靠 `control`；控件保持按下时 Web 每 200 ms 生成一次同值 update 心跳，并复用同一合并/背压路径。fast 未协商、未打开或已关闭时，update 才合并降级到 reliable 20 Hz；已激活控件发现 fast 关闭会可靠补发一次 fresh start，且同一控件不重复重启。fast 仅暂时拥塞时保留/覆盖每控件最新值，等低水位恢复，不跨通道重复发送；Browser 对每控件做 seq 单调校验和 500 ms dead-man。迟到的 fast close 只释放最后动作来源仍为 fast 的状态，不影响已被可靠 start 接管的控件；本地合成的 release 不占用控制端序号，避免下一次可靠 start 被误判为重复。

Server 不持有实时输入，也不向 Browser 同步模板注册表。Browser v1 校验固定 envelope/event/value/seq/dead-man，但不核验 event 是否属于某个 Server template revision；完整信任边界和后续 manifest/hash 加固见 RCT 文档第 7 节。

## 8. UI 切换、停止与视频回退

Browser capability 存在时，工作台显示“自动 / 网页原生 / 视频流”：

- `auto` 与 `dom` 会尝试 RWM；没有 capability 时根本不显示 RWM 入口。
- hello 5 秒超时、首快照 10 秒超时、传输 10 秒无进展、协议不兼容、DataChannel 关闭、端侧 `surface.status` degraded/unavailable、连续三次 resync 失败都会自动显示已有视频轨。
- state/resource 超限或背压超过 2 秒时 Browser 关闭 DOM surface 并发 degraded，视频会话与 `control` 通道保持可用。
- 用户切到视频或 RWM pane 卸载时，Web 发送 `{"kind":"web-stop","reason":"unmount"}`；Browser 停 observer/collector 并释放 RWM 状态，不停止整个视频远控会话。
- 用户重新选择 surface 会创建新的 RWM pane 并重新协商，不复用已停止 collector。

iframe、closed Shadow DOM、Canvas/WebGL、视频/poster、CSS background、字体、PDF/DRM、受限浏览器页和关键非 allowlist 样式不在当前结构化覆盖范围。受限页会自动返回 unavailable；普通页面内部的占位/样式差异应由操作者切视频。当前没有“单区域像素岛自动替换”，不得写成全页面 100% 无损。

## 9. 安全与隐私

- 沿用用户 JWT、设备属主、在线状态和 capability 闸门；RWM/RCT 都不能绕过 `remote_control`。
- DTLS/TURN 只传密文；Server 只记录会话元数据，不记录 DOM、资源、输入文本、完整 URL path/query、Cookie、Token、密码或网页存储。
- 设备页面中已有的密码原值永不进入快照或离开设备；操作者新输入的密码只作为加密 P2P 的瞬时 action 到达设备，Web 不持久化、不记录并在 blur/提交时清空本地字段。动作有 requestId 重放保护和限流，伪造 session/page/epoch 被拒绝。
- state、快照、节点、资源、Patch、chunk、队列和 `bufferedAmount` 都有硬上限；违规只终止 DOM surface，不反复重启或破坏健康视频会话。
- RCT 模板只允许声明式 allowlist，实时 emit 只进入固定 CustomEvent；Server 不提供任意事件、脚本或命令转发入口。

## 10. 当前垂直切片与后续扩展

本轮已形成 **Browser `browser_MCP` ↔ Web ↔ Server** 的完整 RWM/RCT v1 垂直切片。已落地范围包含快照、首快照 ACK 闸门、实时 Patch、样式定义、位图资源、严格 action、安全 renderer、resync/回退、模板 CRUD/管理 UI、专用快速通道和 dead-man。

以下是明确未纳入当前完成范围的后续扩展，不得混写成现有能力：

1. Windows 桌面端、Android、AI-FREE 等非 Browser 端的 RWM producer 或原生 RCT emit。
2. iframe 分层、closed Shadow DOM、Canvas/WebGL/video 像素岛、字体传输和更完整 CSS 布局。
3. 模板 manifest/hash/签名下发与 Device 端模板成员关系验证。
4. CBOR、Browser snapshot 压缩、view-only/设备审批和更细审计指标。

## 11. 发布验收

- 旧控制端和旧设备不发送新字段时，视频远控行为不变；无 capability 的设备不出现 RWM/emit UI。
- `remote_web_mirror`、兼容点号别名和 `remote_controller_templates` 不出现在 MCP 工具、Prompt 或权限工具表面。
- Server 只转发清洗后的协商元数据，从不 relay HTML、DOM Patch、资源或模板实时输入。
- big-endian chunk golden vector跨 Browser/Web 一致；little-endian、乱序、重复、截断、hash 错误和序列断档被拒绝或触发 resync。
- XSS 样本覆盖 script/event attr/src/srcdoc/SVG/meta refresh/form/CSS URL，renderer 不发任何源站请求。
- 普通 SPA/表单页面中文字可选择，click/type/key/scroll/select/focus 改变设备真实页面；密码 value 不回传。
- RWM 协商失败在 5 秒内、首快照或传输停滞在对应 10 秒 watchdog 后回视频，已有视频和 control 不被关闭。
- 四个内置模板离线可用；自定义 CRUD、409 revision 冲突、恢复内置、60 Hz 合并、200 ms 静止心跳、64 KiB 背压、fast 不可用时的 20 Hz fallback 和 500 ms dead-man 均有回归验证。
- 验收报告分别说明 Server/Web 发布状态与 Browser 扩展版本；不能用“代码已提交”替代端到端实机验证。

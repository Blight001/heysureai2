# Remote Controller Template v1

## 1. 定位、完成度与平台边界

Remote Controller Template（RCT）把方向键、媒体键、演示器、浏览器控制、滑杆、摇杆和文本输入组合成可复用的远控 UI。模板是声明式数据，不能携带 JavaScript、HTML、CSS、shell、任意 Socket.IO 事件或未校验 URL。

当前仓库已经形成一条可用的 v1 垂直链路：

- Server 提供严格的 `remote_controller_template.v1` 校验、四个内置模板、按用户隔离的 CRUD、revision 乐观锁，以及 Alembic revision `7b4c5d6e8f90`。
- Web 从 Server 加载模板，断网时保留内置模板，提供新建、编辑、删除、恢复内置和 revision 冲突提示；可信组件负责把模板转成既有输入或 `controller-action`。
- `device/browser/browser_MCP` 源码实现原生 `emit`、专用 `controller-fast` 通道、每控件 seq 去重和 500 ms dead-man release，并声明非 MCP 能力 `remote_controller_templates`；标准扩展和直接共享这套源码构建的 `browser_MCP_win` 都获得该实现。
- Windows 桌面端、Android、Linux、AI-FREE 等非 Browser 端当前没有这套原生 `emit` 接收器，不能声明 `remote_controller_templates`。它们仍可使用 Web 把内置 `key` / `browser` 动作翻译成旧远控消息后的兼容预设；各端实际可用的视频、终端和输入范围仍以自身 capability 为准。两种 Browser 扩展都需重新构建/安装，旧包不会因共享源码而自动升级。

模板分发与实时输入严格分离：Server API 只负责低频模板治理；实时动作只在已鉴权的远控 WebRTC 会话内传输，Server 不 relay、不解析也不保存按键、轴值或文本输入。

## 2. 严格模板合同

顶层 schema 名固定为 `remote_controller_template.v1`。下面是 API 返回的 `TemplateDocument`；`revision` 和 `builtin` 是只读服务端字段：

```json
{
  "schema": "remote_controller_template.v1",
  "id": "media-remote",
  "name": "媒体遥控器",
  "revision": 3,
  "builtin": false,
  "deviceTypes": ["desktop", "android", "browser"],
  "requiredCapabilities": ["remote_control", "remote_controller_templates"],
  "layout": {"columns": 3, "gap": "sm"},
  "controls": [
    {
      "id": "play-pause",
      "kind": "button",
      "label": "播放/暂停",
      "tone": "primary",
      "action": {"type": "key", "key": "MediaPlayPause"}
    },
    {
      "id": "left-stick",
      "kind": "joystick",
      "label": "方向",
      "deadZone": 0.1,
      "action": {"type": "emit", "event": "game.axis"}
    }
  ]
}
```

v1 控件只允许 `button|dpad|keypad|slider|joystick|textInput`，并遵守以下约束：

- `button` 可使用 `key|browser|emit`；其它控件必须使用 `emit`。
- `slider` 必须同时提供有限数值 `min`、`max`、`step`，且 `min < max`、`0 < step <= max-min`。
- `joystick.deadZone` 可选，范围为 `[0,0.95]`；输出 `x/y` 均在 `[-1,1]`。
- `textInput.maxLength` 必填，范围为 `1..1024`。
- `tone` 只允许 `default|primary|danger`；布局 `gap` 只允许 `xs|sm|md|lg`，`columns` 为 `1..12`。

动作合同：

- `key` 必须来自 Server/Web 的固定按键 allowlist。
- `browser.action` 只允许 `back|forward|reload`。
- `emit.event` 必须匹配 `^[a-z][a-z0-9_.-]{0,63}$`，并拒绝 `rc.`、`rc-`、`rt.`、`rt-`、`web-action`、`controller-action` 保留前缀。
- `requiredCapabilities` 必须包含 `remote_control` 或兼容别名 `remote.control`；模板含任一 `emit` 时还必须包含 `remote_controller_templates`。

`AllowedKey` 当前精确集合为：`ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Enter|Escape|Home|End|PageUp|PageDown|Tab|Space|Backspace|Delete|F1..F12|MediaPlayPause|MediaTrackPrevious|MediaTrackNext|AudioVolumeDown|AudioVolumeUp|AudioVolumeMute`。

Server 的硬上限为：每用户 32 个活动自定义模板、每模板 `1..64` 个控件、规范化 JSON 不超过 64 KiB、名称 `1..80` 字符、label `1..40` 字符。模板 ID、控件 ID 均匹配 `^[a-z][a-z0-9_.-]{0,63}$`；设备类型和 capability 列表都必须为 `1..3` 项且不得重复。未知字段一律拒绝。

Server 与 Web 内置 `direction`、`media`、`presentation`、`browser` 四个 revision 1 模板。内置 `key` 动作由 Web 翻译为既有 `RcInput`，浏览器动作翻译为既有消息：

```json
{"type":"key","key":"ArrowUp","action":"tap"}
{"kind":"browser","action":"reload"}
```

这两种兼容载荷不是 `TemplateDocument` 的 action 结构，模板中的 key action 只有 `{"type":"key","key":"ArrowUp"}`。

## 3. 精确 API DTO 与行为

API 前缀为 `/api/remote-controller-templates`，所有接口都要求当前用户 JWT，数据按 `user_id` 隔离。

请求/响应 DTO 使用 JSON 公共别名，且全部 `additionalProperties:false`：

```text
ControllerAction =
  { type: "key", key: AllowedKey }
  | { type: "browser", action: "back"|"forward"|"reload" }
  | { type: "emit", event: LogicalEvent }

ControllerControl = {
  id, kind, label, tone?, action,
  min?, max?, step?, deadZone?, maxLength?
}

TemplateContent = {
  schema?: "remote_controller_template.v1",
  name, deviceTypes, requiredCapabilities,
  layout: { columns?, gap? }, controls
}

TemplateCreate = {
  ...TemplateContent, id
}

TemplateUpdate = {
  ...TemplateContent, expectedRevision
}

TemplateDocument = {
  ...TemplateContent, id, revision, builtin
}

RestoreRequest = { expectedRevision }
```

Server 允许 create/update 省略 `schema`（固定默认 v1），允许 layout 省略 `columns` / `gap`（默认 `3` / `sm`）；Web 会发送规范化后的显式值。`tone` 输入默认 `default`，`TemplateDocument.builtin` 响应默认 `false`。除这些有明确定义的默认字段外，上述 required 字段不能省略。

`PUT` 的模板 ID 只取路径参数，body 不接受 `id`；`revision`、`builtin` 也不属于 create/update 请求。返回的 `TemplateDocument` 是 create 字段加 `revision`、`builtin`。列表响应固定为：

```json
{
  "schema": "remote_controller_template.v1",
  "items": [],
  "total": 0,
  "defaultsRevision": 1
}
```

路由与精确并发字段：

| 方法 | 路径 | 请求 / 返回 |
| --- | --- | --- |
| `GET` | `/api/remote-controller-templates/schema` | 返回 `schema` 及 `template/create/update/controllerAction` 四份 Pydantic JSON Schema |
| `GET` | `/api/remote-controller-templates` | 返回内置 + 当前用户有效模板；可选 `deviceType`、`capability` 过滤 |
| `POST` | `/api/remote-controller-templates` | body `TemplateCreate`；201 + `TemplateDocument` |
| `GET` | `/api/remote-controller-templates/{id}` | 返回当前用户可见的有效 `TemplateDocument` |
| `PUT` | `/api/remote-controller-templates/{id}` | body `TemplateUpdate`；更新自定义模板或创建/更新同 ID 的用户内置覆盖 |
| `DELETE` | `/api/remote-controller-templates/{id}?expectedRevision=N` | 仅删除自定义模板；返回 `{"deleted":true,"id":"...","revision":N+1}` |
| `POST` | `/api/remote-controller-templates/{id}/restore` | body `{"expectedRevision":N}`；写回内置内容；已有覆盖时 revision 单调递增，无覆盖时仍为 1 |

create/get/update/restore 返回弱 ETag `W/"rct-{id}-{revision}"`，并使用 `Cache-Control: private, no-store, max-age=0`。更新、删除和恢复执行 revision 乐观锁；冲突返回 409 `TEMPLATE_REVISION_CONFLICT`，超出自定义模板数量返回 409 `TEMPLATE_LIMIT_REACHED`，不存在返回 404 `TEMPLATE_NOT_FOUND`，Pydantic 合同错误返回 422。ETag 是缓存元数据，不能替代 `expectedRevision`。

内置模板不能由 `POST` 同 ID 创建，也不能 `DELETE`；`PUT` 内置 ID 会建立当前用户的覆盖，`restore` 恢复全局内置值。恢复不会把已有覆盖的 revision 重置为 1，避免旧请求在 ABA revision 上误覆盖；对已经恢复的同 revision 再次 restore 保持幂等。Schema 只能由 Alembic 建立，Runtime 启动不得执行 DDL。

## 4. 可靠实时事件

离散 `trigger`、连续控件的 `start` / `end`，以及 fast channel 不可用时的降级 `update`，走可靠有序的 `control` DataChannel：

```json
{
  "kind": "controller-action",
  "v": 1,
  "templateId": "gamepad",
  "controlId": "left-stick",
  "seq": 1042,
  "phase": "start",
  "event": "game.axis",
  "value": {"x": 0.0, "y": 0.0},
  "ts": 1787558400000
}
```

`event` 是所有 `controller-action` 的必填字段。`phase` 只允许 `trigger|start|update|end`；value 只允许 `null`、绝对值不超过 1000000 的有限数字、最多 1024 字符的字符串，或仅含 `x/y` 且二者均在 `[-1,1]` 的对象。NaN、Infinity、额外键、非法 ID/event、未知字段和倒退 seq 都会被 Browser 拒绝。

`device/browser/browser_MCP` 为每个 `(templateId, controlId)` 保存最大控制端 seq，忽略重复或倒序消息。`start/update` 会刷新 500 ms dead-man；期限内没有后续 update/end、会话停止、socket 断开或切换标签页时，端侧都会合成 release `end`。fast channel 关闭只释放最后一次有效动作仍来自 fast 的控件；若 Web 的可靠 fresh `start` 已先接管，迟到的 close 通知不会误释放新状态。该本地 release 复用最后接收的 seq 且标记 `deadMan`，不推进远端序号门，所以下一次控制端 `lastSeq + 1` 仍可正常开始。

原生 `emit` 不把模板 event 当作任意 DOM 事件名。Browser 只派发固定事件：

```js
document.addEventListener('heysure.controller-action', (event) => {
  // event.detail 已 Object.freeze；逻辑名在 event.detail.event
})
```

`key` / `browser` 兼容动作不走这个信封，继续使用旧协议。

## 5. `controller-fast` 快速通道

Browser 为连续输入创建：

```ts
peer.createDataChannel('controller-fast', {
  ordered: false,
  maxRetransmits: 0,
})
```

通道已 open 时，`rc-hello-ack.features` 才声明 `controllerFast: {version: 1, encodings: ["json"]}`。v1 使用与可靠 `controller-action` 相同字段的 JSON，不在未协商时猜测 CBOR 或其它二进制格式。

Web/Browser 当前行为：

- `start` / `end` 始终走可靠 `control`；`controller-fast` 只接收 `phase:"update"`。
- Web 每个动画帧只保留每个 control 的最新 update，最高 60 Hz。
- 连续控件 start 后即使值不再变化，Web 也每 200 ms 生成同值 update 心跳；心跳与普通 update 共用合并、fast 背压和 reliable fallback，end/卸载立即停止。
- fast channel 的 `bufferedAmount > 64 KiB` 时不发送中间值；`bufferedAmountLowThreshold` 为 16 KiB，恢复后只发当前最新值。
- fast channel 未协商、未打开或已关闭时，update 合并后降级到可靠 `control`，最高 20 Hz，
  不建立追赶队列。已激活控件检测到 fast 从 open 变为 closed 时会先可靠发送一次 fresh `start`，
  再继续可靠 update；同一控件不会重复重启。fast 仅暂时拥塞时不跨通道降级；每控件只覆盖保留最新待发值，等低水位恢复。
- 不可靠 update 可以丢失和乱序；可靠 end 和端侧 seq/dead-man 共同保证控件不会永久保持激活。

Server 只参与 `rc:*` 会话鉴权和 SDP/ICE 信令，看不到 DataChannel 内容。

## 6. 与 RWM 和旧输入的边界

- RWM 元素意图固定为 `kind:"web-action"` / `web-action-result`。
- 模板原生 emit 固定为 `kind:"controller-action"`。
- 旧画面键鼠仍使用 `RcInput` JSON。
- 浏览器导航仍使用 `kind:"browser"`。

四种消息按 kind 分发，不能合并成可执行任意 action 的通用入口。含 emit 的模板只向实际声明 `remote_controller_templates` 的设备显示；其它设备仍可显示不含 emit 的兼容模板。

## 7. v1 信任边界与后续加固

Server 不向设备同步模板注册表，Browser v1 因此无法在端侧证明 `(templateId, controlId,event)` 一定来自当前 revision 的模板。当前边界是：

1. Server 严格校验并按用户治理模板；Web 再次解析 allowlist，并只从通过校验的模板生成动作。
2. WebRTC 会话沿用用户 JWT、设备属主和 `remote_control` capability 闸门。
3. Browser 严格校验固定 envelope、ID/event/value、保留前缀、seq 与 dead-man，且只派发固定 `heysure.controller-action`。

文档和端侧不得把第 3 点写成“端侧已核验模板成员关系”。如后续需要抵御已获远控会话写权限的恶意控制端，应增加带 revision/hash 或签名的 template manifest 协商，并让设备在接收动作前验证成员关系；该加固不属于 v1 当前实现。

## 8. 发布验收

- 跨用户读取、未知字段、超限模板、恶意 action、非法 emit 前缀和 revision 冲突必须被拒绝。
- Web 断网时仍显示四个内置模板；恢复联网后按 revision 刷新，409 时保留当前编辑内容供人工合并。
- 旧设备可使用内置 key/browser 预设，不会收到自定义 emit。
- 60 Hz joystick 不阻塞 RWM `web-state` 或可靠按键；拥塞时只保留最新 update。
- update 丢包、乱序、重复时 Browser 只应用递增 seq；end 可靠送达，断线后 500 ms 内 dead-man release。
- 模板治理走 REST，模板实时输入、RWM DOM/资源和视频都不经过 Server relay。

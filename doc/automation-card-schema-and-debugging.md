# 自动化卡片 Schema、录制与调试规范

## 1. 执行来源与同名规则

- `automation.manage` 等服务端注册工具属于“服务器工具箱”。设备即使上报同名工具，也不能覆盖服务端工具。
- 只有完成端侧派发后，由服务端写入的 `设备`、`设备号` 元数据可以证明执行来源。
- 工具业务结果中的 `device_id` 只表示该业务对象关联的设备，前端不得据此把服务器工具显示为设备工具。

## 2. 通用跨设备语义

`automation.manage` 是服务器工具箱 MCP，不需要绑定某一台设备才能管理、创建或运行卡片。卡片没有 `mcp` 节点时完全不需要设备。

卡片版本同时保存：

- `contractDeviceIds`：服务端从所有 MCP 节点自动汇总的完整设备号列表，不需要调用方重复填写；
- `defaultDeviceId`：可选的兼容默认设备；
- `steps.<stepId>.toolRef.deviceId`：该节点发布时冻结契约所使用的设备号。

不同 MCP 节点可以分别调用当前 AI 有权使用的桌面端、Linux、浏览器、Android 或自建设备工具，不限定网站或浏览器步骤类型。

启动时：

- 不传 `device_id`：各 MCP 节点使用自己的 `toolRef.deviceId`；
- 传 `device_id`：必须属于 `contractDeviceIds`；默认设备上的节点改派到指定设备；
- 显式绑定到其他设备的节点保持原绑定，因此一张卡片可以同时操作多个端；
- 创建运行前逐节点检查设备归属、在线状态、工具存在性、provider、Schema 摘要和权限。

前端节点设备下拉项必须同时显示设备名称与完整设备号，不能只显示名称。

## 3. 卡片定义 Schema

```json
{
  "schemaVersion": 1,
  "name": "示例",
  "description": "用途与成功判据",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": { "type": "string" }
    },
    "required": ["path"],
    "additionalProperties": false
  },
  "startStepId": "read",
  "limits": {
    "timeoutSeconds": 600,
    "maxTransitions": 30,
    "maxResultBytes": 10485760
  },
  "steps": {
    "read": {
      "type": "mcp",
      "title": "读取配置",
      "toolRef": {
        "namespace": "device",
        "name": "fs.read",
        "deviceId": "desktop-full-id",
        "provider": "desktop",
        "schemaDigest": "sha256:..."
      },
      "arguments": { "path": "${input.path}" },
      "saveAs": "config",
      "timeoutSeconds": 60,
      "retryPolicy": {
        "maxAttempts": 3,
        "backoff": "exponential",
        "delaySeconds": 1,
        "maxDelaySeconds": 10,
        "retryOn": ["DEVICE_OFFLINE", "DISPATCH_FAILED", "STEP_TIMEOUT"]
      },
      "next": "finish",
      "onError": "fail"
    },
    "finish": {
      "type": "end",
      "output": { "status": "completed" }
    }
  },
  "output": { "status": "completed" }
}
```

支持的步骤类型为 `mcp`、`condition`、`delay`、`ai` 和 `end`。`confirm` 真人确认节点及其弹窗已经删除。编译器会验证入口、跳转目标、不可达节点、循环、模板依赖、输入 Schema、超时、最大推进次数、敏感字面量和可达结束节点。

`ai` 是一等工作流节点，不是 MCP 工具。定义格式为：

```json
{
  "type": "ai",
  "prompt": "检查此前结果并补充发布参数",
  "saveAs": "review",
  "timeoutSeconds": 300,
  "next": "publish",
  "onError": "failed"
}
```

运行到该节点时，卡片进入 `waiting_ai` 并停止继续推进。系统把节点的 `prompt`、运行摘要和此前所有步骤的完整轨迹返回给负责本次运行的 AI。AI 完成节点要求的工作后调用 `automation.manage` 的 `respond` 动作，通过 `parameters` 提交结果；这些参数保存到 `${steps.<saveAs>.result}`，随后从 `next` 继续。AI 拒绝、处理失败或超时则进入 `onError`；未配置 `onError` 时终止运行。

最小可运行示例：

```json
{
  "review": {
    "type": "ai",
    "prompt": "审核草稿；通过时返回 title 和 body",
    "saveAs": "review",
    "next": "publish",
    "onError": "rejected"
  },
  "publish": {
    "type": "mcp",
    "arguments": {
      "title": "${steps.review.result.title}",
      "body": "${steps.review.result.body}"
    },
    "next": "finish"
  },
  "rejected": { "type": "end", "output": { "status": "rejected" } },
  "finish": { "type": "end", "output": { "status": "published" } }
}
```

审核 AI 通过时调用：

```json
{
  "action": "respond",
  "run_id": "wrun_...",
  "approved": true,
  "parameters": { "title": "最终标题", "body": "最终正文" },
  "message": "内容和合规检查通过"
}
```

`approved=true` 把整个 `parameters` 对象保存为 `steps.review.result` 并进入 `next`；`approved=false` 不保存参数，进入 `onError` 指向的步骤。`onError` 缺失或为 `fail` 时，拒绝会终止运行。`parameters` 的字段名必须与下游 `${steps.review.result.<字段>}` 引用一致。

浏览器工作流还必须声明 `compatibility.initialEnvironment` 的三个字段：非空 `description`；指向 `browser+tab` 的 `reload`/`replace` 节点的 `resetStepId`（`replace` 还必须有 URL）；以及指向 `browser+wait`/`browser+observe` 节点的 `readyStepId`。入口链必须先到 reset，再由 reset 到 ready，随后才能进入正常业务动作。编译失败时会一次返回这份完整规则和所有具体不匹配项。

MCP 节点的 `schemaDigest` 在绑定契约设备在线时由服务端按设备实时报送的 input schema 自动回填并校验，调用方不需要手工计算。设备离线或未连接时服务端无法证明当前契约，会直接提示先让绑定设备上线，不会静默保存未经验证的摘要。

## 4. AI 局部修改

AI 修改已有卡片应先 `get` 读取最新版本，再调用：

定义较长时，不必一次拉取整张卡片。以下读取方式可按需组合字段过滤与一种步骤选择模式：

```json
{
  "action": "get",
  "card_id": "wcard_...",
  "fields": {
    "card": ["id", "latest_version_id", "definition"],
    "definition": ["startStepId", "steps", "compatibility", "output"]
  },
  "step_offset": 20,
  "step_limit": 10
}
```

步骤选择还可使用 `step_ids` 精确读取，或用 `tail` 读取末尾 N 步；三种模式互斥。响应的 `selection` 和 `pagination` 会给出总步骤数、实际返回的步骤 ID、缺失 ID、`has_more` 与 `next_offset`。完全不传选择参数时保持原有完整返回合同。

```json
{
  "action": "patch",
  "card_id": "wcard_...",
  "base_version_id": "wver_...",
  "dry_run": true,
  "operations": [
    {
      "op": "replace",
      "path": "/steps/open/arguments/url",
      "value": "https://example.invalid/new-publish"
    }
  ]
}
```

规则：

- 仅支持 `add`、`replace`、`remove`、`test`；
- 只能修改流程定义白名单路径，不能通过补丁改设备契约字段；
- `base_version_id` 必须仍是最新版本，否则拒绝并要求重新读取；
- 补丁应用后必须重新编译完整定义、重新冻结契约并创建不可变新版本；
- `dry_run=true` 只试算，不提交、不创建版本；响应中的 `applied`、`committed`、`version_created` 会明确说明状态；
- AI 不应使用 `edit.definition` 一次覆盖整张已有卡片。

卡片名称、说明、风险级别、标签和访问范围属于元数据，使用 `action=edit` 修改，不放入 definition 补丁。

当修改涉及大量步骤重命名、插入、删除或重新连线时，不要堆叠大量 patch。先以 `get`/`get_version` 取得并审核完整定义，再执行安全整定义替换：

```json
{
  "action": "replace_definition",
  "card_id": "wcard_...",
  "base_version_id": "wver_...",
  "definition": {},
  "dry_run": true
}
```

`dry_run=true` 会执行完整编译和设备契约校验，并返回路径级 diff 以及步骤级摘要（新增/删除/修改步骤、`next` 和 `arguments.*` 等变化），但不会修改卡片或创建版本。摘要不会回显参数值。确认 diff 后，以同一份定义和最新 `base_version_id` 设置 `dry_run=false`，创建不可变新版本。该动作只替换 definition，不修改卡片元数据。

## 5. 实战录制

1. `record_start`：开启当前用户、当前 AI 成员的唯一活动录制，可传 `device_ids` 和 `default_device_id`。
2. 正常调用端侧 MCP；服务端在每次调用完成后记录工具名、完整设备号、脱敏参数、截断后的结果、传输状态、业务结果和错误。
3. `record_status`：检查当前轨迹。
4. `record_stop`：停止并返回结构化调用；传 `create_card=true` 时，仅把传输成功且业务结果成功的调用编译成卡片并执行保存期验证。`success=false`、`ok=false`、明确失败状态或错误码（例如 `BROWSER_TAKEOVER_REQUIRED`）只保留用于诊断，不进入卡片。
5. `record_cancel`：停止并标记取消，不创建卡片。

`automation.manage` 自己不会被录进轨迹。密码、Token、Cookie、Secret 等字段会被替换为 `[REDACTED]`，创建的输入模板必须由调用者重新提供敏感值。

录制生成的步骤 ID 使用工具名和 `action` 生成语义标识；重复步骤自动增加数字后缀。`startStepId`、步骤跳转、`saveAs`、初始化环境引用和最终输出会使用同一命名映射。

浏览器轨迹还会执行保守稳定化：

- 每台设备首个浏览器写操作前自动补 `browser+control acquire`；已有 acquire 不重复，release 后再次写入会重新 acquire；
- 只有最近一次 observe 中的 `ref` 能被语义字段唯一定位时，才移除临时 ref 并生成 `targetResolver`；歧义或缺少证据时保留原 ref，并记录 `UNSTABLE_BROWSER_REF`，避免编造选择器；
- observe 的结果 envelope 深度会保留到 resolver 模板路径中；
- 显式空 observe 若承担初始化 ready 或最终输出会保留并警告；其余没有作用的空 observe 会安全丢弃，并在 `recordingWarnings` 中记录来源序号。

## 6. 断点与逐步调试

- `debug_start`：从 `start_step_id` 创建一个独立调试运行，初始状态为 `paused`；不修改原运行。
- `seed_steps`：从中间节点开始时注入前置步骤结果，结构为 `{ "saveAs": { "result": ... } }`。
- `debug_step`：只推进一个步骤，完成后再次进入 `paused`。
- `debug_continue`：关闭单步断点并继续运行。
- `debug_restart`：基于已有运行的卡片版本、输入和设备，从任意步骤创建新的暂停调试运行。

调试运行仍执行所有生产校验；不能借调试绕过设备归属、权限、Schema、AI 审核或超时。端侧步骤已派发后不能强行暂停，必须等待回执或取消。

## 7. 稳定创建流程

推荐固定采用以下门禁：

1. 在与生产相同类型的目标设备上执行 `record_start` 并完成一次真实操作；
2. 录制时覆盖页面已登录、未登录、加载慢、弹窗、元素位置变化和重复提交等环境；
3. `record_stop(create_card=true)` 生成草稿版本；
4. 用 `patch` 参数化输入、增加状态观察、语义目标解析、等待、重试、错误分支和最终结果校验；
5. 调用 `validate`，确保编译、设备契约和工具 Schema 全部有效；
6. 用测试设备执行 `debug_start`，从入口逐步执行到结束；
7. 分别从关键中间步骤执行 `debug_start + seed_steps`，验证断点恢复；
8. 至少完成一次断线重连、页面刷新、超时重试和重复回执测试；
9. 只有结果验证节点能够证明目标动作完成时，才把运行视为成功。

复杂网页自动化不要依赖固定坐标或一次观察得到的短期元素引用。每次关键点击前应重新观察，使用语义文本、角色、可交互状态和唯一匹配解析目标；发布后应读取结果页面或列表，验证内容确实存在，而不是把“点击发布按钮成功”当作发布成功。

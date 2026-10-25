# Agent Tool Broker、控制台与 Artifact 架构 RFC

状态：实施中（第一阶段 + 异步基础）  
日期：2026-10-25  
范围：`deploy/server`、`deploy/web` 的 AI、MCP、设备和工作区工具链

## 1. 背景与问题

当前系统已经具备 MCP registry、原生 function calling、设备端 MCP、
`workspace.run+command`、`workspace.file+manage` 和 `/api/mcp/call`，但入口仍然
分散：AI 可能走原生 tool call 或兼容性的文本 `<mcp-call>`，控制台使用 JSON 测试
弹窗，远程终端则走另一条 Socket.IO PTY 链路。结果是：

- 用户不能用与 AI 完全相同的权限和执行路径直接调用 MCP；
- 部分控制台调用没有携带 `ai_config_id`，设备 MCP 无法通过当前 AI 的 binding/scope；
- 长时间工具调用同步阻塞一轮对话；
- 图片和视频在工具链与模型输入之间缺少统一的文件引用协议，容易把 Base64 写进上下文；
- 外部 MCP、设备 MCP、服务端工作区能力的目标环境不够显式。

本 RFC 采用增量迁移，不进行一次性重写。

## 2. 目标与非目标

### 目标

1. AI、控制台、自动化卡片使用同一个 Tool Broker 和权限检查链。
2. MCP 调用以结构化 JSON Schema/function call 为主，文本解析仅保留兼容性。
3. 通过 `ai_config_id`、设备 binding 和 MCP scope 统一授权。
4. 用 Artifact/file reference 传递图片、视频、音频和大文件，不把 Base64 写入聊天历史。
5. 长任务可返回 `job_id`，支持状态、取消、超时、重试和断线恢复。
6. 保留现有工具名和路由，确保旧 AI 配置可以继续运行。

### 非目标

- 不把服务器工作区 shell 变成用户设备 shell；
- 不向 AI 默认开放无限制的系统命令、网络或全盘路径；
- 不通过新增数据库表绕过现有 Alembic 和任务状态约束；
- 不在本阶段重写四个 Runtime 的进程边界。

## 3. 目标架构

```text
Chat AI ───────┐
Web Console ───┼──> Tool Broker ──> server MCP registry
Workflow ──────┘          ├──────> connector/device MCP
                          ├──────> workspace/file/media
                          └──────> external MCP
                                      ↓
                                  Artifact Store
                                      ↓
                               model input adapter
```

Tool Broker 不替代现有 `call_mcp_or_endpoint_tool`，而是逐步把它作为唯一的
执行适配器。所有调用都必须带调用者、用户、AI 配置、工具名、参数摘要和目标环境。

## 4. 工具调用契约

### 4.1 发现

`GET /api/mcp/tools?ai_config_id=<id>` 是当前 AI 的权威工具视图。前端不得把
“全局在线工具列表”当作当前 AI 可用列表；新建 AI 时应显示“需要先绑定设备/授权 scope”。

每个工具至少包含：

```json
{
  "name": "workspace.file+manage",
  "description": "...",
  "inputSchema": {"type": "object", "properties": {}},
  "mcpSource": "server",
  "destructive": false,
  "allowedForCurrentAi": true
}
```

### 4.2 同步调用

用户控制台和 AI 都可以调用现有：

```http
POST /api/mcp/call
```

```json
{
  "tool": "workspace.file+manage",
  "arguments": {"action": "view_image", "file_ref": "..."},
  "ai_config_id": 42
}
```

`ai_config_id` 对 endpoint/device MCP 是必需的。路由必须先验证 AI 属于当前用户、
MCP 已启用、工具在当前 scope，再进入执行适配器。

### 4.3 受控控制台

AI 的基础控制台能力优先使用已有 `workspace.run+command`，其约束包括：

- cwd 解析到当前 AI 工作区；
- 支持 `argv + shell=none`，优先于拼接 shell 字符串；
- 命令长度、超时、输出量和危险命令阻断；
- 可选 `sandbox_env` 和 `dry_run`；
- 设备端 `run_command` 必须通过 AI binding、设备 scope 和 connector dispatch。

后续若需要统一 `console.execute`，应采用：

```json
{
  "target": "workspace|device",
  "argv": ["python", "convert.py", "input.png", "--output", "out.webp"],
  "cwd": "workspace://current",
  "timeout_ms": 30000,
  "approval": "auto|required"
}
```

不得让 `console.execute` 绕过 `ensure_tool_eligible` 或直接访问任意绝对路径。

## 5. Artifact/file reference

工具返回文件时使用引用和元数据：

```json
{
  "file_ref": "workspace://files/abc123",
  "mime_type": "image/webp",
  "size": 183420,
  "sha256": "...",
  "expires_at": "..."
}
```

对话历史只保存引用、摘要和 MIME/大小等元数据。模型适配层根据目标模型能力将
引用转换为本地文件、临时 URL 或 `input_image`/`input_file` block。现有
`workspace.file+manage(action=view_image)` 和 `file_ref` 流程优先复用，不新增
“把完整 Base64 写进消息”的路径。

所有 Artifact 都必须有：所有者、工作区、创建工具、大小上限、生命周期、访问检查和
删除/撤销语义。外部设备上传到服务器后才允许被服务端工作区工具使用。

## 6. 异步 Job

超过短同步预算的工具调用应返回任务引用：

```json
{"job_id": "tooljob_123", "status": "queued"}
```

状态机：

```text
queued → running → waiting_input → succeeded
                         ├→ failed
                         ├→ cancelled
                         └→ expired
```

状态必须包含 owner、lease/deadline、工具名、参数摘要和目标设备。前端通过现有
Socket.IO 基础设施或 SSE 订阅 `tool_job_update`，同时提供 `get`、`cancel` 和有限次数
的 `retry`。不能恢复已终态任务，也不能在重连时重复执行非幂等调用。

## 7. 控制台产品形态

控制台不是让用户记忆 XML/JSON 语法，而是：

1. 按 `ai_config_id` 加载当前可用工具；
2. 从 `inputSchema` 生成表单，并提供 JSON 高级编辑；
3. 明确目标环境（服务端工作区、指定桌面、浏览器或外部 MCP）；
4. 显示风险等级、审批要求、实时输出和执行状态；
5. 支持取消、重试、复制调用和“插入当前对话”；
6. 文件结果显示 `file_ref`/Artifact，而不是把 Base64 展开到聊天窗口。

## 8. 分阶段迁移

### 阶段 0：契约与根因修复（当前）

- 修复 `McpToolsModal`、`McpAiTestModal` 调用时缺少 `ai_config_id`；
- 父组件传递当前 AI 配置 ID；
- 工具列表按 `ai_config_id` 获取；
- 增加直接调用的回归测试；
- 保留文本 MCP parser，不再新增依赖文本格式的功能。

### 阶段 1：统一控制台 MVP

- 复用 `/api/mcp/tools` 和 `/api/mcp/call`；
- 增加 schema-first 的 `console.execute` 统一入口：`target=workspace` 复用服务器工作区执行器，`target=device` 由 Broker 转发到 `tool`/`arguments` 指定的已授权端侧 MCP（默认 `run_command`）；
- 为 MCP 工具 schema 生成统一执行面板；
- 展示 server/device/workspace 目标和权限失败原因；
- 控制台调用与 AI 调用共用 `call_mcp_or_endpoint_tool`。

### 阶段 2：Artifact 和媒体

- 统一 `file_ref`、MIME、大小和过期策略；
- 检查所有模型注入路径，禁止大 Base64 进入持久化消息；
- 增加图片、视频转码和模型输入适配测试。

### 阶段 3：异步工具 Job

- 为 `run_command`、媒体转码和外部 MCP 增加 job/task 适配；
- 首先复用已有持久化 `AgentDispatchTask`，提供 `/api/mcp/jobs`、轮询和取消接口；
- 增加状态事件、取消、超时和重连测试；
- 保持短调用的同步兼容返回。

### 阶段 4：外部 MCP 治理

- 以 AI 配置和会话为边界启用外部 MCP；
- 使用延迟加载/工具搜索减少上下文膨胀；
- 对写入和破坏性工具增加明确审批。

## 9. 验收标准

- 控制台调用 server MCP 成功；
- 控制台调用 endpoint `run_command` 时带正确 `ai_config_id`，scope 不允许时明确拒绝；
- AI 与控制台调用同一工具得到一致的权限和结果格式；
- 图片流程只保存 `file_ref`/附件元数据，模型收到可用的图像输入；
- 长任务可继续聊天，任务完成后收到事件；
- 取消、超时、重试、断线恢复不会重复执行已终态非幂等任务；
- `server` 的相关 pytest、`web` 的 `npm run verify` 和四 Runtime smoke 通过。

## 10. 当前实施记录

- 后端已有 `/api/mcp/tools`、`/api/mcp/call` 和 endpoint dispatch，暂不重复建设第二套执行器。
- 后端已存在服务端 `workspace.run+command` 和 `workspace.file+manage`，优先作为基础控制台/Artifact 能力。
- 第一阶段先修正控制台调用上下文，再建设 schema-first 的统一面板。
- 已完成：直接 MCP 测试弹窗和设备 MCP scope editor 传递 `ai_config_id`；工具列表编辑按当前 AI scope 加载；
  endpoint 调用缺少 AI 上下文时显式返回 400；继承测试把验证后的 scope 传给设备 dispatch。
- 已完成：注册 `console.execute` schema-first 工具；workspace 目标严格复用 `workspace.run+command`，device 目标经过所选 endpoint 工具的 scope 门禁；新增 `/api/mcp/jobs` 创建、查询和取消接口，使用已有 `AgentDispatchTask` 的持久化状态机。
- 前端工具编辑器优先使用后端 `promptTools` 的当前 AI 投影，旧网关没有该字段时才回退到原始 server catalog；端侧工具支持“后台调用”轮询与取消。
- Artifact 基础继续复用 `workspace.file+manage` 的 `file_ref`、MIME、大小和工作区隔离；没有新增把 Base64 写入消息历史的路径。
- 端侧截图仍可在当前调用的瞬时结果中供模型使用，但 `AgentDispatchTask.result_json` 持久化前会把 `data:image/*;base64,...` 替换为长度标记，长期状态只保留 `file_ref`/工作区元数据。

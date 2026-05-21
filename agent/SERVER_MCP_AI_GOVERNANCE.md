# HeySure Agent 服务器连接、MCP 对接与多 AI 治理规范

**定位**：本文档放在 `agent/` 目录，作为桌面 Agent、Server MCP、数字成员 AI、管理者 AI 之间的统一协作规范。  
**适用范围**：`web / server / agent` 三层架构，以及所有通过 AI 配置创建出来的 `assistant_admin`、`digital_member manager`、`digital_member member`。  
**当前基准日期**：2026-05-21。

---

## 1. 总目标

HeySure AI 2.0 的核心不是“一个 AI 调很多工具”，而是一个可治理的多 AI 社会：

1. Server 是调度中心、权限边界和数据归档中心。
2. MCP 是所有 AI 访问外部能力的标准接口。
3. Agent 是可连接到 Server 的执行节点，负责本地文件、Shell、Git 等实际动作。
4. 每个 AI 都必须有明确的身份、上级、下级、权限、工作目录、任务输入和进化输入。
5. AI 之间不要靠口头转述建立协作，必须通过任务、会话、MCP 调用结果、结构化数据和可追溯日志通信。

最终目标是形成下面的闭环：

```text
用户 / Client
  -> Server 调度与权限
  -> 管理者 AI 拆解任务
  -> 下属 AI 执行任务
  -> MCP / Agent 完成真实动作
  -> 结果回传会话与任务记录
  -> 数据上传到 KnowledgeBase / EvolutionArena / Memory
  -> 进化输入生成下一代 prompt、任务策略、知识规则
```

---

## 2. 当前项目中的真实链路

### 2.1 三层结构

```text
web/
  用户界面、AI 卡片、任务弹窗、聊天窗口、MCP 状态展示

server/
  FastAPI + Socket.IO
  负责用户认证、AI 配置、聊天运行、任务队列、MCP 注册与调用、Socket 事件转发

agent/
  Node.js 桌面/本地执行节点
  连接 Server，注册 capabilities，接收 task:dispatch，执行本地工具，回传 task:result
```

### 2.2 已实现的 Agent Socket 协议

当前 `agent/src/index.ts` 使用：

```text
SERVER_URL = process.env.SERVER_URL || "http://localhost:3000"
AGENT_ID = process.env.AGENT_ID || "agent-" + os.hostname()
```

Agent 启动后连接 Server，并发送：

```text
agent:register
{
  id,
  name,
  platform,
  capabilities,
  version
}
```

Server 下发任务：

```text
task:dispatch
{
  taskId,
  userId,
  aiConfigId,
  sessionId,
  instruction,
  tool,
  args,
  allowedTools
}
```

Agent 回传：

```text
task:progress
task:result
task:error
```

Server 将结果写入对应聊天会话，并通过用户房间广播给前端。

### 2.3 已实现的 MCP 入口

Server 侧 MCP 入口：

```text
GET  /api/mcp/tools
POST /api/mcp/call
```

`POST /api/mcp/call` 的核心字段：

```json
{
  "tool": "workspace.read_files",
  "arguments": {
    "paths": ["README.md"]
  },
  "ai_config_id": 1
}
```

当传入 `ai_config_id` 时，Server 会校验：

1. AI 配置是否属于当前用户。
2. AI 是否启用。
3. 该 AI 是否开启 MCP。
4. 工具是否在该 AI 的 `mcp_tools` 白名单中。
5. 文件类工具是否限制在该 AI 的 `workspace_root` 内。

### 2.4 已实现的 MCP 工具分组

当前主要工具能力包括：

```text
workspace.*
  list_files / get_file_tree / read_files / read_file_by_name
  write_file / edit_file / delete_path / run_command / git_diff

admin.*
  list_agents / get_overview / dispatch_flow / dispatch_task

project.*
  list_projects / create_project / update_project / delete_project

task.*
  create_immediate / create_scheduled / create_recurring / create
  list / wait_all / get_current / inherit / complete

prompt.*
  list_targets / read_ai / write_ai / read_system / write_system

feishu.*
  send_message
```

`admin.dispatch_task` 是 Server 通过 MCP 把任务派给已连接桌面 Agent 的桥梁。

---

## 3. 服务器连接规范

### 3.1 Agent 连接配置

Agent 必须支持以下环境变量：

```text
SERVER_URL       必填/默认 http://localhost:3000
AGENT_ID         建议显式配置，必须全局唯一
AGENT_NAME       可选，人类可读名称
AGENT_GROUP      可选，用于标识归属项目/团队
AGENT_TOKEN      后续建议增加，用于 Agent 身份认证
WORKSPACE_ROOT   可选，本地执行根目录
```

当前实现已有 `SERVER_URL` 和 `AGENT_ID`。后续如果 Agent 参与真实生产任务，必须补上 `AGENT_TOKEN`，避免任意客户端伪装成 Agent 注册。

### 3.2 连接生命周期

Agent 生命周期分为：

```text
starting
  读取配置，准备本地工具

connected
  Socket.IO 已连接

registered
  已发送 agent:register，Server 已纳入 agents 列表

dispatching
  正在执行 Server 下发的任务

degraded
  部分本地能力不可用，例如 shell 禁用、git 不存在

disconnected
  与 Server 断开，等待重连

retired
  人工停用或被 Server 禁用
```

### 3.3 注册载荷要求

Agent 注册时必须包含：

```json
{
  "id": "agent-devbox-001",
  "name": "devbox-001",
  "platform": "win32",
  "capabilities": ["fs.list", "fs.read", "fs.write", "shell.run", "git.diff"],
  "version": "2.0.0",
  "workspaceRoot": "D:/work/project",
  "group": "project-alpha"
}
```

`capabilities` 是 Server 调度的基础，不允许虚报。Agent 本地没有实现的能力不能注册。

### 3.4 重连与幂等

1. `agent:register` 必须是幂等的，同一个 `AGENT_ID` 重连时更新 socketId，不创建重复 Agent。
2. Agent 收到重复 `taskId` 时必须返回已有结果或拒绝重复执行，避免写文件/运行命令重复发生。
3. Server 需要清理超时的 `_PENDING_DISPATCHES`，避免 Agent 掉线后任务永久挂起。
4. `task:result` 和 `task:error` 必须 echo `taskId/userId/aiConfigId/sessionId`，便于 Server 在上下文丢失时兜底归档。

---

## 4. MCP 对接规范

### 4.1 MCP 是唯一工具入口

AI 不能绕过 MCP 直接假设自己能访问文件、命令、项目或其它 AI。所有外部动作必须走：

```text
AI 输出工具调用意图
  -> Server 解析工具调用
  -> 校验 AI 配置、白名单、工作目录
  -> 执行 MCP handler
  -> 写入会话/状态
  -> AI 基于真实结果继续
```

### 4.2 MCP 调用格式

当前系统兼容两种文本工具调用格式，推荐 JSON 块：

```text
<mcp-call>
{"tool":"workspace.read_files","arguments":{"paths":["README.md"]}}
</mcp-call>
```

XML-like 兼容格式：

```text
<mcp-call>
<tool>workspace.read_files</tool>
<arguments>{"paths":["README.md"]}</arguments>
</mcp-call>
```

硬规则：

1. 每个 `<mcp-call>` 只调用一个工具。
2. 等待工具返回后再决定下一步。
3. 不允许把多个工具名拼成一个工具名。
4. 不允许编造工具结果。
5. 写入、删除、命令执行、项目变更、任务创建前要先说明目的和影响。

### 4.3 MCP 权限白名单

每个 AI 配置的 `mcp_tools` 必须按角色最小化：

```text
assistant_admin
  可拥有 admin/project/prompt/task/workspace 读写能力，但实际使用要偏观测和配置。

digital_member manager
  可拥有 task.create_*/task.wait_all/task.list/task.get_current/prompt.read_ai/workspace 读能力。
  若要管理下属 prompt，才授予 prompt.write_ai。

digital_member member
  默认只给当前任务所需 workspace/task.complete/task.inherit/task.get_current。
  不应拥有 project.delete_project、prompt.write_system 等跨域能力。

desktop agent
  只暴露本地 capabilities。Agent 不是 Server 全权管理员。
```

### 4.4 工作目录边界

每个 AI 的 `workspace_root` 是它的文件世界边界：

1. `workspace_root = "."` 表示用户默认工作区。
2. 相对路径会被解析到用户工作区下。
3. 绝对路径必须谨慎使用，适合明确指定本机项目路径的管理 AI。
4. MCP 工具必须通过 `safe_join` 或等价机制阻止路径逃逸。
5. Prompt 中必须告诉 AI：所有文件路径使用相对路径，除非系统注入了明确的绝对工作目录。

### 4.5 Agent 与 MCP 的关系

Server 内置 MCP 工具适合访问 Server 侧工作区。桌面 Agent 适合访问本机环境。

调用本机 Agent 的推荐链路：

```text
AI
  -> MCP admin.list_agents
  -> 选择 dispatchable Agent
  -> MCP admin.dispatch_task
  -> Socket.IO task:dispatch
  -> Agent 执行本地工具
  -> task:result
  -> Server 写入当前会话
```

不要让 AI 直接记住某台机器的路径并绕过 Server 调度。

---

## 5. AI 上下级关系

### 5.1 角色层级

当前系统中的角色应按以下层级理解：

```text
用户 / Client
  最高决策者，可创建、停止、删除、配置所有 AI。

assistant_admin
  辅助管理员，偏系统观测、排查、配置协助。
  不作为任务执行团队的默认父节点。

digital_member + manager
  数字社会管理员 / 项目管理者。
  负责拆任务、创建子任务、等待结果、验收、沉淀知识。

digital_member + member
  执行 AI。
  负责完成被分配的具体任务，并向自己的 manager 回传结果。

desktop agent
  执行节点，不是独立治理者。
  只接收 Server 派发的本地工具任务。
```

### 5.2 推荐的治理树

```text
Client
  -> 主脑 / 核心管理者 digital_member(manager)
      -> 项目管理者 A digital_member(manager)
          -> 执行 AI A1 digital_member(member)
          -> 执行 AI A2 digital_member(member)
      -> 项目管理者 B digital_member(manager)
          -> 执行 AI B1 digital_member(member)
  -> 辅助管理员 assistant_admin
      -> 只做观测、排查、配置协助
```

### 5.3 归属字段设计

当前 `AssistantAIConfig` 已有：

```text
id
user_id
name
ai_role
digital_member_role
project_id
project_name
sort_order
workspace_root
mcp_tools
system_auto_control
```

为了严格表达“每个 AI 管理各自手下的 AI”，后续建议增加：

```text
parent_ai_config_id       直属上级 AI
root_manager_ai_config_id 所属治理树根节点
management_scope          self / children / project / global
managed_ai_config_ids     可选缓存，直属下属列表
```

在这些字段落地之前，临时规则是：

1. 使用 `project_id` 表示团队边界。
2. 使用 `digital_member_role=manager` 表示可调度其它成员。
3. 使用 `target_ai_config_id` 显式指定子任务目标。
4. Prompt 中要求 manager 只调度同项目或用户明确指定的成员。

### 5.4 管理权硬规则

1. 一个 AI 默认只能管理自己。
2. `digital_member manager` 只能管理自己的直接下属或同项目内被授权成员。
3. `assistant_admin` 可以代理创建任务，但应优先路由到可用 manager，不直接长期管理 member。
4. member 不能给其它 member 派任务，除非用户明确把它升级为 manager。
5. manager 调用 `prompt.write_ai` 修改下属 prompt 前，必须说明原因、变更范围和回滚方案。
6. 删除项目、删除任务、删除文件、修改系统 prompt 属于高风险操作，必须显式说明。

### 5.5 任务扇出与汇总

管理者拆任务时使用：

```text
task.create_immediate
task.create_scheduled
task.create_recurring
```

跨成员并行时：

```text
1. manager 为多个 member 创建子任务，传入 target_ai_config_id。
2. 收集返回的 job_id。
3. 调用 task.wait_all 等待所有子任务完成。
4. 阅读 results.summary。
5. 汇总为自己的结论。
6. 必要时写入 KnowledgeBase / Memory。
```

子任务不要让所有 member 同时写同一个文件。需要写同一成果时，manager 先分配独立输出路径，再统一合并。

---

## 6. MCP 对话通信规范

### 6.1 通信对象

系统中存在四类通信：

```text
用户 <-> AI
  普通聊天、任务指令、配置要求。

AI <-> MCP
  工具调用和工具结果。

AI <-> AI
  通过 task.* 创建子任务、等待结果、继承摘要，不直接私聊。

Server <-> Agent
  通过 Socket.IO dispatch/progress/result/error。
```

### 6.2 AI 之间不直接传私信

AI 间通信必须落到可追溯记录：

1. 任务：`AITaskJob`。
2. 会话：`ChatSession` / `ChatMessage`。
3. 工具结果：MCP 状态与消息 tags。
4. 归档：KnowledgeBase / EvolutionArena / Valhalla。
5. 后续结构化记忆：Memory。

不建议实现“AI 直接 socket 私聊”，因为它会绕过权限、任务状态、token 生命周期和知识沉淀。

### 6.3 标准任务消息结构

manager 给 member 创建任务时，`instruction` 必须包含：

```text
[目标]
要完成什么。

[边界]
允许访问哪些目录、工具、数据；不能做什么。

[输入]
必要文件、上游结论、用户要求、相关 job_id。

[交付物]
最终要输出什么，写到哪里，或在会话中返回什么。

[验收]
完成的判定标准。

[回传]
完成后调用 task.complete，并在 summary 中写清结果、证据、风险。
```

### 6.4 子任务 summary 规范

member 完成任务时，`task.complete.summary` 应包含：

```text
完成状态：完成 / 部分完成 / 阻塞
关键结果：最多 5 条
证据位置：文件路径、命令输出摘要、会话结论
风险：未解决问题和影响
建议下一步：给上级 manager 的决策建议
```

### 6.5 等待与超时

manager 使用 `task.wait_all` 时：

1. `timeout_seconds` 根据任务复杂度设置，默认 300 秒。
2. 超时后先读取已完成结果，不要直接重派所有任务。
3. 对超时任务调用 `task.list` 或 `task.get_current` 查询状态。
4. 只有确认任务丢失、阻塞或错误后，才创建替代任务。

---

## 7. Prompt 编写规范

### 7.1 Prompt 分层

每个 AI 的 prompt 分为四层：

```text
基础身份层
  我是谁、角色、职责、边界。

治理关系层
  我的上级是谁、我的下属是谁、我能管理谁。

工具规则层
  MCP 调用格式、工具白名单、工作目录、安全约束。

任务运行层
  当前任务目标、交付物、验收标准、上下文、传承规则。
```

不要把所有内容塞进一段长 prompt。长 prompt 应按标题分区，便于后续 `prompt.write_ai` 做行级修改。

### 7.2 manager Prompt 必备内容

```text
你是 digital_member manager。

你的职责：
1. 理解用户目标并拆成可执行子任务。
2. 只管理自己被授权的下属 AI。
3. 使用 task.create_* 给下属派任务。
4. 使用 task.wait_all 等待并汇总结果。
5. 不直接替下属完成所有细节，除非任务很小或无下属可用。
6. 任务完成后沉淀可复用知识。

你的禁止事项：
1. 不越级管理其它 manager 的下属。
2. 不给没有权限的 AI 派发敏感任务。
3. 不编造子任务结果。
4. 不在没有证据时宣布任务完成。
```

### 7.3 member Prompt 必备内容

```text
你是 digital_member member。

你的职责：
1. 执行上级 manager 或用户分配的明确任务。
2. 优先完成当前任务，不主动扩张范围。
3. 使用 MCP 获取真实上下文和执行真实动作。
4. 阻塞时说明缺什么，不编造结果。
5. 完成后调用 task.complete。
6. 接近 token 上限时调用 task.inherit 或输出传承摘要。
```

### 7.4 assistant_admin Prompt 必备内容

```text
你是 assistant_admin。

你的职责：
1. 观测系统状态。
2. 辅助用户检查 AI 配置、MCP 状态、任务状态和 Agent 连接。
3. 可代理创建任务，但默认交给 digital_member manager。
4. 只做必要配置变更，不作为长期任务执行者。
```

### 7.5 MCP Prompt 必备内容

系统级 MCP prompt 必须写清：

```text
1. 只使用白名单工具。
2. 每轮最多一个工具。
3. 工具调用前说明意图。
4. 工具结果回来后再继续。
5. 文件路径相对 workspace_root。
6. 写入/删除/命令执行前说明影响。
7. 不使用无时区 schedule_at。
8. 循环任务不要传 schedule_at。
```

### 7.6 Prompt 变更原则

1. 优先用 `prompt.read_ai` 读取当前 prompt。
2. 小改用 `prompt.write_ai` 的行级编辑模式。
3. 只有用户明确要求重写时，才使用 `replace_all`。
4. 修改下属 prompt 后，manager 必须记录修改原因和预期效果。
5. Prompt 中不要写死会频繁变化的 Agent socketId、临时 job_id、一次性文件路径。

---

## 8. 数据上传规范

### 8.1 数据分类

系统中的数据分为五类：

```text
任务输入数据
  用户上传/指定的文件、需求、配置、上下文。

执行过程数据
  工具调用结果、命令输出摘要、文件变更、错误信息。

任务结果数据
  子任务 summary、最终报告、交付文件、验收记录。

知识沉淀数据
  可复用经验、失败教训、决策规则、模板。

进化输入数据
  用于改进下一代 AI 的 prompt、策略、工具白名单、任务拆解模式。
```

### 8.2 上传入口

当前可用上传/写入方式：

```text
workspace.write_file
  写入 Server 当前 AI 工作区。

workspace.edit_file
  结构化修改已有文件。

admin.dispatch_task
  让桌面 Agent 在本机执行读取/写入/命令。

task.complete.summary
  把任务结果写回任务系统。

task.inherit.summary
  把代际传承摘要写回任务上下文。
```

后续建议增加正式上传 API：

```text
POST /api/data/upload
POST /api/evolution/input
POST /api/memory/write
```

不要把大文件直接塞进聊天消息。大文件应保存到工作区或对象存储，聊天里只保留路径、摘要、hash 和用途。

### 8.3 文件上传落点

推荐目录：

```text
server/data/workspace/<user_id>/
  uploads/
    raw/                  原始上传，尽量不修改
    normalized/           清洗后的结构化数据
    rejected/             校验失败或不安全文件

  EvolutionArena/
    <ai_config_id>/
      profile.md
      journal.md
      task_runs/

  KnowledgeBase/
    index.md
    domains/
    decisions/
    failures/
    templates/

  Valhalla/
    <ai_config_id>/
      last_words.md
      inheritance.md

  EvolutionInput/
    queue/
    accepted/
    rejected/
    applied/
```

### 8.4 上传元数据

每一份上传数据必须有 metadata：

```json
{
  "data_id": "data_20260521_001",
  "user_id": 1,
  "source": "user_upload | agent_result | mcp_result | ai_summary",
  "owner_ai_config_id": 12,
  "project_id": "project_alpha",
  "job_id": "job_xxx",
  "path": "uploads/raw/input.md",
  "mime": "text/markdown",
  "sha256": "...",
  "created_at": 1779379200,
  "visibility": "private | project | manager_tree",
  "purpose": "task_input | evidence | memory | evolution_input"
}
```

### 8.5 上传校验

上传进入任务系统前必须做：

1. 文件大小限制。
2. MIME/扩展名白名单。
3. 路径归一化，禁止 `../` 逃逸。
4. 文本编码检测。
5. 大文本切片和摘要。
6. 敏感字段扫描，例如 API key、token、密码。
7. hash 去重。
8. 记录来源 AI 和 job_id。

---

## 9. 进化输入上传规范

### 9.1 什么是进化输入

进化输入不是普通任务结果，而是用于改进 AI 系统本身的材料：

```text
好的任务拆解方式
失败的工具调用模式
高质量 summary 模板
某类任务的最佳 prompt
某个 AI 的行为缺陷
某个 MCP 工具的参数坑
某次事故的根因与防复发规则
```

### 9.2 进化输入格式

```json
{
  "evolution_input_id": "evo_20260521_001",
  "type": "prompt_rule | tool_rule | workflow_rule | memory | failure_case | success_case",
  "source_ai_config_id": 8,
  "target_scope": {
    "role": "digital_member",
    "digital_member_role": "manager",
    "project_id": "project_alpha"
  },
  "evidence": [
    {
      "kind": "chat_message",
      "id": 123
    },
    {
      "kind": "file",
      "path": "KnowledgeBase/failures/mcp-schedule-timezone.md"
    }
  ],
  "proposal": "创建定时任务时，schedule_at 必须带时区；无时区输入应拒绝。",
  "risk": "过度严格可能拒绝用户自然语言时间，需要前端转换。",
  "review_status": "queued",
  "created_at": 1779379200
}
```

### 9.3 进化输入流程

```text
1. AI 或 manager 发现可复用经验。
2. 写入 EvolutionInput/queue/*.json 或调用后续 /api/evolution/input。
3. 核心管理者定期审查 queued 输入。
4. 通过后进入 accepted。
5. 由管理者决定应用到：
   - 某个 AI prompt
   - 系统 MCP prompt
   - KnowledgeBase 文档
   - 工具白名单默认策略
   - 任务模板
6. 应用完成后进入 applied，并记录 applied_to。
```

### 9.4 进化输入审查标准

1. 必须有证据，不能只有主观评价。
2. 必须明确适用范围，不能把局部经验推广到全局。
3. 必须写清风险和回滚办法。
4. 涉及 prompt 修改时优先小范围试点。
5. 涉及权限扩大时默认拒绝，除非用户明确批准。

---

## 10. 结构化 Memory 设计

当前 `doc/升级优化计划.md` 中 `OPT-05` 已提出结构化 Memory，建议作为下一阶段优先项。

### 10.1 Memory 数据模型

```json
{
  "memory_id": "mem_xxx",
  "user_id": 1,
  "ai_config_id": 12,
  "project_id": "project_alpha",
  "job_id": "job_xxx",
  "generation": 2,
  "kind": "fact | decision | lesson | todo | risk | template",
  "tags": ["mcp", "schedule", "timezone"],
  "content": "task.create_scheduled 的 schedule_at 必须带时区。",
  "source": {
    "chat_message_id": 123,
    "file_path": "doc/ops/timezone-incident.md"
  },
  "confidence": 0.8,
  "created_at": 1779379200
}
```

### 10.2 MCP 工具建议

```text
memory.write
memory.search
memory.list
memory.update
memory.archive
```

### 10.3 Memory 使用规则

1. 任务开始时检索与任务标题、项目、工具相关的 memory。
2. 任务结束时只写高价值 memory，不写流水账。
3. manager 汇总多个子任务后，可以写 project 级 memory。
4. memory 不替代 KnowledgeBase；memory 是可检索事实和经验，KnowledgeBase 是整理后的知识文档。
5. 低置信度 memory 不直接注入 prompt，只作为参考。

---

## 11. 安全与权限

### 11.1 高风险工具

以下工具属于高风险：

```text
workspace.write_file
workspace.edit_file
workspace.delete_path
workspace.run_command
admin.dispatch_task
project.delete_project
prompt.write_ai
prompt.write_system
task.create_*
feishu.send_message
```

高风险工具调用前，AI 必须说明：

```text
目的
目标对象
预期影响
失败回滚方式
```

### 11.2 权限隔离

1. `user_id` 是最高数据隔离边界。
2. `workspace_root` 是文件隔离边界。
3. `project_id` 是团队协作边界。
4. `parent_ai_config_id` 是后续建议增加的管理边界。
5. `mcp_tools` 是能力边界。
6. `AGENT_ID + AGENT_TOKEN` 是桌面 Agent 身份边界。

### 11.3 审计日志

所有以下行为都应可审计：

```text
AI 创建/修改/删除
MCP 高风险工具调用
任务创建/暂停/恢复/删除/完成
Prompt 修改
Agent 注册/断开/执行任务
数据上传/进化输入应用
```

审计记录至少包含：

```text
user_id
actor_ai_config_id
target_ai_config_id
tool
arguments摘要
result摘要
timestamp
session_id
job_id
```

---

## 12. 任务与进化闭环

### 12.1 标准任务闭环

```text
用户提出目标
  -> manager 拆解
  -> task.create_* 派给 member
  -> member 使用 MCP 执行
  -> member task.complete
  -> manager task.wait_all
  -> manager 汇总交付
  -> 写入 KnowledgeBase / Memory / EvolutionInput
```

### 12.2 代际传承闭环

当会话 token 接近 `token_limit`：

1. AI 停止扩张新任务。
2. 汇总当前状态、已完成、未完成、关键证据、风险。
3. 调用 `task.inherit` 提交传承摘要。
4. 下一代任务启动时读取传承摘要和相关 memory。
5. 新一代不得重复已完成工作，除非证据缺失。

### 12.3 死循环防护

AI 如果连续出现以下行为，应暂停并等待 manager 或用户处理：

1. 重复调用同一个失败工具。
2. 多次不调用 `task.complete` 但声称完成。
3. 子任务 summary 没有证据。
4. 对无权限工具反复尝试。
5. 不断创建新任务但不汇总已有结果。

---

## 13. 推荐实现路线

### Phase 1：补齐 Agent 连接可靠性

1. Agent 注册增加 `AGENT_TOKEN`。
2. Server 对 `agent:register` 做身份校验。
3. Agent 增加 taskId 幂等缓存。
4. Server 清理超时 `_PENDING_DISPATCHES`。
5. 前端显示 Agent 在线、能力、最近任务、错误状态。

### Phase 2：落地严格上下级关系

1. `AssistantAIConfig` 增加 `parent_ai_config_id`。
2. 新增接口：绑定/解绑下属 AI。
3. `task.create_*` 校验 manager 是否有权调度 `target_ai_config_id`。
4. `prompt.write_ai` 校验 manager 是否有权修改目标 AI。
5. 前端 AI 卡片按治理树展示。

### Phase 3：数据上传与进化输入

1. 增加 `uploads` 元数据表或 JSON index。
2. 增加 `EvolutionInput` 队列。
3. 增加 `memory.*` MCP 工具。
4. 任务完成时引导 AI 输出结构化进化建议。
5. 核心管理者定期审查并应用。

### Phase 4：Human-in-the-loop

1. 增加 `human.ask` MCP 工具。
2. 任务进入等待人工输入状态。
3. 前端弹出确认/选择/文本回复。
4. 用户回复作为工具结果返回给 AI。

### Phase 5：异步并发与稳定性

1. 将后台 worker 从 thread 逐步迁移到 asyncio。
2. MCP 调用全链路 async。
3. 为每个 AI 设置并发上限。
4. 为每个 manager 设置同时下属任务上限。

---

## 14. 最小可执行规则清单

如果后续只记一页规则，优先执行这 12 条：

1. Agent 只通过 `SERVER_URL` 连接 Server，通过 `agent:register` 注册能力。
2. AI 所有外部动作都走 MCP，不编造工具结果。
3. 每个 AI 的 `workspace_root` 是文件边界。
4. 每个 AI 的 `mcp_tools` 是能力边界。
5. manager 只管理自己的下属或同项目授权成员。
6. member 不给其它 AI 派任务。
7. AI 之间通过 `task.*` 通信，不直接私聊。
8. 子任务必须写清目标、边界、输入、交付物、验收标准。
9. 完成任务必须调用 `task.complete`，并写 evidence summary。
10. 接近 token 上限必须调用 `task.inherit` 或输出传承摘要。
11. 高风险 MCP 调用前必须说明目的、影响和回滚。
12. 高价值经验必须进入 KnowledgeBase / Memory / EvolutionInput，而不是只留在聊天里。

---

## 15. 当前代码入口索引

```text
agent/src/index.ts
  Agent Socket.IO 连接、注册、task:dispatch 处理。

agent/src/executor.ts
  本地任务执行器，当前支持 fs.list/fs.read/fs.write/shell.run/git.diff。

server/api/socket_events.py
  Server Socket.IO 事件注册，处理 agent:register/task:progress/task:result/task:error/ui:join。

server/api/agent_dispatch.py
  admin.dispatch_task 的实际桥接逻辑，负责下发任务、保存 Agent 回传结果。

server/api/mcp_registry_setup.py
  MCP 工具注册中心。

server/api/mcp_core.py
  MCPRegistry、workspace_root 解析、MCP 状态广播。

server/api/routers/mcp.py
  /api/mcp/tools 和 /api/mcp/call。

server/api/mcp_task_tools.py
  task.create_*/task.wait_all/task.complete 等任务工具。

server/api/models.py
  AssistantAIConfig、AITaskJob、ChatMessage、ChatRun、AIRuntimeStatus 等核心模型。

server/api/routers/chat_runtime_helpers.py
  运行时 prompt 注入、任务 MCP 规则、workspace_root 展示。

doc/MCP工具调用prompt.md
  当前文本 MCP 调用格式说明。

doc/PROJECT_CONTEXT_QUICKSTART.md
  当前项目状态和高频排查入口。
```

---

## 16. 后续实现时的关键判断

1. 如果某条规则会影响权限，先落数据库字段和后端校验，再写 prompt。
2. 如果某个能力只写在 prompt 里，没有后端校验，就不能视为安全边界。
3. 如果某份数据将来要被下一代 AI 使用，就必须结构化保存，不能只留自然语言聊天。
4. 如果任务需要多个 AI 并行，manager 负责拆分写入不同交付路径，再统一合并。
5. 如果工具调用失败，先修参数和权限，不要让 AI 反复尝试同一失败调用。
6. 如果需要长期管理关系，必须引入 `parent_ai_config_id`，不能只依赖名称或排序。


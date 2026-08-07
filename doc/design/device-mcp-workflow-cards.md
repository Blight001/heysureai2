# 通用设备 MCP 自动化卡片落地方案

> 状态：已完整实施（功能开关默认关闭，2026-08-07）
> 适用项目：HeySure AI 2.0
> 核心原则：服务器集中编排、设备复用现有 MCP 执行能力、确定性推进、不逐步调用大模型。

## 1. 背景与目标

HeySure 已允许 Windows、Linux、浏览器、Android 及自定义设备注册动态 MCP 工具，并通过 Connector Runtime 的设备任务链路执行。当前 AI 若要完成多步设备操作，通常需要逐次决定工具、等待结果、再次推理，存在以下问题：

- 重复任务持续消耗模型 token；
- 每一步都经过模型推理，速度慢且结果可能不稳定；
- 成功操作无法沉淀为可复用资产；
- 不同设备若各自实现工作流引擎，接入成本和维护成本过高；
- 权限、版本、审计、失败恢复难以统一。

本方案引入“设备 MCP 自动化卡片”。卡片是服务器保存的受控工作流定义，由服务器端执行器解释。执行器逐步通过现有设备 MCP 派发链路调用工具，收到设备结果后确定性地推进下一步。设备不需要实现新的卡片执行器。

### 1.1 第一阶段目标

- 所有已能注册并执行动态 MCP 的设备都可直接使用卡片；
- 用户可在作坊中创建、编辑、测试、发布和运行卡片；
- AI 可检索并运行卡片，但正常执行过程不再逐步推理；
- 支持输入参数、步骤结果引用、顺序执行、条件分支、有限重试；
- 卡片和运行实例持久化，服务器重启后可恢复；
- 每一步重新进行设备在线、工具契约和权限校验；
- 提供取消、超时、幂等、审计、脱敏和运行历史。

### 1.2 非目标

第一阶段不实现：

- 鼠标、键盘或屏幕操作录制；
- 任意 JavaScript、Python、Shell 表达式作为工作流语言；
- 无限制循环、递归卡片调用或动态工具名；
- 设备离线时继续在设备本地执行整张卡片；
- 分布式事务或对设备动作自动回滚的承诺；
- 将每张卡片动态注册成独立 MCP 工具。

## 2. 设计原则

1. **服务器是唯一编排器**：设备仍是受控 MCP 工具执行壳。
2. **卡片不扩大权限**：能通过卡片执行的动作，必须是当前主体在当前设备上可直接执行的动作。
3. **确定性执行**：步骤推进由程序规则完成，正常路径不调用模型。
4. **发布版本不可变**：运行实例锁定具体版本，编辑不会影响正在运行的实例。
5. **至少一次派发、幂等推进**：允许消息重发，但同一步骤只能产生一次有效终态和一次推进。
6. **受控表达式**：仅支持声明式变量路径、比较和布尔组合，禁止代码执行。
7. **大结果引用化**：截图、文件和大日志存储为安全引用，运行记录只保留摘要。
8. **兼容现有设备**：第一版不要求修改设备协议；可在后续增加可选能力优化取消和进度。
9. **最小部署范围**：业务模型放共享层，推进循环放 Connector Runtime，管理入口放 Gateway，AI 工具放 MCP Runtime。

## 3. 总体架构

```text
作坊 Web / AI 固定 MCP 工具
          |
          v
API Gateway：卡片 CRUD、发布、运行、取消、历史
          |
          v
共享服务层：定义、版本、权限、变量、状态机、审计
          |
          v
Connector Runtime：领取可推进运行、派发单步、接收终态
          |
          v
现有 task:dispatch -> 设备 MCP -> task:result / task:error
```

职责边界：

- **Gateway**：HTTP 鉴权、请求校验、卡片管理和查询，不承担长时间推进循环。
- **共享服务层**：领域模型、编译校验、权限检查、运行事务和状态机真相源。
- **Connector Runtime**：工作流调度器、设备派发、结果关联、离线恢复、超时扫描。
- **MCP Runtime**：只暴露少量稳定的卡片检索、详情和运行工具。
- **AI Runtime**：创建或修复卡片时参与；正常运行不参与。
- **设备端**：继续注册工具、接收单次任务并回传唯一终态。

## 4. 卡片生命周期

```text
draft -> validated -> published -> deprecated -> archived
```

- `draft`：允许修改，不允许普通成员生产运行；
- `validated`：静态校验通过，可进行测试运行；
- `published`：生成不可变版本，可被 AI 和用户运行；
- `deprecated`：已有引用仍可查看，默认不再推荐新运行；
- `archived`：只读保留，不可运行。

每次发布生成新的 `WorkflowCardVersion`。草稿继续编辑时不能覆盖已发布版本。运行实例必须记录 `card_version_id` 和版本内容摘要。

## 5. 卡片定义契约

卡片顶层建议包含：

- `schemaVersion`：工作流格式版本；
- `name`、`description`、`tags`；
- `inputSchema`：运行输入 JSON Schema；
- `requiredCapabilities`：所需设备能力；
- `steps`：步骤映射；
- `startStepId`：入口步骤；
- `limits`：总超时、最大推进次数、最大结果大小；
- `riskLevel`：只读、普通变更、高风险；
- `output`：最终输出映射；
- `compatibility`：设备类型、工具标识和 Schema 兼容要求。

示意定义：

```yaml
schemaVersion: 1
name: 服务状态检查与按需重启
inputSchema:
  type: object
  properties:
    serviceName:
      type: string
      minLength: 1
      maxLength: 128
  required: [serviceName]
startStepId: read_status
limits:
  timeoutSeconds: 300
  maxTransitions: 20
steps:
  read_status:
    type: mcp
    toolRef:
      namespace: device
      name: service.status
      schemaDigest: sha256:...
    arguments:
      service: "${input.serviceName}"
    saveAs: status
    next: check_running
  check_running:
    type: condition
    expression:
      op: eq
      left: "${steps.status.result.running}"
      right: true
    onTrue: finish
    onFalse: restart
  restart:
    type: mcp
    toolRef:
      namespace: device
      name: service.control
      schemaDigest: sha256:...
    arguments:
      action: restart
      service: "${input.serviceName}"
    next: finish
  finish:
    type: end
output:
  runningBefore: "${steps.status.result.running}"
```

说明：上述内容是数据格式示意，不代表一次真实工具调用。

## 6. 步骤类型

第一阶段只允许以下步骤：

### 6.1 `mcp`

调用目标设备已注册的一个 MCP 工具。字段包括：

- `toolRef`：稳定工具身份，禁止通过变量动态生成；
- `arguments`：参数模板；
- `saveAs`：结果变量名称；
- `timeoutSeconds`：单步超时；
- `retryPolicy`：有界重试策略；
- `next`：成功后的下一步骤；
- `onError`：失败终止或跳转到错误处理步骤；
- `resultProjection`：允许保存的结果字段。

### 6.2 `condition`

使用受控表达式选择分支。允许：

- `eq`、`ne`、`gt`、`gte`、`lt`、`lte`；
- `exists`、`contains`、`startsWith`、`endsWith`；
- `and`、`or`、`not`；
- 字面量与声明过的变量路径。

不允许正则执行、模板函数、属性原型访问或任何代码求值。

### 6.3 `delay`

在服务器保存唤醒时间后进入等待，不阻塞进程线程。延迟必须有上限。

### 6.4 `confirm`

进入 `waiting_confirmation`，由指定用户确认后继续。高风险工具可由策略自动插入确认步骤，卡片作者不能删除强制确认。

### 6.5 `end`

显式结束并生成输出。第一阶段不支持子卡片；避免递归、权限传播和版本锁定复杂化。

## 7. 变量与模板

变量命名空间固定为：

- `input`：启动时通过输入 Schema 校验的数据；
- `steps.<saveAs>.result`：已成功步骤的投影结果；
- `steps.<saveAs>.error`：允许错误分支读取的标准错误；
- `run`：运行 ID、开始时间等只读元数据；
- `device`：设备 ID、类型和能力摘要，只读。

模板只允许完整值引用或字符串插值。实现时使用自有解析器，禁止 `eval`、Jinja 任意过滤器及动态对象访问。应禁止访问以下内容：

- 未声明命名空间；
- 以双下划线开头的字段；
- 超过最大深度的路径；
- 尚未完成步骤的结果；
- 未经 `resultProjection` 允许的大型或敏感字段。

敏感输入以运行密文或临时秘密引用保存，不能写入卡片正文、普通日志或审计详情。

## 8. 工具身份与 Schema 兼容

卡片不能只保存易变化的展示名称。`toolRef` 至少应包含：

- 工具命名空间；
- 规范工具名；
- 设备动态工具记录 ID 或提供者标识；
- Schema 摘要；
- 可选的最小、最大兼容版本。

发布时保存工具契约快照。运行每一步前：

1. 读取目标设备当前上报工具目录；
2. 解析规范工具身份和别名；
3. 比较 Schema 摘要或执行兼容性检查；
4. 使用当前 Schema 校验渲染后的参数；
5. 不兼容时以 `TOOL_SCHEMA_INCOMPATIBLE` 失败，不盲目派发。

兼容判断第一阶段采用保守策略：摘要相同直接通过；摘要不同则要求重新验证和发布新版本。后续可增加 JSON Schema 向后兼容分析。

## 9. 数据模型

建议新增以下表。

### 9.1 `workflow_cards`

- `id`、`user_id`、`name`、`description`；
- `status`、`risk_level`、`tags_json`；
- `draft_definition_json`；
- `latest_version_id`；
- `created_by`、`created_at`、`updated_at`、`deleted_at`。

约束：同一用户下可允许重名，但 UI 始终使用 ID；软删除保留审计关系。

### 9.2 `workflow_card_versions`

- `id`、`card_id`、`version_number`；
- `schema_version`、`definition_json`；
- `definition_digest`、`tool_contracts_json`；
- `published_by`、`published_at`。

约束：`card_id + version_number` 唯一；已发布内容不可更新。

### 9.3 `workflow_runs`

- `id`、`card_id`、`card_version_id`；
- `user_id`、`actor_type`、`actor_id`；
- `device_id`；
- `status`、`current_step_id`、`transition_count`；
- `input_json` 或敏感输入引用；
- `variables_json`、`output_json`、`error_json`；
- `deadline_at`、`next_wakeup_at`；
- `lock_version`；
- `started_at`、`finished_at`、`created_at`、`updated_at`。

索引：状态与唤醒时间、设备与状态、用户与创建时间。

### 9.4 `workflow_step_runs`

- `id`、`run_id`、`step_id`、`attempt`；
- `dispatch_task_id`，全局唯一；
- `tool_name`、`tool_schema_digest`；
- `status`；
- `arguments_redacted_json`；
- `result_projection_json`、`result_ref`；
- `error_json`；
- `started_at`、`deadline_at`、`finished_at`。

约束：`run_id + step_id + attempt` 唯一；`dispatch_task_id` 唯一。

### 9.5 `workflow_confirmations`

记录确认请求、风险摘要、确认主体、决定和过期时间。不得仅依赖内存中的等待对象。

## 10. 运行状态机

运行状态：

- `pending`：已创建，等待领取；
- `running`：服务器正在计算下一动作；
- `waiting_device`：已派发并等待设备终态；
- `waiting_confirmation`：等待用户确认；
- `retry_wait`：等待有界重试；
- `paused_offline`：目标设备离线；
- `succeeded`；
- `failed`；
- `cancelled`；
- `timed_out`。

核心转换：

```text
pending -> running
running -> waiting_device | waiting_confirmation | retry_wait
running -> succeeded | failed | timed_out | paused_offline
waiting_device -> running | failed | timed_out | cancelled
waiting_confirmation -> running | cancelled | timed_out
retry_wait -> running | cancelled | timed_out
paused_offline -> running | cancelled | timed_out
```

所有终态不可再次推进。晚到的设备结果只记审计，不改变终态。

## 11. 单步推进事务

每次推进必须在数据库事务中完成：

1. 使用行锁或乐观锁读取运行实例；
2. 检查运行未终止、总截止时间未到；
3. 若处理设备结果，验证 `dispatch_task_id` 与当前等待步骤一致；
4. 幂等保存步骤终态；
5. 将允许字段写入变量区；
6. 计算分支和下一步骤；
7. 增加 `transition_count` 并检查上限；
8. 更新运行状态和当前步骤；
9. 写入待派发 outbox 事件；
10. 提交事务后由派发器发送设备任务。

不得在持有数据库事务期间等待设备或执行网络请求。

## 12. 派发、幂等和 Outbox

系统要按“数据库状态先落盘、消息至少一次送达”设计。

- 每次 MCP 步骤生成唯一 `dispatch_task_id`；
- 同一步重发沿用相同 ID，不创建第二个有效步骤实例；
- 设备已有的同 `taskId` 幂等缓存继续复用；
- Connector 收到终态后按 `dispatch_task_id` 关联步骤；
- 重复终态返回已处理结果，不二次推进；
- 结果与当前等待步骤不匹配时记为迟到或异常结果；
- 建议新增事务 outbox 表，避免“数据库已更新但消息未发送”或相反；
- outbox 发送成功后标记，不因进程重启丢失派发。

如果第一期暂不实现通用 outbox，至少需要可扫描的 `workflow_step_runs.status=dispatch_pending` 状态，由 Connector 周期性补发。

## 13. 超时、重试、取消和离线

### 13.1 超时

区分：

- 单次工具调用超时；
- 单步骤含重试总超时；
- 整张卡片总超时；
- 用户确认超时；
- 设备离线等待上限。

扫描器仅把到期记录转为待推进状态，实际状态转换仍走统一事务函数。

### 13.2 重试

仅允许固定次数、固定或指数退避、带上限的重试。默认只对标记为 `retryable` 的基础设施错误重试。具有副作用的工具默认不自动重试，除非工具明确声明幂等或卡片显式提供幂等键。

### 13.3 取消

取消操作先把运行标记为 `cancelled`。若设备支持取消协议，再尽力发送取消；不支持时允许当前设备调用结束，但返回结果不得推进流程。

### 13.4 离线

派发前发现设备离线时进入 `paused_offline`。设备重新上线事件唤醒匹配运行。超过离线截止时间后失败或超时，不无限等待。

## 14. 权限和安全

卡片运行必须绑定实际发起主体，不能以卡片创建者权限运行。

每个 MCP 步骤派发前依次检查：

1. 发起用户仍有效；
2. 用户仍可访问目标设备；
3. 卡片版本仍允许运行；
4. 当前工具仍在设备目录；
5. DevicePermissionPolicy 与 DeviceMcpPermission 允许调用；
6. 工具风险等级是否需要确认；
7. 渲染参数通过当前 Schema；
8. 参数大小、结果大小和速率限制未超限。

禁止事项：

- 动态拼接工具名；
- 任意代码表达式；
- 卡片正文保存密码、Cookie、Token；
- 通过结果路径读取未声明的敏感字段；
- 卡片发布后绕过新权限策略；
- 因卡片已审核就跳过运行时检查。

审计应记录卡片版本、发起者、设备、工具、脱敏参数、确认、终态和错误码，但不记录秘密原文。

## 15. 结果存储与脱敏

设备结果进入工作流前执行：

- JSON 结构和大小检查；
- 根据工具定义和卡片投影选择字段；
- 统一错误规范化；
- 密钥、认证头、Cookie、密码等字段脱敏；
- 图片、文件、大日志写入已有安全存储，变量区只保存引用；
- 给 Web 和 AI 的摘要设置长度限制。

默认不把完整设备原始结果永久保存在 `workflow_runs.variables_json`。需要故障审计时，可保存有生命周期和访问控制的原始结果引用。

## 16. HTTP API

建议 Gateway 增加 `/api/workflow-cards` 与 `/api/workflow-runs`：

卡片管理：

- `GET /workflow-cards`：分页、标签、状态和设备能力筛选；
- `POST /workflow-cards`：创建草稿；
- `GET /workflow-cards/{id}`：读取草稿及版本摘要；
- `PATCH /workflow-cards/{id}`：编辑草稿；
- `POST /workflow-cards/{id}/validate`：静态验证；
- `POST /workflow-cards/{id}/publish`：发布不可变版本；
- `GET /workflow-cards/{id}/versions`；
- `POST /workflow-cards/{id}/clone`；
- `POST /workflow-cards/import`、`GET /workflow-cards/{id}/export`；
- `DELETE /workflow-cards/{id}`：软删除或归档。

运行管理：

- `POST /workflow-cards/{id}/runs`：指定版本、设备和输入启动；
- `GET /workflow-runs/{runId}`：读取状态；
- `GET /workflow-runs/{runId}/steps`：读取步骤历史；
- `POST /workflow-runs/{runId}/cancel`；
- `POST /workflow-runs/{runId}/confirm`；
- `POST /workflow-runs/{runId}/retry`：仅对允许人工重试的失败实例；
- `GET /workflow-runs`：按卡片、设备、状态和时间筛选。

写接口使用幂等请求键，防止浏览器重试造成重复运行。

## 17. AI MCP 接口

只注册少量固定工具，避免卡片数量扩大模型工具目录：

- `automation.list`：按目标、标签和设备能力返回精简卡片目录；
- `automation.get`：读取某卡片的输入、风险和兼容信息；
- `automation.run`：提交卡片 ID、设备 ID、输入和幂等键；
- `automation.status`：查询运行摘要；
- `automation.cancel`：取消运行；
- `automation.manage`：创建和修改卡片，仅授权主体可用，可后置到第二阶段。

AI 默认只看到名称、用途、参数、风险、兼容设备和 ID，不读取完整步骤。只有创建、修改或排错时才加载定义。

工具调用返回运行 ID 和当前状态。同步等待只允许很短时间；长流程通过状态查询、Socket.IO 事件或任务完成通知获取结果，避免占用 MCP 请求连接。

## 18. 作坊 Web 设计

作坊增加“自动化卡片”区域：

- 卡片列表：状态、版本、适用能力、风险、成功率、最近运行；
- 基础信息编辑；
- 根据设备上报 JSON Schema 自动生成 MCP 步骤参数表单；
- 步骤列表与简单分支编辑；
- 输入 Schema 编辑与测试数据；
- 静态校验结果；
- 发布前工具契约差异检查；
- 指定设备测试运行；
- 实时进度、失败步骤、脱敏结果与取消按钮；
- 版本对比、复制、导入和导出。

第一期优先表单与步骤列表，不要求复杂流程图。条件步骤可用规则组编辑器表达，降低实现成本和错误率。

## 19. 静态校验和编译

保存草稿允许不完整内容，发布必须通过编译校验：

- 顶层 Schema 和输入 Schema 合法；
- 步骤 ID 唯一，入口存在；
- 所有转移目标存在；
- 至少存在一个可达 `end`；
- 不可达步骤给出错误或警告；
- 检测无退出路径的环；
- 最大步骤、分支和定义大小限制；
- 工具引用稳定且契约快照完整；
- 参数模板引用路径存在；
- 结果变量名唯一；
- 风险策略和强制确认满足要求；
- 总超时与单步超时关系合理。

发布后保存规范化定义及摘要。执行器只运行编译通过的不可变版本，不直接解释任意草稿。

## 20. 现有代码落位建议

### 20.1 服务端共享层

新增：

```text
deploy/server/main/api/models/workflow.py
deploy/server/main/api/services/workflows/
  card_service.py
  compiler.py
  expression.py
  permissions.py
  run_service.py
  state_machine.py
  result_store.py
  schemas.py
```

模型由四进程共享，但工作流推进后台循环只能由 Connector Runtime 启动，避免多进程重复消费。

### 20.2 Connector Runtime

新增：

```text
deploy/server/main/connector_runtime/dispatch/workflow_dispatch.py
deploy/server/main/connector_runtime/dispatch/workflow_scheduler.py
```

并在现有设备 `task:result`、`task:error` 处理入口调用统一的工作流结果接收服务。不要复制第二套设备派发协议。

### 20.3 Gateway

新增路由：

```text
deploy/server/main/gateway/routers/workflow_cards.py
deploy/server/main/gateway/routers/workflow_runs.py
```

在 `gateway/app.py` 注册。路由只做鉴权、Schema 转换和服务调用。

### 20.4 MCP Runtime

新增固定工具实现，并在 `main/mcp_runtime/mcp/registry.py` 注册。前端同步维护 `mcpTools.ts` 与 `mcpFormat.ts` 的展示名称和结果格式。

### 20.5 Web

建议新增：

```text
deploy/web/src/components/workshop/automation/
deploy/web/src/api/workflowCards.ts
deploy/web/src/api/workflowRuns.ts
```

具体目录应在实施前结合当前作坊组件结构确认，避免建立平行页面体系。

### 20.6 数据库迁移

在 `deploy/server/other/migrations/versions/` 添加迁移，包含表、外键、唯一约束和调度索引。迁移需能在空库及现有 PostgreSQL 数据库上升级。

## 21. 恢复与调度策略

Connector 启动后扫描：

- `pending`；
- 到期的 `retry_wait`；
- 到期或设备已上线的 `paused_offline`；
- 有 `dispatch_pending` 步骤的 `waiting_device`；
- 已超过截止时间的非终态运行。

多实例部署时使用 PostgreSQL `FOR UPDATE SKIP LOCKED` 或等价机制领取工作，不依赖单机内存锁。每个运行同时只能由一个推进者处理。

心跳与扫描只是补偿机制；正常路径应由创建运行、设备结果、确认结果和设备上线事件主动唤醒。

## 22. 可观测性

结构化日志至少包含：

- `workflow_run_id`；
- `card_version_id`；
- `step_id`；
- `dispatch_task_id`；
- `device_id`；
- `status_from`、`status_to`；
- `duration_ms`；
- 标准错误码。

指标：

- 运行成功率和耗时；
- 单步骤失败率和重试次数；
- 等待设备时长；
- 离线暂停数量；
- Schema 不兼容次数；
- 权限拒绝和确认拒绝次数；
- outbox 积压；
- 超时扫描延迟。

告警优先关注 Connector 调度循环停止、outbox 持续积压、运行长时间无推进和重复终态异常增长。

## 23. 错误码建议

- `CARD_NOT_FOUND`
- `CARD_VERSION_NOT_RUNNABLE`
- `CARD_VALIDATION_FAILED`
- `DEVICE_NOT_FOUND`
- `DEVICE_OFFLINE`
- `DEVICE_ACCESS_DENIED`
- `TOOL_NOT_AVAILABLE`
- `TOOL_SCHEMA_INCOMPATIBLE`
- `TOOL_PERMISSION_DENIED`
- `ARGUMENT_VALIDATION_FAILED`
- `CONFIRMATION_REQUIRED`
- `CONFIRMATION_DENIED`
- `STEP_TIMEOUT`
- `RUN_TIMEOUT`
- `STEP_RESULT_TOO_LARGE`
- `EXPRESSION_EVALUATION_FAILED`
- `MAX_TRANSITIONS_EXCEEDED`
- `DISPATCH_FAILED`
- `RUN_CANCELLED`
- `INTERNAL_STATE_CONFLICT`

错误结构统一包含 `code`、`message`、`phase`、`retryable` 和安全详情；不得泄露敏感参数。

## 24. 测试策略

### 24.1 单元测试

- 卡片编译、图可达性和循环限制；
- 模板解析、结果投影和受控表达式；
- 状态机合法与非法转换；
- 重试、超时和风险策略；
- 权限复检和 Schema 摘要比较；
- 脱敏与大型结果引用化。

### 24.2 数据库与服务集成测试

- 创建、发布、锁定不可变版本；
- 并发推进同一运行仅成功一次；
- 重复结果不重复派发；
- 事务失败后可恢复；
- Connector 重启扫描恢复；
- 取消后晚到结果不推进；
- 设备离线、上线与超时转换；
- outbox 补发。

### 24.3 端到端测试

准备一个测试设备工具集，覆盖：

- 两步顺序成功；
- 条件真假分支；
- 可重试错误后成功；
- 不可重试错误失败；
- 权限运行中撤销；
- 工具 Schema 发布后变化；
- 高风险确认；
- 服务器与 Connector 重启恢复；
- 重复 `task:result`；
- 取消与晚到结果。

### 24.4 Web 测试

- Schema 表单生成；
- 草稿校验与发布；
- 运行进度和取消；
- 脱敏结果展示；
- 不兼容工具提示；
- 大列表分页和筛选。

## 25. 分阶段实施计划

### 阶段 0：调用链确认与契约冻结

- 读取设备派发、终态回传、动态工具和权限现有实现；
- 确认 `taskId` 幂等语义和 Connector 结果入口；
- 冻结卡片 Schema v1、状态机和错误结构；
- 编写架构决策记录和威胁模型。

验收：契约评审通过，测试设备可稳定完成一次现有 MCP 往返。

### 阶段 1：后端最小执行闭环

- 数据模型与迁移；
- 编译器、模板解析、状态机；
- 顺序 `mcp` 和 `end` 步骤；
- Connector 单步派发与结果推进；
- 持久化、超时、取消、重启恢复；
- 最小运行 API。

验收：不调用 AI，测试设备完成多步卡片；Connector 重启后可继续。

### 阶段 2：作坊卡片管理

- 卡片草稿、校验、发布、版本、复制和导入导出；
- 基于工具 Schema 的步骤编辑表单；
- 指定设备测试运行；
- 运行历史和进度展示。

验收：用户可完全通过 Web 创建并运行顺序卡片。

### 阶段 3：条件、重试和确认

- `condition`、`delay`、`confirm`；
- 有界重试和离线暂停；
- 强制风险确认；
- 结果投影、大结果引用和完整审计。

验收：条件分支、高风险确认、离线恢复和取消竞态测试通过。

### 阶段 4：AI 固定入口与轨迹转草稿

- `automation.list/get/run/status/cancel`；
- 精简卡片目录注入；
- 将成功的结构化 MCP 调用轨迹整理成卡片草稿；
- 敏感值参数化和用户确认发布。

验收：AI 正常运行卡片只需少量固定工具调用，执行步骤不产生模型调用。

### 阶段 5：生产加固

- 多实例竞争、outbox、限流和指标告警；
- 大规模运行压测；
- 版本兼容分析；
- 灰度开关、配额和管理员治理；
- 按真实使用数据调整默认超时及结果限制。

## 26. 发布与部署影响

预计涉及：

- Gateway：新增管理和运行 API；
- Connector Runtime：新增调度循环并接入设备终态；
- MCP Runtime：新增固定自动化工具；
- Web：新增作坊界面；
- PostgreSQL：新增迁移；
- AI Runtime：第一至第三阶段原则上无需改动。

实施时应按实际共享代码依赖评估重建范围。共享 `main/api/` 改动可能被多个进程导入，但不代表每次都必须同时重建四个服务。部署前检查进行中的对话和设备任务，先执行迁移，再按 Gateway、Connector、MCP、Web 的实际依赖最小范围滚动更新。第一版通过功能开关隐藏入口，验证后再开放。

## 27. 灰度与回滚

建议配置：

- `WORKFLOW_CARDS_ENABLED`；
- `WORKFLOW_SCHEDULER_ENABLED`；
- 每用户并发运行上限；
- 每设备并发步骤上限；
- 最大定义大小、最大步骤数、最大总超时；
- 原始结果保留期限。

回滚时先关闭新运行入口和调度器，保留数据表与只读查询。不要回滚已经执行的设备副作用。数据库迁移优先采用向前兼容方式，旧代码忽略新表即可。

## 28. 验收标准

功能：

- 任意已注册动态 MCP 的设备无需新增执行器即可运行卡片；
- 顺序、条件、重试、确认、取消和超时行为符合状态机；
- 发布版本不可变，运行锁定版本；
- Web 和 AI 均可启动并查询运行。

可靠性：

- Connector 重启不丢运行；
- 重复派发或重复结果不造成重复推进；
- 取消后晚到结果不产生下一步骤；
- 多实例下同一运行不会并发推进。

安全：

- 每一步重新做设备、工具和权限检查；
- 卡片不能动态选择未发布工具；
- 高风险步骤按策略确认；
- 敏感值不进入卡片、普通日志和结果摘要。

效率：

- 正常卡片执行过程模型调用次数为零；
- AI 运行卡片只读取精简目录和输入 Schema；
- 单步延迟主要由网络和设备 MCP 执行构成，无额外模型等待。

## 29. 风险与取舍

- **网络往返**：每一步均经过服务器，延迟高于设备本地执行；换取统一接入和维护。
- **服务器可用性**：服务中断会暂停流程；通过持久化、恢复扫描和 outbox 缓解。
- **设备副作用不可回滚**：系统提供审计、确认和幂等，不宣称事务回滚。
- **工具契约变化**：发布时锁定快照，运行时保守拒绝不兼容工具。
- **结果数据膨胀**：结果投影、大小限制、引用存储和生命周期管理。
- **流程复杂度失控**：第一版限制步骤类型、图规模、重试和转移次数。

## 30. 最终结论

HeySure 的通用自动化卡片应采用“服务器集中工作流执行器 + 现有设备 MCP 单步执行”的标准形态。卡片是版本化、受权限控制的声明式工作流；Connector Runtime 每收到一次设备终态后，通过持久化状态机推进下一步。这样任何自定义设备只需遵守现有 MCP 注册与任务回传协议，无需独立实现卡片引擎，同时能实现统一编辑、权限、审计、恢复和低 token 自动化运行。

## 31. 实施记录

### 2026-08-07：完整方案落地

已落地：

- 卡片、不可变版本、运行、步骤尝试、持久化确认、审计事件和调度器心跳模型；
- 单头 Alembic 迁移 `c6d7e8f9a0b1`，包含完整外键、唯一约束和调度索引；
- Schema v1 编译器及 `mcp`、`condition`、`delay`、`confirm`、`end` 五类步骤；
- 安全模板和表达式、图可达性/环/支配路径数据流、规模、超时、重试和敏感字段校验；
- 草稿、校验、发布、版本、弃用、归档、复制、导入、导出和结构化 MCP 轨迹转草稿；
- 运行幂等创建、状态/步骤/确认/审计查询、取消、人工重试和大型结果读取；
- Connector 持久化 `dispatch_pending` outbox、稳定 `taskId`、多实例 `SKIP LOCKED` claim、崩溃补偿和设备重连主动唤醒；
- 固定/指数有界重试、单次/步骤总/运行/确认/离线超时，以及破坏性工具强制确认；
- 每一步重新复核用户、卡片版本、设备归属和在线状态、工具范围、权限策略、提供者、Schema 摘要、参数 Schema 与参数大小；
- 运行输入 Fernet 加密、参数与结果脱敏、结果投影、超限结果安全引用、保留期清理和访问控制；
- 重复终态和取消后晚到结果幂等忽略并留审计；
- MCP Runtime 固定工具 `automation.list/get/run/status/cancel/manage`，默认 AI 工具集不包含管理入口；
- 作坊 Web 卡片管理、Schema 参数表单、步骤/分支编辑、发布契约设备选择、版本对比、测试运行、确认、取消、重试和历史进度；
- 运行成功率、耗时、失败、重试、确认拒绝、权限/Schema 拒绝、outbox 积压、停滞运行和调度器心跳指标；
- 灰度开关、系统级并发/参数/结果配额和 Connector-only 调度启动边界。

验证记录：工作流编译/表达式/轨迹转换/迁移结构/状态机/重试/幂等/权限测试共 16 项通过；服务端相关模块完整导入通过；迁移以 PostgreSQL 方言成功生成 52 条 DDL；Web `vue-tsc` 与 Vite 生产构建通过。

部署启用顺序：先执行 `alembic upgrade head`，然后在 Gateway 设置
`HEYSURE_WORKFLOW_CARDS_ENABLED=true`，在 Connector Runtime 同时设置
`HEYSURE_WORKFLOW_SCHEDULER_ENABLED=true`。只启用卡片开关可管理草稿，但启动运行会返回
`WORKFLOW_SCHEDULER_DISABLED`，避免创建无法推进的实例。回滚时先关闭新运行和调度开关，保留表与只读历史；设备已产生的副作用不会被数据库回滚。

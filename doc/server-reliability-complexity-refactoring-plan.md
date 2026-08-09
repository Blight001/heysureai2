# HeySure Server 全面可靠性与复杂度整改方案

> 状态：实施中（2026-08-09 已完成可靠性底座与首批拆分；详见 `doc/refactoring/server-reliability-implementation-log.md`）
> 范围：`deploy/server/`，以及与服务器部署直接相关的根目录 Docker Compose  
> 目标：在不停止业务演进的前提下，逐步降低代码复杂度，消除多进程生命周期隐患，并建立可持续的测试、部署与质量门禁。

## 1. 背景与结论

HeySure Server 已从单体服务演进为共享代码层加四个独立进程：

1. API Gateway（3000）
2. MCP Runtime（3001）
3. Connector Runtime（3002）
4. AI Runtime（3003）

当前脆弱性不只是“文件太长”，而是以下问题共同作用：

- `main/api/` 被四个进程共享，启动副作用会被重复执行。
- 数据库兼容逻辑、运行时启动、Socket 生命周期和任务队列存在隐式耦合。
- AI、MCP、设备调度均为长链路，任一环节失去终态都可能让调用长时间等待。
- 容器的 `running` 不等于应用 `ready`，发布脚本缺少分阶段健康确认。
- 单元测试已有一定规模，但缺少真实 PostgreSQL、多进程重启和 Socket 往返测试。
- 核心编排函数过长，状态转换和异常补偿难以被完整理解及验证。

因此，本次整改必须同时推进四条主线：

- 代码复杂度治理
- 进程职责和状态机治理
- 测试与故障演练
- 部署、健康检查与可观测性治理

只拆文件、不建立运行时契约和测试门禁，不能解决服务器脆弱问题。

## 2. 当前基线

本方案编写时，对 `deploy/server/main/**/*.py` 的静态统计如下：

| 指标 | 当前值 |
| --- | ---: |
| Python 生产文件 | 199 |
| 超过 500 行的生产文件 | 25 |
| 超过 80 行的函数 | 67 |
| pytest 测试文件 | 51 |
| 最大测试文件 | 257 行 |

优先关注的生产文件：

| 文件 | 当前规模 | 主要风险 |
| --- | ---: | --- |
| `main/ai_runtime/inference/core.py` | 3415 行 | 推理、工具循环、设备调度、持久化和异常处理耦合 |
| `main/api/core/migrations.py` | 1791 行 | 历史迁移与运行期兼容逻辑边界模糊 |
| `main/gateway/routers/admin.py` | 1697 行 | 路由、查询、组装和管理操作混杂 |
| `main/connector_runtime/dispatch/device_dispatch.py` | 1228 行 | 队列、Socket、持久化、超时与结果处理共存 |
| `main/ai_runtime/inference/ai_message_service.py` | 1083 行 | 消息构造和推理流程耦合 |
| `main/api/chat_runtime/chat_prompt_utils.py` | 1055 行 | Prompt 规则集中、变更影响面大 |
| `main/api/services/workflows/run_service.py` | 1010 行 | 工作流状态转换复杂 |
| `main/api/socket_events.py` | 594 行 | 注册函数约 364 行，多个 Socket 事件共享可变状态 |

高风险长函数：

| 函数 | 当前规模 | 目标 |
| --- | ---: | ---: |
| `_run_worker_impl` | 约 1898 行 | 编排函数不超过 80 行 |
| `_execute_turn_call` | 约 601 行 | 拆成独立工具调用状态机 |
| `register_agent_socket_events` | 约 364 行 | 仅负责装配，各 handler 独立 |
| `list_ai_cards` | 约 362 行 | 查询、权限、DTO 组装分层 |
| `_register_builtin_tools` | 约 305 行 | 声明式注册表 |

这些数字是整改基线，不代表需要一次性重写。

## 3. 整改目标与不可妥协的系统不变量

### 3.1 最终目标

- 登录和普通 API 不得被运行时启动 DDL、长事务或设备任务阻塞。
- 任一外部 MCP 调用必须在成功、失败、取消或超时中得到明确终态。
- 任一进程重启后，不得遗留永久 `running`、`pending` 或 `queued` 任务。
- 单个 Runtime 重启不得导致其它 Runtime 同时不可用。
- 发布过程必须以应用就绪状态为准，而不是以容器启动状态为准。
- 新增代码不得扩大现有复杂度债务。
- 高风险链路必须具备自动化集成测试和可重复故障演练。

### 3.2 系统不变量

以下规则应写入测试、代码注释和运维验收，而不是只存在于文档中：

1. `HEYSURE_DB_AUTO_MIGRATE=0` 时，四个 Runtime 启动不得执行任何 DDL。
2. 数据库结构变更只能由 `db-migrate` / Alembic 执行。
3. 每个 `ChatRun` 和 `AgentDispatchTask` 最终必须进入终态。
4. 同一设备队列中的过期任务不得永久阻塞后续任务。
5. 只有 Connector Runtime 拥有端侧 Agent Socket 和设备调度生命周期。
6. Gateway 只负责公共 API、用户侧 Socket 和内部服务编排。
7. AI Runtime 只负责领取并执行持久化的 AI 运行任务。
8. MCP Runtime 只负责工具注册、权限复核和工具执行入口。
9. `main/api/` 模块导入不得产生启动服务、修改数据库或重置在线状态等副作用。
10. 所有跨进程内部调用必须具有连接超时、响应超时、重试边界和可观察的错误码。
11. `live`、`ready`、`draining` 必须是不同状态。
12. 所有生产修复必须包含能够在修复前失败、修复后通过的回归测试。

## 4. 复杂度门禁设计

参考 `device/AI-FREE-app` 的渐进式基线方案，为 Python 后端建立 `check_guardrails.py`。

### 4.1 生产代码限制

| 指标 | 新代码目标 | 第一阶段处理方式 |
| --- | ---: | --- |
| 单文件有效行数 | 500 | 存量建立基线，新增超限失败 |
| 单函数有效行数 | 80 | 存量建立基线，新增超限失败 |
| 圈复杂度 | 15 | 存量建立基线，新增超限失败 |
| 函数参数数量 | 8 | 超限建议改用 DTO/上下文对象 |
| 嵌套深度 | 4 | 超限建议早返回或拆分策略 |
| 单模块直接依赖数 | 15 | 超限必须评估职责是否混杂 |

“有效行数”跳过空行和纯注释。自动生成代码、Alembic 版本文件和明确的声明式数据文件可以豁免。

### 4.2 测试代码限制

测试不能完全照搬生产代码规则，也不能无限豁免：

| 指标 | 测试代码目标 |
| --- | ---: |
| 单测试文件有效行数 | 800 |
| 单测试函数有效行数 | 120 |
| 圈复杂度 | 20 |

允许豁免：

- 集中测试夹具
- 参数化用例数据
- 协议兼容样本
- 快照和黄金文件加载器

不允许豁免：

- 在一个测试函数内复制完整业务实现
- 通过大量条件分支模拟生产状态机
- 多个无关业务场景堆积在同一个测试文件

### 4.3 渐进式基线

新增：

- `other/scripts/check_guardrails.py`
- `other/scripts/guardrail_baseline.json`
- `doc/refactoring/server-over-limit-list.md`

门禁规则：

1. 首次执行记录现有超限数量和文件清单。
2. 存量暂不阻塞提交。
3. 任一超限计数增加则 CI 失败。
4. 任一超限被消除后，更新并收紧基线。
5. 新文件不得以“存量”为理由直接进入超限清单。
6. 豁免必须包含原因、负责人和计划移除阶段。

### 4.4 统一验证入口

为 Windows、本地 Python 和 Docker 提供同一语义的命令：

```text
python other/scripts/check_guardrails.py
python other/scripts/check_architecture.py
pytest
pytest other/tests/integration
python other/scripts/verify_server.py
```

最终聚合为一个 `verify` 入口，CI 与开发者本机执行同一组检查。

## 5. 目标架构与职责边界

### 5.1 数据库生命周期

目标：彻底消除 Runtime 启动期间的隐式迁移。

- Alembic 是唯一结构权威。
- `db-migrate` 是唯一允许执行 DDL 的服务。
- Runtime 启动只做只读 schema/version 检查。
- schema 不匹配时 Runtime 应快速失败，并输出明确版本差异。
- PostgreSQL 为所有内部事务设置合理的：
  - `lock_timeout`
  - `statement_timeout`
  - `idle_in_transaction_session_timeout`
- 所有 session 必须具有清晰提交/回滚边界。
- 禁止在请求结束后保留 `idle in transaction`。

### 5.2 AI Runtime

目标：将推理编排从超长函数变成显式、可恢复状态机。

建议拆分：

```text
ai_runtime/inference/
  orchestrator.py          # 单轮/多轮总编排
  run_context.py           # 运行上下文与不可变 DTO
  model_gateway.py         # 模型请求、流式响应与错误归一化
  tool_loop.py             # 工具调用状态机
  endpoint_dispatch.py     # 端侧工具调度客户端
  mcp_dispatch.py          # MCP Runtime 调用客户端
  persistence.py           # 工具边界、消息和 run 状态持久化
  completion.py            # 完成、停止、错误和通知
  policies.py              # 步数、超时、上下文压缩策略
```

要求：

- `_run_worker_impl` 最终只保留流程编排。
- 每个状态转换都可以单独测试。
- 模型请求、MCP 调用、设备调用必须使用独立超时。
- 进程停止时先进入 `draining`，停止领取新任务，再等待在途任务。
- 超过排空期限的任务必须原子地退回 `queued`。
- 进程启动时应基于 worker lease/heartbeat 恢复孤儿任务，而不是只看时间猜测。

### 5.3 Connector Runtime

目标：设备 Socket、任务队列、持久化和回执处理各自独立。

建议拆分：

```text
connector_runtime/dispatch/
  service.py               # 用例编排
  repository.py            # AgentDispatchTask 数据访问
  queue.py                 # 单设备队列与晋升规则
  socket_transport.py      # task:dispatch emit
  result_handler.py        # progress/result/error 归一化
  timeout_service.py       # 超时、取消、孤儿回收
  resolver.py              # AI + 用户 + 工具 → 唯一设备
  models.py                # 内部 DTO 与状态枚举
```

必须整改：

- Connector 重启时，按 `owner_instance_id` / lease 识别前一实例的孤儿任务。
- 不再用“创建超过 300 秒”判断是否属于旧进程。
- `/dispatch`、`/dispatch/result`、`/dispatch/expire` 必须由同一服务定义和测试。
- 超时必须释放设备队列并晋升下一任务。
- Agent 晚到回执必须遵循明确策略，不得覆盖不允许覆盖的终态。
- 设备在线状态必须区分：数据库快照、当前 Socket 在线、可调度。
- 工具解析失败应立即返回 4xx/503，不得创建永远等待的任务。

### 5.4 Socket 事件

目标：`register_agent_socket_events` 只做装配。

建议拆分：

```text
api/socket_handlers/
  registration.py
  disconnect.py
  task_progress.py
  task_result.py
  task_error.py
  remote_control.py
  remote_terminal.py
  auth.py
```

每个 handler：

- 输入先进行 schema 校验。
- 只调用服务层，不直接拼接复杂数据库操作。
- 使用结构化日志携带 `device_id`、`task_id`、`user_id`。
- 断线与重复注册必须幂等。

### 5.5 Gateway 与路由

- 路由只做认证、输入验证、调用 service、映射响应。
- 查询、权限决策、DTO 组装从 `admin.py` 等超长路由中拆出。
- `/internal/*` 和 `/api/*` 使用不同 Router 和错误模型。
- 公共错误响应携带稳定 `error_code`，不依赖文本匹配。

### 5.6 MCP Runtime

- 工具注册表改为声明式模块集合。
- 权限检查、工具解析、设备解析和实际执行分层。
- 动态设备能力以设备上报为权威，服务器只应用权限策略。
- “设备关闭后重新开启能力”的授权恢复逻辑建立通用状态机测试。
- MCP 每次调用记录分阶段耗时：解析、权限、排队、设备执行、结果回传。

## 6. 测试体系整改

### 6.1 测试分层

```text
other/tests/
  unit/                     # 纯函数、策略、状态机
  contract/                 # 进程间 HTTP/Socket 协议
  integration/              # 真实 PostgreSQL + Runtime
  e2e/                      # Gateway → AI → MCP → Connector → 模拟设备
  deployment/               # 启停、迁移、健康检查和滚动发布
  fixtures/
```

### 6.2 必须优先补齐的回归测试

#### 数据库与登录

- schema 已完整时，四个 Runtime 启动不执行 `ALTER TABLE`。
- 存在长只读事务时，Runtime 启动不阻塞登录。
- schema 版本落后时，Runtime 快速失败并提示运行迁移。
- 请求异常后 session 自动回滚，不留下 `idle in transaction`。

#### AI 对话

- AI Runtime 停止领取新任务后，健康状态变为 `draining`。
- 排空成功的任务不重复执行。
- 排空超时的 `running` 任务重新进入 `queued`。
- Worker 崩溃后 heartbeat/lease 自动恢复任务。
- 同一会话已有运行任务时，后续消息获得明确排队状态。

#### 设备与 MCP

- 设备能力关闭再开启，原先完整授权自动扩展到恢复后的能力。
- 用户主动取消的权限不得被自动重新开启。
- Connector 重启后，旧实例 `pending` 任务立即终结或重新投递。
- 任务超时后设备队列可以继续处理下一条任务。
- `expire` 路由存在且能结束任务、释放队列。
- 设备在线但没有目标工具时立即失败。
- 多台设备暴露同名工具时，按 AI 绑定和设备能力选择正确设备。
- 动态网页 MCP 在网页打开后自动出现在授权范围。

#### Socket 协议

- 重复注册、断线重连、旧 SID 替换均幂等。
- 未认证 Agent 注册被拒绝。
- Result 重复上报不产生重复消息。
- 结果在 Connector 重启边界到达时仍可持久化。

### 6.3 模拟设备

建立轻量 Socket.IO 模拟 Agent：

- 可声明任意设备类型和动态工具。
- 可立即成功、延迟成功、返回错误、永不响应、断线后重连。
- 可重复发送 progress/result。
- 可用于 CI，不依赖真实 Windows、Android 或 AI-FREE。

真实设备仍保留发布前验收，但不应成为基础回归测试的唯一手段。

### 6.4 覆盖率策略

- 第一阶段记录当前覆盖率基线，不立即追求总量数字。
- 新增/修改代码要求增量覆盖率不低于 85%。
- 调度状态机、权限策略、迁移检查目标分支覆盖率不低于 90%。
- 路由样板、模型声明和迁移版本文件可按规则排除。
- 覆盖率不能替代状态转换和故障注入测试。

## 7. 健康检查与可观测性

### 7.1 标准健康端点

每个 Runtime 提供：

| 端点 | 含义 |
| --- | --- |
| `/internal/health/live` | 进程存活，事件循环可响应 |
| `/internal/health/ready` | 可以接受新业务请求 |
| `/internal/health/detail` | 数据库、内部依赖、队列和版本摘要 |

AI Runtime 额外返回：

- `accepting_runs`
- `active_run_count`
- `queued_run_count`
- `draining`
- `last_dispatch_at`

Connector Runtime 额外返回：

- `connected_agent_count`
- `dispatchable_agent_count`
- `pending_dispatch_count`
- `queued_dispatch_count`
- `oldest_pending_age_seconds`
- `last_result_at`

### 7.2 结构化日志字段

统一字段：

- `service_role`
- `instance_id`
- `request_id`
- `run_id`
- `task_id`
- `device_id`
- `user_id`
- `ai_config_id`
- `session_id`
- `tool`
- `stage`
- `elapsed_ms`
- `error_code`

日志不得输出 Token、密码、Cookie、API Key 或完整敏感工具结果。

### 7.3 核心指标与告警

建议至少监控：

- 登录成功率和 P95 延迟
- 各 Runtime readiness
- ChatRun 各状态数量与最老年龄
- AgentDispatchTask 各状态数量与最老年龄
- 设备在线数与可调度数差值
- MCP 成功率、超时率和分阶段延迟
- PostgreSQL 等待锁数量
- `idle in transaction` 数量与最长时间
- 内部 HTTP 404/401/5xx

初始告警建议：

- 登录 P95 超过 3 秒持续 5 分钟
- 任一数据库未授予锁持续超过 5 秒
- `idle in transaction` 超过 30 秒
- `pending` 设备任务超过自身 deadline
- `running` ChatRun 心跳超过 60 秒
- Runtime readiness 连续失败 3 次

## 8. 部署流程整改

### 8.1 禁止事项

- 禁止把 `docker compose ps` 的 `Up` 当作发布成功。
- 禁止四个 Runtime 无验证同时重启。
- 禁止在高峰期直接执行不可观测的长时间 Compose 命令。
- 禁止迁移失败后继续启动新版本。
- 禁止发布脚本在 AI Runtime 进入 draining 后无限等待。

### 8.2 标准发布阶段

1. 本地/CI 完成静态检查、单测和集成测试。
2. 构建不可变镜像并记录版本/commit。
3. 备份数据库和待修改配置。
4. 单独执行 Alembic migration。
5. 验证 schema 版本。
6. 按依赖顺序更新 Gateway、MCP、Connector、AI，或采用双实例切换。
7. 每个服务必须通过 readiness 后才能进入下一步。
8. AI Runtime 先启动替代实例，再让旧实例 draining。
9. 执行登录、AI 对话、内置 MCP、模拟设备 MCP 冒烟测试。
10. 检查数据库锁、未完成任务和错误日志。
11. 验收完成后记录部署结果。

### 8.3 自动回滚条件

以下任一情况出现即停止后续发布并回滚当前服务：

- readiness 超时
- 登录冒烟失败
- schema 版本不一致
- 新增数据库等待锁持续超过阈值
- ChatRun/DispatchTask 无法进入终态
- 内部接口出现新增 404/401
- 关键错误率超过发布前基线

回滚只回滚应用镜像；数据库迁移必须采用向前兼容策略，避免依赖破坏性降级。

## 9. 分阶段实施路线

### 阶段 0：冻结基线与保留证据（1–2 天）

- [ ] 建立整改分支和问题清单。
- [ ] 记录复杂度、测试、覆盖率和运行指标基线。
- [ ] 保存本次故障时间线、日志证据和根因。
- [x] 建立 `check_guardrails.py` 与 baseline。
- [x] CI 接入“不得新增超限”门禁。

验收：不改变生产行为，但任何新复杂度回退会被阻止。

### 阶段 1：先修可靠性底座（3–5 天）

- [x] 删除 Runtime 启动 DDL，补真实 PostgreSQL 锁回归测试。
- [x] 补齐 Connector `dispatch/expire` 合同及测试。
- [x] 修复 Connector 重启后的孤儿任务识别。
- [x] 修复 AI Runtime draining、强制退出和任务重新入队。
- [x] 增加 `live/ready/detail` 健康端点。
- [x] 发布脚本改为逐服务 readiness 验证。

验收：重复执行 20 次滚动重启，不出现登录卡死、永久运行任务或永久 pending 任务。

### 阶段 2：设备调度状态机（1–2 周）

- [ ] 拆分 `device_dispatch.py`（首批：状态、仓储、队列已完成；结果处理继续拆分）。
- [x] 引入明确状态枚举与合法转换表。
- [x] 增加 worker/connector `instance_id` 和任务 lease。
- [x] 引入模拟 Agent 合同测试。
- [ ] 完成超时、取消、重连、迟到回执测试矩阵（已覆盖超时、重连和迟到/重复回执；继续补取消集成路径）。

验收：所有设备调度状态转换均有单测和至少一条集成测试。

### 阶段 3：AI 推理核心拆分（2–4 周）

- [ ] 冻结 `_run_worker_impl` 新功能入口。
- [x] 先提取纯函数和 DTO，再提取外部调用适配器（已提取首批策略、Prompt DTO、工具解析与 Runtime client）。
- [ ] 将工具循环改为显式状态机。
- [ ] 分离模型请求、MCP 调用、设备调度和持久化。
- [ ] 每次拆分保持行为等价并执行回归测试。

验收：`core.py` 小于 800 行，编排函数小于 80 行，不存在超过 200 行的业务函数。

### 阶段 4：Socket、路由和共享层拆分（2–3 周）

- [x] 拆分 `socket_events.py`。
- [ ] 拆分 `admin.py` 和其它超长路由。
- [x] 清理 `main/api/` 导入副作用（首批 package/app factory 与 Agent Socket 所有权已清理）。
- [x] 建立架构依赖检查。
- [ ] 将兼容逻辑移入 Alembic 或明确适配层。

验收：进程职责依赖图通过自动检查；共享层不启动后台任务、不修改 schema。

### 阶段 5：完整 CI 与故障演练（1–2 周）

- [x] CI 启动真实 PostgreSQL 和四个 Runtime。
- [ ] 执行登录、AI、MCP、模拟设备 E2E。
- [ ] 注入进程终止、网络超时、数据库锁和设备断线。
- [ ] 建立发布前自动冒烟与发布后观测窗口。
- [x] 建立自动回滚脚本。

验收：关键故障可以在 CI 中稳定复现，恢复时间和数据一致性满足目标。

### 阶段 6：持续收紧（长期）

- [ ] 每个迭代至少消除一个超限文件或函数。
- [ ] 基线只能下降，不能随意上调。
- [ ] 每月复查慢请求、锁等待和任务超时 Top N。
- [ ] 删除过期兼容层、豁免和临时补丁。

## 10. 优先级清单

### P0：立即处理

- Runtime 启动无条件 DDL
- AI Runtime 发布时停止消费但旧容器长时间不退出
- Connector 缺少/不一致的 dispatch expire 合同
- Connector 重启后近期 pending 任务未立即回收
- 容器 Up 与应用 Ready 混为一谈

### P1：随后处理

- `_run_worker_impl` 和 `_execute_turn_call` 拆分
- `device_dispatch.py` 状态机拆分
- `register_agent_socket_events` 拆分
- 设备真实在线与数据库 presence 快照语义分离
- PostgreSQL 长事务和锁监控

### P2：持续治理

- 超长路由和知识服务拆分
- Prompt 组装模块化
- MCP 注册表声明化
- 文档、错误码和运维手册统一

## 11. 每个整改 PR 的要求

每个 PR 只处理一个明确边界，并包含：

1. 问题和不变量说明。
2. 修复前可复现的测试。
3. 结构调整后的职责说明。
4. 单元测试与相关集成测试结果。
5. 数据库/协议兼容性说明。
6. 部署步骤、观察指标和回滚方式。
7. 复杂度基线变化。

禁止在同一个 PR 中同时进行大规模重命名、格式化和行为修改。

## 12. 完成定义（Definition of Done）

全面整改完成需要同时满足：

- [ ] 生产文件无新增超过 500 行。
- [ ] 业务函数无新增超过 80 行或复杂度超过 15。
- [ ] 关键超长核心已拆分并具有清晰职责。
- [ ] Runtime 启动不执行隐式 DDL。
- [ ] 所有任务状态机具备合法转换与终态保证。
- [ ] 四进程具备标准 readiness 和 draining。
- [ ] 滚动发布可自动验证并在失败时停止/回滚。
- [ ] PostgreSQL 锁、长事务、队列年龄可观测。
- [ ] 真实 PostgreSQL 集成测试进入 CI。
- [ ] 模拟设备 E2E 覆盖成功、失败、超时、断线和重连。
- [ ] 关键模块增量覆盖率不低于 85%，状态机分支覆盖率不低于 90%。
- [ ] 连续故障演练不产生永久 `running`/`pending` 数据。
- [ ] 运维文档与实际部署脚本保持一致。

## 13. 建议的第一批任务

建议从以下五个小而闭环的任务开始，而不是立即拆 `core.py`：

1. 建立复杂度基线脚本与 CI 门禁。
2. 为数据库启动无 DDL 补 PostgreSQL 集成测试。
3. 为 AI Runtime draining/requeue 补状态测试并修复发布脚本。
4. 为 Connector orphan/expire/queue-resume 补完整测试。
5. 建立 Socket.IO 模拟 Agent，并跑通一次端到端 MCP。

完成这五项后，再进入大文件拆分。此时每次重构都有自动化安全网，避免“为了降低复杂度而制造新的线上问题”。

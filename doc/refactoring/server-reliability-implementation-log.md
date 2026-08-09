# Server 可靠性整改实施记录

## 2026-08-09 基线

- 计划来源：`doc/server-reliability-complexity-refactoring-plan.md`
- Git 分支：`codex/server-reliability-completion`（根仓库与 Server 子模块）
- Python 复杂度债务：从 284 项降至 243 项，并已收紧机器基线
- 架构依赖债务：从 47 项降至 43 项，并已收紧机器基线
- pytest：389 个 unit/contract 测试通过，5 个 PostgreSQL integration 用例由 CI 执行
- 本机限制：无 Docker/PostgreSQL 服务，因此真实 PostgreSQL 与四进程演练交由新增 CI 作业执行
- 既有失败证据：初始无测试环境时 45 个模块因 `DATABASE_URL` 缺失而收集失败；显式测试环境后 207 通过、15 个未隔离数据库的测试失败

## 已确认根因

1. Runtime 曾保留自动 Alembic 启动开关；即使 Compose 关闭，默认值仍允许其它启动方式执行 DDL。
2. `ChatRun` 与 `AgentDispatchTask` 没有 owner/lease，恢复只能依赖时间阈值。
3. Connector 的迟到结果允许覆盖 timeout，与调用方已经终止的事实冲突。
4. Compose 使用 `service_started`，容器启动不能代表数据库、注册表或队列已就绪。
5. Runtime package `__init__` 导入应用工厂，导致工具模块导入触发应用/注册表初始化和循环依赖。

## 首批不变量落地

- Runtime 启动入口只执行只读 schema guard，`HEYSURE_DB_AUTO_MIGRATE=1` 会快速失败。
- PostgreSQL 连接统一设置 connect/lock/statement/idle-transaction 超时。
- AI worker 领取任务时写入 instance owner 与 lease；心跳续租，过期后重新排队。
- Connector 任务具有 owner、lease、deadline、attempt 和合法转换表。
- 前一 Connector 实例的活动任务启动时立即终结，不再等待 300 秒。
- timeout/cancelled/completed/error 都是不可被迟到回执覆盖的终态。
- 四个 Runtime 暴露 `live`、`ready`、`detail`，并保留旧 `/internal/health` 兼容路由。
- Runtime schema guard 会精确比较数据库 Alembic revision 与代码 head，落后或未版本化时快速失败。
- Gateway 只注册用户侧 Socket；Agent Socket 装配与 handler 已全部归 Connector Runtime。
- MCP 内置工具改为声明式 catalog；运行上下文改为共享 `ContextVar`，工具不再依赖 Connector 内存。

## 已实施的自动化验证

- `other/scripts/verify_server.py`：复杂度、架构、语法、单测和可选集成测试统一入口。
- `other/tests/integration/test_postgres_runtime_lifecycle.py`：启动无 DDL、长读事务、禁用自动迁移、异常回滚。
- `other/tests/unit/test_dispatch_state_machine.py`：合法转换、旧 owner 回收、迟到结果、队列晋升和超时释放。
- `other/tests/unit/test_ai_run_leases.py`：显式 lease 优先于 heartbeat 猜测。
- `other/tests/contract/`：健康端点、Socket payload、模拟 Agent 成功/错误/静默/重复回执。
- `.github/workflows/server-quality.yml`：单测、真实 PostgreSQL，以及四 Runtime + 模拟 Agent 往返冒烟。
- CI 对模型错误恢复、工具批处理、单调用状态机、模型单轮状态流、模型轮次后置流、工具批次编排、worker 外层状态机和设备 dispatch 合法转换表执行分支覆盖硬门禁；本机同命令实测 97.43%，低于 90% 将失败，`WorkerRunMachine` 分支覆盖率为 100%。
- `other/scripts/rolling_release.py`：迁移先行、逐服务 readiness、失败时恢复旧镜像。
- `other/scripts/smoke_four_runtime.py`：注册/登录、跨进程设备绑定、Connector 分发、结果终态轮询，以及成功、断线、静默超时、显式过期、重连和恢复成功故障矩阵。
- `other/scripts/restart_fault_exercise.py`：默认 20 轮逐 Runtime 重启、readiness、模拟 Agent 冒烟和过期任务断言。
- 重启演练显式接受已存在的测试账号，适配生产环境关闭注册的策略；失败路径会替换底层命令异常，避免内部 bearer token 被回显。
- `other/scripts/reliability_top_n.py`：脱敏输出慢模型轮次、长事务、锁等待、ChatRun 队列和设备 dispatch 队列 Top N，不输出消息正文或原始 SQL。
- PostgreSQL 集成测试使用两条真实连接竞争 advisory lock，验证连接策略将数据库锁等待限制在 500 ms 左右。
- 所有 HTTP Runtime 回传 `X-Request-ID`；日志默认携带 `service_role`、`instance_id`，AI/MCP/Connector 链路附加 run/task/tool/stage/elapsed 字段。

## 复杂度拆分进度

- `socket_events.py` 的 Agent 注册巨型闭包已拆为 registration/tasks/disconnect/remote/assembly handler。
- `device_dispatch.py` 已提取状态枚举、合法转换、owner/lease 仓储、队列晋升和结果 payload 持久化；有效行数 1106 → 808。
- `registry.py` 已提取声明式 `builtin_catalog.py`，`_register_builtin_tools` 降为简单循环。
- `core.py` 已提取通信 Prompt、调试支持、推理预算策略、工具名解析、跨 Runtime 客户端、worker 启动/生命周期、模型网关/错误恢复、模型单轮编排与返回持久化、轮次后压缩/计划闸门/最终响应编排、工具批次编排、最终响应收尾状态机、工具批处理/无进展状态机、单调用状态机、历史消息构建器、计划自动收尾服务、计划控制转换、上下文压缩流、每轮输入/工具面准备、工具执行/拒绝/元数据处理、截图媒体策略、工具结果持久化服务、worker 能力装配和外层运行状态机；有效行数 2933 → 60，`_run_worker_impl` 1626 → 8，复杂度 45 → 3，嵌套深度 5 → 2，直接依赖 20 → 8。
- 外层初始化、运行上下文、计划加载/重锚/收尾、模型轮次、后置流、工具批次、状态回写和最大步数收尾已迁入显式 `WorkerRunMachine` / `WorkerRunState` / `WorkerRunStepAction`；新增 13 个单元测试，模块分支覆盖率 100%。
- `_run_worker_impl` 已改为单一不可变 `WorkerRequest` DTO 入口，工具白名单冻结为快照，启动状态/可观察元数据/预取消处理移出编排函数，消除其 11 参数超限。
- 历史回放构建器独立处理压缩消息、待注入消息、系统提示回放及原生 MCP tool-call/result 配对，新增 3 个单元测试。
- 计划流服务独立处理阶段重锚、结果摘要、成功/失败日志、知识审核、循环任务续期及完成通知，移除 119 行嵌套闭包并新增 3 个单元测试。
- 工具批次控制流使用 `TurnCallAction` 显式枚举；未执行调用闭合、截图延迟刷新和重复拒绝计数已移出主函数。普通调用与拼接兼容调用共用不可变 `ToolExecutionResult`；拼接兼容批次、普通原生/文本结果、MCP 禁用/越权拒绝、会话重命名与 describe 元数据均由独立服务处理。原 198 行 `_execute_turn_call` 闭包已由 `TurnCallMachine`、`TurnCallContext` 和不可变 `TurnCallState` 取代，状态不再依赖 `nonlocal` 隐式回写；新增 7 个停止、拒绝、拼接、持久化与控制转换测试，单模块分支覆盖 98%。
- 截图 payload 解析、图片输入降级、历史截图裁剪、模型可见结果和服务器文件 data URL 编码已迁入 `tool_media.py`；递归查找不再成为新复杂度豁免，并新增服务器路径截图回归测试，修复原路径分支缺少 `os` 导入的隐患。
- 工具调用统计、端侧设备身份归属、聊天气泡、截图媒体落库和机器人投递已迁入 `tool_persistence.py`；调用方改用 `ToolCallRecord` / `ToolBubbleRequest` DTO，消除 15 参数入口，并以完成回执中的精确设备 ID 为唯一归属依据。
- 会重写上下文的 `conversation.manage(clear)` 与 `todo.manage(create/edit/delete)` 已迁入 `plan_transitions.py`；`PlanTransitionContext`、`PlanFlowSnapshot` 和 `ControlToolCall` 明确承载输入/状态，转换返回显式 action 与新快照，新增 4 个清空、创建、删除和末阶段自动收尾测试。
- MCP 禁用/越权路径迁入 `tool_rejections.py`，使用 `RejectionOutcome` 返回签名、连续次数与 action；普通/拼接工具回传分别由 `tool_resolution.py` 与 `tool_persistence.py` 处理，会话重命名和 describe 记忆由 `tool_metadata.py` 处理。
- 手动 `conversation.manage(compress)` 与数字成员阈值自动压缩已统一迁入 `compression_flow.py`；`CompressionState/Decision` 显式返回重建后的会话、阶段锚点、继续下一轮和本轮禁用重试状态，新增 5 个转换测试。
- AI 间收件箱、用户中途插入和渐进式工具暴露已迁入 `step_preparation.py`；文本协议、任务计划前知识工具面、待回复 ID 保留及收件箱异常均有独立测试，旧测试不再通过 `core.py` 私有别名验证通信 Prompt。
- Anthropic/OpenAI 请求构造、OpenAI `parallel_tool_calls` 兼容回退和结构化上游 HTTP 错误已迁入 `model_gateway.py`；异常重试与 run 终态仍由编排层负责，新增 4 个网关契约测试。
- 缺失 tool 响应修复、图片输入不兼容降级、上游错误通知与连续三次错误终止已迁入 `model_error_flow.py`；修复函数拆分后退出复杂度超限表，新增 4 个错误决策测试。
- 工具调用名归一化、assistant 消息 token/延迟持久化及原生 `tool_calls` 对话项构造已迁入 `turn_result.py`；兼容保留 `core._resolve_mcp_tool_name`，新增原生与文本协议 2 个契约测试。
- 无工具最终响应的格式纠错、最后一批用户插入、AI 间自动回复、计划自然停止和简单/循环任务完成已迁入 `final_response_flow.py`，由显式 `NEXT_TURN` / `COMPLETE_RUN` 决策驱动；新增 4 个收尾状态测试。
- 跨步重复批次的第二次纠偏/第三次终止及单轮精确重复调用合并已迁入 `tool_batch_flow.py`；保留 `core._duplicate_call_flags` 兼容别名，新增 4 个批处理状态测试。
- 用户/模型/Prompt/任务/历史记录启动装配已迁入 `worker_setup.py` 的不可变快照；heartbeat、QQ 流式会话和孤儿插入恢复已迁入 `worker_lifecycle.py`，新增 4 个启动与清理契约测试。`core.py` 已达到阶段性文件规模 `< 800`。
- Provider 判定、Preset 协议覆盖、匿名上游会话头、MCP 开关、已描述工具版本恢复和任务必需工具预暴露已统一迁入 `worker_setup.prepare_capabilities`；新增 3 个能力装配测试并保留恢复失败日志。`core.py` 复杂度 79 → 66、直接依赖 24 → 21，机器基线同步收紧。
- 步边界消息摄取、图片输入预降级、工具面选择、模型调用、上游错误决策、成功响应持久化和 live 状态清理已统一迁入 `worker_turn_flow.run_worker_turn`；`WorkerTurnAction/State/Policy/Outcome` 显式承载重试、停止和继续状态，新增 5 个成功、重试、终止、流取消和图片降级测试，模块分支覆盖 99%。
- 模型轮次后的手动/自动压缩、任务状态刷新、计划工具闸门和最终响应动作映射已统一迁入 `worker_post_turn_flow.handle_post_turn`；`PostTurnAction/State/Outcome` 显式返回执行工具、进入下一轮或完成运行，新增 7 个压缩、闸门和收尾转换测试，模块分支覆盖 98%。
- 重复批次检测、单调用状态机装配、批次执行、状态回写和截图屏障已统一迁入 `worker_tool_batch_flow.handle_tool_batch`；停止或下一轮由显式 action 返回，新增 5 个继续、终止、屏障与回写测试，模块分支覆盖 100%。
- 工作流取消现会在同一事务内把关联 `AgentDispatchTask` 置为 `cancelled`，四进程模式通过 Connector 内部接口发送 `task:cancel`，同时释放 Future waiter、内存上下文和设备串行队列；迟到结果受终态保护不能复活任务。超时/取消/重连/迟到与重复回执矩阵已闭合，新增 2 个集成契约测试。
- 设备 progress/result/error 已迁入 `dispatch_results.py`，上下文恢复、截图/Cookie 持久化、workflow hook、waiter 释放和用户广播均形成独立步骤；Workshop 内联执行迁入 `workshop_dispatch.py`。`device_dispatch.py` 782 → 486 并退出文件超限表，新增成功/重复/失败 3 个结果状态测试。
- `admin.py` 已将 Runtime/ChatRun、用户、文件、数据库浏览器和审计五个路由域迁入独立模块；有效行数 1349 → 493，达到文件 < 500 目标并消除直接依赖超限，新增 18 个客户端、路由、沙箱与数据转换契约测试。

## 2026-08-10 部署环境验收

- 本批实施前已验收基线为根仓库 `bfaf0cc`、Server 子模块 `370ad24`；宿主检出、管理员版本端点与四 Runtime 状态均已核验。
- 每次发布前均生成 PostgreSQL custom-format 备份；本批实施前最近一次为 `backups/heysure-pre-sync-20260810-031354.dump`（102756493 bytes），最终发布的新备份路径记录在发布验收结果中。
- Alembic revision 为 `e8f9a0b1c2d3`；API Gateway、MCP Runtime、Connector Runtime、AI Runtime readiness 均返回 200。
- Web `:58150`、API `:3000` 均返回 200，测试账号登录契约返回 access token 与 Agent Socket URL。
- `rolling_release.py` 完成迁移先行、镜像构建和四个 Runtime 的逐服务就绪门禁，未触发回滚。
- 线上关闭注册时，冒烟脚本使用统一测试账号 `heysure` 完成登录、跨进程设备绑定、模拟 Agent 分发和完成终态轮询；过期 `running/pending/queued` 任务断言为 0。
- 真实 AI + MCP 链路以临时会话完成模型推理、`mcp.describe` 和工具调用，产生 4 条消息、2 个 MCP 气泡并返回约定成功标识；验收后临时会话已清理。
- 第二次发布后观察到服务器上的并发自动部署短暂重新创建容器；公开端点恢复后，通过 `/api/admin/services` 确认四个 Runtime 均为 `running`。

## 故障时间线与根因证据

- 初始测试收集在未提供 `DATABASE_URL` 时有 45 个模块快速失败，证实共享导入路径错误依赖运行数据库；显式测试环境后又暴露 15 个未隔离数据库的测试，随后由测试环境工厂和依赖边界修复。
- 首轮线上发布曾与服务器已有自动部署重叠，容器被短暂重新创建；根因是两个发布所有者并发操作同一 Compose 项目。发布手册现要求单一发布所有者、发布锁和逐服务 readiness 门禁。
- 服务器无法直接访问 GitHub 时没有将网络失败误判为应用失败；发布改用可校验 Git bundle，同步前同时校验旧提交、SHA-256 和 fast-forward 关系。
- MCP、Connector 和 AI Runtime 未映射宿主端口，早期宿主端口探测因此不成立；后续验收统一在 Compose 网络内检查真实 readiness。
- 数据库锁等待此前只能从超时症状推断；当前通过真实 PostgreSQL advisory-lock 竞争用例固定重现，并由连接级 `lock_timeout` 给出有界失败。

## 收尾状态与持续治理

- `_execute_turn_call`、模型单轮、轮次后流、工具批次及 `_run_worker_impl` 外层循环均已迁入显式状态机；关键编排入口达到 80 行以内目标。
- `admin.py` 与 `device_dispatch.py` 已达到文件规模目标；遗留数据库接管只存在于 `_legacy_adopt` 明确适配边界，删除条件与 Alembic 唯一权威规则见 `doc/db-migrations.md`。
- 复杂度基线保持“只能下降”；余下历史债务属于长期持续治理，不再阻塞本计划完成。慢请求、锁等待和任务超时按 `doc/server-reliability-operations.md` 每月复查 Top N。

# Server 可靠性整改实施记录

## 2026-08-09 基线

- 计划来源：`doc/server-reliability-complexity-refactoring-plan.md`
- Git 分支：当前工作分支（未自动创建或切换，避免干扰用户工作区）
- Python 复杂度债务：从 284 项降至 257 项，并已收紧机器基线
- 架构依赖债务：从 47 项降至 43 项，并已收紧机器基线
- pytest：316 个 unit/contract 测试通过，4 个 PostgreSQL integration 用例由 CI 执行
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
- `other/scripts/rolling_release.py`：迁移先行、逐服务 readiness、失败时恢复旧镜像。
- `other/scripts/smoke_four_runtime.py`：注册/登录、跨进程设备绑定、Connector 分发、结果终态轮询。
- `other/scripts/restart_fault_exercise.py`：默认 20 轮逐 Runtime 重启、readiness、模拟 Agent 冒烟和过期任务断言。
- 所有 HTTP Runtime 回传 `X-Request-ID`；日志默认携带 `service_role`、`instance_id`，AI/MCP/Connector 链路附加 run/task/tool/stage/elapsed 字段。

## 复杂度拆分进度

- `socket_events.py` 的 Agent 注册巨型闭包已拆为 registration/tasks/disconnect/remote/assembly handler。
- `device_dispatch.py` 已提取状态枚举、合法转换、owner/lease 仓储、队列晋升和结果 payload 持久化；有效行数 1106 → 808。
- `registry.py` 已提取声明式 `builtin_catalog.py`，`_register_builtin_tools` 降为简单循环。
- `core.py` 已提取通信 Prompt、调试支持、推理预算策略、工具名解析、跨 Runtime 客户端、历史消息构建器、计划自动收尾服务、计划控制转换、上下文压缩流、每轮输入/工具面准备、工具执行/拒绝/元数据处理、截图媒体策略和工具结果持久化服务；有效行数 2933 → 1299，`_run_worker_impl` 1626 → 942。
- `_run_worker_impl` 已改为单一不可变 `WorkerRequest` DTO 入口，工具白名单冻结为快照，启动状态/可观察元数据/预取消处理移出编排函数，消除其 11 参数超限。
- 历史回放构建器独立处理压缩消息、待注入消息、系统提示回放及原生 MCP tool-call/result 配对，新增 3 个单元测试。
- 计划流服务独立处理阶段重锚、结果摘要、成功/失败日志、知识审核、循环任务续期及完成通知，移除 119 行嵌套闭包并新增 3 个单元测试。
- 工具批次控制流使用 `TurnCallAction` 显式枚举；未执行调用闭合、截图延迟刷新和重复拒绝计数已移出 `_execute_turn_call`。普通调用与拼接兼容调用共用不可变 `ToolExecutionResult`；拼接兼容批次、普通原生/文本结果、MCP 禁用/越权拒绝、会话重命名与 describe 元数据均已移出闭包。函数 539 → 198 行，复杂度 98 → 15（已退出复杂度超限表），相关状态、路由与执行契约新增 26 个测试。
- 截图 payload 解析、图片输入降级、历史截图裁剪、模型可见结果和服务器文件 data URL 编码已迁入 `tool_media.py`；递归查找不再成为新复杂度豁免，并新增服务器路径截图回归测试，修复原路径分支缺少 `os` 导入的隐患。
- 工具调用统计、端侧设备身份归属、聊天气泡、截图媒体落库和机器人投递已迁入 `tool_persistence.py`；调用方改用 `ToolCallRecord` / `ToolBubbleRequest` DTO，消除 15 参数入口，并以完成回执中的精确设备 ID 为唯一归属依据。
- 会重写上下文的 `conversation.manage(clear)` 与 `todo.manage(create/edit/delete)` 已迁入 `plan_transitions.py`；`PlanTransitionContext`、`PlanFlowSnapshot` 和 `ControlToolCall` 明确承载输入/状态，转换返回显式 action 与新快照，新增 4 个清空、创建、删除和末阶段自动收尾测试。
- MCP 禁用/越权路径迁入 `tool_rejections.py`，使用 `RejectionOutcome` 返回签名、连续次数与 action；普通/拼接工具回传分别由 `tool_resolution.py` 与 `tool_persistence.py` 处理，会话重命名和 describe 记忆由 `tool_metadata.py` 处理。
- 手动 `conversation.manage(compress)` 与数字成员阈值自动压缩已统一迁入 `compression_flow.py`；`CompressionState/Decision` 显式返回重建后的会话、阶段锚点、继续下一轮和本轮禁用重试状态，新增 5 个转换测试。
- AI 间收件箱、用户中途插入和渐进式工具暴露已迁入 `step_preparation.py`；文本协议、任务计划前知识工具面、待回复 ID 保留及收件箱异常均有独立测试，旧测试不再通过 `core.py` 私有别名验证通信 Prompt。
- `admin.py` 已将 Runtime/ChatRun、用户、文件、数据库浏览器和审计五个路由域迁入独立模块；有效行数 1349 → 493，达到文件 < 500 目标并消除直接依赖超限，新增 18 个客户端、路由、沙箱与数据转换契约测试。

## 2026-08-09 部署环境验收

- 根仓库已自动更新到 `e527620`，Server 子模块对应 `2fb1db7`；管理员版本端点与四 Runtime 状态均已核验。
- 两次发布前分别生成 PostgreSQL custom-format 备份 `backups/heysure-pre-release-20260809-233539.dump`（102751393 bytes）和 `backups/heysure-pre-release-20260809-234241.dump`（102751428 bytes）。
- Alembic revision 为 `e8f9a0b1c2d3`；API Gateway、MCP Runtime、Connector Runtime、AI Runtime readiness 均返回 200。
- Web `:58150`、API `:3000` 均返回 200，测试账号登录契约返回 access token 与 Agent Socket URL。
- `rolling_release.py` 完成迁移先行、镜像构建和四个 Runtime 的逐服务就绪门禁，未触发回滚。
- 第二次发布后观察到服务器上的并发自动部署短暂重新创建容器；公开端点恢复后，通过 `/api/admin/services` 确认四个 Runtime 均为 `running`。

## 仍在后续批次中的工作

- `_run_worker_impl` / `_execute_turn_call` 仍需转换为上下文 DTO + 显式工具状态机，目标尚未达到。
- `admin.py` 已达到文件规模目标，但其中数据库导入/清理函数仍需继续服务化；历史迁移适配层和其它超长模块尚未完成领域拆分。
- 本机没有 Docker/PostgreSQL；真实迁移、四进程 readiness 和登录链路已在部署环境验收，完整模拟 Agent 往返及连续 20 次重启仍由 CI/后续演练执行，本记录不虚报未运行项目。

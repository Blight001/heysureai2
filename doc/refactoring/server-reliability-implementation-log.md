# Server 可靠性整改实施记录

## 2026-08-09 基线

- 计划来源：`doc/server-reliability-complexity-refactoring-plan.md`
- Git 分支：当前工作分支（未自动创建或切换，避免干扰用户工作区）
- Python 复杂度债务：从 284 项降至 267 项，并已收紧机器基线
- 架构依赖债务：从 47 项降至 43 项，并已收紧机器基线
- pytest：251 个 unit/contract 测试通过，4 个 PostgreSQL integration 用例由 CI 执行
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
- `core.py` 已提取通信 Prompt、调试支持、推理预算策略、工具名解析、跨 Runtime 客户端、历史消息构建器和计划自动收尾服务；有效行数 2933 → 2450，`_run_worker_impl` 1626 → 1477。
- 历史回放构建器独立处理压缩消息、待注入消息、系统提示回放及原生 MCP tool-call/result 配对，新增 3 个单元测试。
- 计划流服务独立处理阶段重锚、结果摘要、成功/失败日志、知识审核、循环任务续期及完成通知，移除 119 行嵌套闭包并新增 3 个单元测试。

## 2026-08-09 部署环境验收

- 根仓库已快进到 `5126439`，Server 子模块已更新到 `2092bc7`，线上 tracked working tree 保持干净。
- 两次发布前分别生成 PostgreSQL custom-format 备份 `backups/heysure-pre-release-20260809-233539.dump`（102751393 bytes）和 `backups/heysure-pre-release-20260809-234241.dump`（102751428 bytes）。
- Alembic revision 为 `e8f9a0b1c2d3`；API Gateway、MCP Runtime、Connector Runtime、AI Runtime readiness 均返回 200。
- Web `:58150`、API `:3000` 均返回 200，测试账号登录契约返回 access token 与 Agent Socket URL。
- `rolling_release.py` 完成迁移先行、镜像构建和四个 Runtime 的逐服务就绪门禁，未触发回滚。
- 第二次发布后观察到服务器上的并发自动部署短暂重新创建容器；公开端点恢复后，通过 `/api/admin/services` 确认四个 Runtime 均为 `running`。

## 仍在后续批次中的工作

- `_run_worker_impl` / `_execute_turn_call` 仍需转换为上下文 DTO + 显式工具状态机，目标尚未达到。
- `admin.py`、历史迁移适配层和其它超长模块尚未完成领域拆分。
- 本机没有 Docker/PostgreSQL；真实迁移、四进程 readiness 和登录链路已在部署环境验收，完整模拟 Agent 往返及连续 20 次重启仍由 CI/后续演练执行，本记录不虚报未运行项目。

# HeySure AI 2.0 代码整顿与渐进式重构方案

## 1. 目标与边界

本方案的目标不是重写项目，而是在保持现有 REST、MCP、Socket、设备端协议和数据库兼容的前提下，逐步降低隐式依赖、重复状态和超大模块带来的维护风险。

整顿遵循以下原则：

1. 先建立行为契约，再移动代码；每次只改变一个边界。
2. 运行时行为优先于静态推测；所有关键阶段都要有可回归测试。
3. 不在一次提交中同时修改数据库、协议、前端状态和 Runtime 生命周期。
4. 保留兼容适配层，确认调用方迁移完成后再删除旧入口。
5. 每一阶段都能独立回滚，提交信息明确说明边界和行为。

## 2. 当前基线

当前项目已经具备比较好的工程基础：四 Runtime、共享 API 层、Alembic、前后端验证脚本、架构检查和发布门禁均已存在。但这些机制主要阻止债务继续增加，不能代表历史债务已经清零。

当前可观测债务：

- Server 复杂度门禁保留约 199 条历史豁免。
- Server 架构检查仍有 41 条跨 Runtime 依赖基线。
- Server 中存在 `migrations.py`、`run_service.py`、`chat_prompt_utils.py`、`chat_action_routes.py` 等超大模块。
- Web 中 `useDashboardData`、`useTaskManagement`、`useDashboardSystemSettings` 和聊天工作区组件同时承担请求、缓存、页面状态和流程编排。
- Gateway 的周期任务曾把任务调度、心跳回收、临时文件清理和仓库更新放在同一个循环中；自动更新卡死已经证明这种耦合存在实际风险。

## 3. 目标架构

```text
Gateway Routes
    ↓ DTO / Auth
Application Services
    ↓ domain ports
Runtime Adapters / MCP / Connector / AI Worker
    ↓
Persistence, Socket, HTTP, Filesystem
```

目标边界：

- `gateway/routers/` 只负责 HTTP 参数、鉴权、响应映射。
- `api/services/` 负责业务用例，不直接依赖具体 Runtime 进程。
- `api/ports/` 定义跨进程能力，例如 AI dispatch、MCP execute、设备通知。
- `*_runtime/` 通过适配器实现端口，跨进程调用统一走内部 HTTP、队列或事件。
- 工作区路径、权限和文件发现只有一个权威服务。
- ChatRun、任务、MCP 调用和更新发布都以显式状态机表达。
- 前端 composable 管理一个领域状态，组件只做视图组合。

## 4. 分阶段实施

### 阶段 0：盘点与契约冻结

**内容**

- 生成后端 Runtime、路由、服务、模型和数据库的依赖清单。
- 记录 ChatRun、任务、MCP、工作区、设备连接和发布更新的状态转换。
- 为工作区隔离、MCP 权限、ChatRun 终态和自动更新增加行为测试。
- 建立本方案作为重构验收基线。

**退出条件**

- `verify_server.py`、`npm run verify` 可重复通过。
- 关键接口的请求/响应和错误码有测试覆盖。
- 未识别的跨边界调用已登记，不再凭感觉移动代码。

### 阶段 1：Runtime 生命周期整顿

**内容**

- 将 Gateway 的周期任务从 `lifespan()` 内联逻辑提取为可测试的任务协调器。
- 调度、心跳、临时文件清理、仓库状态同步和自动更新分别拥有独立错误边界。
- 所有后台工作增加超时、失败日志和终态同步。
- 将启动期 schema guard 改为语义明确的只读接口名，保留旧别名一段时间。

**退出条件**

- 任意一个周期任务失败不会停止其他周期任务。
- 自动更新在宿主异步重建完成后能自动恢复 `running` 状态。
- Gateway、MCP、Connector、AI 四进程 smoke 测试通过。

### 阶段 2：工作区与 MCP 边界统一

**内容**

- 建立唯一 `WorkspaceScope`：解析用户/AI 成员根目录、路径安全、相对路径和目录列表。
- REST、MCP、设备工具和附件解析全部调用同一套工作区服务。
- 统一 MCP 工具注册、别名、分类、绑定权限和调用统计入口。
- 将 `mcp.program` 作为工作流编排器处理，嵌套工具调用重新走统一授权和超时。

**退出条件**

- 普通成员、数字社会管理员、未知 AI ID、路径穿越和软链接场景均有测试。
- REST 文件列表和 MCP `workspace.list+files` 的结果一致。
- 工具箱/图书馆默认勾选和绑定门禁不再由多个模块分别决定。

### 阶段 3：ChatRun 与任务系统整顿

**内容**

- 将路由中的 ChatRun 读写和运行控制移到 application service。
- 为 `queued → running → completed/error/stopped` 建立显式状态转移函数。
- 将任务调度、监督续跑、优先级抢占和 AI worker 派发拆开。
- 统一 Socket 事件、数据库状态和内存 live 状态的更新顺序。

**退出条件**

- 重启、超时、取消、重复派发和租约过期都有真实测试。
- 不会恢复终态任务，不会产生重复 ChatRun。
- `restart_fault_exercise.py` 和 `smoke_four_runtime.py` 通过。

### 阶段 4：提示词、知识库和 MCP 目录拆分

**内容**

- 拆分 `chat_prompt_utils.py`：目录渲染、MCP 说明、错误提示、运行时注入分别独立。
- 拆分 `kb_store.py` 与 `librarian_builtins.py` 的文件存储、检索、内置条目和渲染逻辑。
- 保留旧函数作为薄适配器，避免一次性改变 prompt 文本和 token 预算。

**退出条件**

- Prompt snapshot、MCP catalog 和 token 统计回归通过。
- 同一输入生成的系统提示词在兼容模式下保持一致。

### 阶段 5：前端状态与组件整顿

**内容**

- 将 Dashboard 数据、任务、系统设置和工作区文件分别拆成领域 composable。
- 移除全局 `allFiles` 与按 AI 工作区缓存的双来源兼容逻辑。
- 将 Chat 组件拆成“视图组件 + 流程 composable + API DTO”。
- 统一 loading、error、refresh 和取消语义。

**退出条件**

- `npm run verify`、关键页面渲染测试和聊天端到端测试通过。
- 组件不再直接拼接 API 请求或持有跨领域缓存。

### 阶段 6：清理兼容层与降低基线

**内容**

- 逐项删除旧别名、旧 DB 字段读取和已迁移的 fallback。
- 每降低一组门禁债务，更新基线并保留变更记录。
- 清理不再使用的迁移辅助函数、旧文档和死代码。

**退出条件**

- 复杂度、架构违规和超大文件数量持续下降。
- 不再新增 baseline 豁免。
- 发布、回滚和故障演练全部通过。

## 5. 测试矩阵

### 每个提交

- Python 语法和类型边界检查
- Server guardrails / architecture
- 受影响的 unit/contract tests
- Web guardrails / Vitest / vue-tsc

### 每个阶段结束

- `python other/scripts/verify_server.py`
- `npm run verify`（在 `deploy/web`）
- 真实 PostgreSQL integration（涉及 DB 时）
- `smoke_four_runtime.py`
- `restart_fault_exercise.py`（涉及生命周期、锁、租约时）

### 发布前

- Compose working directory、镜像标签和持久化挂载检查
- Alembic head 检查
- API/Web HTTP 200
- 登录、自检、旧任务清理和运行时 readiness
- 失败时保留证据并停止，不以中间服务成功代替最终验收

## 6. 风险与回滚

- 每个阶段保持独立提交，不进行混合重构。
- 先迁移调用方，再删除旧实现。
- 状态机和文件协议变更必须保留兼容读取路径。
- 数据库只通过 Alembic 变更，Runtime 不做 DDL。
- 生产发布前必须创建 PostgreSQL custom-format 备份。
- 任一 readiness、挂载、迁移或 smoke 门禁失败，立即停止并回滚到上一个阶段提交。

## 7. 当前执行记录

- 阶段 0：已完成基线盘点、工作区/MCP/自动更新行为测试和本方案文档。
- 阶段 1：本次提取 Gateway 周期任务协调器，并增加远端更新终态同步隔离。
- 阶段 2：本次统一 `WorkspaceScope` 根目录/路径安全入口和 AI 工作区文件列表缓存；后续继续收敛设备工具的路径服务。
- 阶段 3：已落地 ChatRun 状态机和控制服务切片：集中定义 `queued/running/completed/error/stopped`、显式允许边和终态幂等保护；worker、watchdog、停止/恢复入口和 stale-run 回收已接入。任务调度、监督续跑和派发拆分继续保持独立提交。
- 阶段 4～6：保留为后续独立提交，不与本次行为修复混合。

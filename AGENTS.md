# AGENTS.md — HeySure AI 2.0 项目导航

> 供 Codex / 通用 coding agent 在每次会话开始时快速理解项目，**不要删除**。
> 面向"哪里改什么"的导航地图，背景与理念见 [`README.md`](README.md)。
> 同内容的 Claude 版见 [`CLAUDE.md`](CLAUDE.md)。

## 一句话定位

HeySure AI 2.0 是一个**多端 AI agent 协作平台**：Web 控制台 + Python 后端（拆成 4 个进程）+ 跨平台端侧执行器（Windows Tauri 桌面 / Linux 服务器 Agent / Chrome 扩展 / Android）。AI 成员可被创建、治理、调用工具、记录知识。

## 测试环境（供 Agent 联调）

已部署的测试服务器，可直接 curl 验证行为：

- Web 控制台：`http://49.234.181.190:58150/`
- API 网关（可直连）：`http://49.234.181.190:3000/`
- 测试账号：`heysure` / `heysure`（以后所有测试统一用这个账号密码）
- 登录：`POST /api/auth/login`，body `{"account":"heysure","password":"heysure"}`，返回 `access_token` 与 `agent_socket_url`。

> 注意：经 :58150 登录时 `agent_socket_url` 会返回 `http://...:58150`（web 已正确反代 `/socket.io/` 含 WS 升级，可用）；经 :3000 直连登录返回 `http://...:3000`。

## 宝塔服务器 MCP 对接

当前 Codex 环境已配置宝塔 MCP 服务器，工具命名空间为 `mcp__baota__*`，可直接用于测试服务器的只读检查、项目文件操作和经确认的运维操作。

- 服务器：`49.234.181.190`（与上方测试环境为同一台服务器）。
- HeySure 线上工作区：`/www/wwwroot/heysureai2`。
- 已确认的顶层内容包括：`deploy/`、`device/`、`doc/`、`docker-compose.yml`、`docker-compose.source.yml`、`AGENTS.md`。
- 该项目当前未登记在宝塔“网站”列表中，应按 **Docker Compose 项目**处理；不要因为 `SiteList` 搜不到 `heysure` 就判断项目不存在。
- 定位文件优先使用宝塔 MCP 的 `LS`、`Glob`、`Grep`、`Read`；查看站点、服务和系统状态时优先使用对应的宝塔专用工具，必要时才使用 `Bash`。
- 默认先进行只读侦察，核对实际目录、Git 提交、容器和服务状态，再提出或执行变更；不得用本地工作区状态推测服务器当前状态。
- 禁止读取或回显服务器 `.env`、密码、Token、Cookie、私钥等敏感信息。确需核对配置时只检查变量是否存在或输出脱敏结果。
- 修改服务器文件前必须创建可恢复备份并记录位置，修改后执行语法、配置或服务有效性验证；发布、重启、删除、覆盖、迁移等高风险操作须先获得用户明确确认，并遵循本文“发布与运维”规则。
- 不得修改宝塔面板、宝塔核心服务或 `bt_agent_mcp` 插件及其数据目录。

> 以上路径和部署形态已于 2026-08-10 通过宝塔 MCP 只读确认；后续操作仍须先重新检查服务器现状。

## 顶层结构（多仓库）

本项目采用**多仓库 + git submodule**布局：

| 仓库            | 本地目录 | 技术栈 | 作用 | 详细文档 |
|-----------------|----------|--------|------|----------|
| HeySure-Web     | `deploy/web/`   | Vue 3 + Vite + TS | 前端控制台 | [`deploy/web/AGENTS.md`](deploy/web/AGENTS.md) / [`deploy/web/CLAUDE.md`](deploy/web/CLAUDE.md) |
| HeySure-Server  | `deploy/server/`| Python + FastAPI + Socket.IO | 后端（4 进程） | [`deploy/server/AGENTS.md`](deploy/server/AGENTS.md) / [`deploy/server/CLAUDE.md`](deploy/server/CLAUDE.md) |
| HeySure-Device  | `device/`| Tauri / Chrome MV3 / Kotlin / Python | 端侧执行器 | [`device/AGENTS.md`](device/AGENTS.md) / [`device/CLAUDE.md`](device/CLAUDE.md) |
| (workspace)     | `doc/`   | Markdown | 设计文档 / 角色 prompt | 保留在工作区根目录 |

服务器部署只初始化 Web 与后端（不会下载设备仓库）：

```bash
git clone <仓库地址>
git submodule update --init --recursive -- deploy/server deploy/web
```

需要端侧开发时再执行 `git submodule update --init --recursive -- device`。

子模块定义见根目录 [`.gitmodules`](.gitmodules)。

## 架构与端口

```
Web 控制台 (58150)
   │ REST + Socket.IO
   ▼
API Gateway (3000)  ── 对外唯一入口，挂载 deploy/server/main/gateway/routers/*
   │ 内部 HTTP (/internal/*, 需 HEYSURE_INTERNAL_TOKEN)
   ├──► AI Runtime        (3003)  聊天队列消费 / 模型推理
   ├──► MCP Runtime       (3001)  工具注册 / 权限校验 / 工具执行
   └──► Connector Runtime (3002)  QQ/飞书机器人 + 端侧 agent 调度
                                      │ Socket.IO
                                      ▼
              Windows Tauri / Linux Agent / 浏览器扩展 / Android
```

- 4 进程**共享** `deploy/server/main/api/`（模型、DB、认证、服务、配置）；各 `*_runtime/` 只负责把共享层接成一个进程。
- 进程角色通过 `HEYSURE_SERVICE_ROLE` 区分：`gateway | worker | mcp | connector`。
- 数据库仅支持 PostgreSQL，`DATABASE_URL` 为必填项。

## 常用命令

```bash
# 服务器初始化（不下载设备仓库）
git clone ...
git submodule update --init --recursive -- deploy/server deploy/web

# Docker（一键全栈）
docker compose up -d --build      # 或 docker-run.bat

# 本地分进程（Windows）
deploy\server\run.bat
deploy\web\run.bat
device\windows\run.bat

# 手动单进程
cd server
python -m gateway.main
...

# 健康检查
curl http://127.0.0.1:3000/
```

## 启动顺序依赖

```
PostgreSQL → Gateway (3000) → MCP Runtime (3001)
                            → Connector Runtime (3002)
                            → AI Runtime (3003)
```

Gateway 的 `lifespan` 会加载 MCP 插件、重置设备 presence、启动调度器，**必须最先起**。
Docker Compose 已通过 `depends_on` + `healthcheck` 自动处理顺序。

## "改 X 去哪里"速查

**注意**：代码分布在三个独立仓库中（submodule init 后布局与下表相同）。

| 需求 | 位置 |
| --- | --- |
| 新增 / 改 REST 接口 | `deploy/server/main/gateway/routers/<域>.py`（文件名即域） |
| 业务逻辑 / 数据访问 | `deploy/server/main/api/services/`（按域分子包：`knowledge/` `tasks/` `mcp/` `device_tools/` `chat/` `access/` `storage/`）与 `deploy/server/main/api/models/` |
| 新增 MCP 工具 | `deploy/server/tools/`（实现）→ `deploy/server/main/mcp_runtime/mcp/registry.py`（注册）→ `deploy/web/src/utils/mcpTools.ts`（前端展示） |
| 聊天 / 推理流程 | `deploy/server/main/api/chat_runtime/`（调度/流式/MCP 解析）+ `deploy/server/main/ai_runtime/`（worker + litellm） |
| 定时 / 循环任务 | `deploy/server/main/api/services/tasks/task_schedule.py`（唯一权威实现，REST/MCP/调度器共用） |
| QQ / 飞书机器人 | `deploy/server/main/connector_runtime/bots/` 与 `dispatch/` |
| 前端页面 / 组件 | `deploy/web/src/components/<域>/`（chat / dashboard / home / common） |
| 前端调后端 API 封装 | `deploy/web/src/api/<域>.ts`（http.ts 是统一客户端） |
| Windows 桌面本机执行 | `device/windows/src/`（TS）+ `device/windows/src-tauri/`（Rust） |
| Linux 服务器 Agent | `device/linux/agent/`（Python） |
| 浏览器自动化 | `device/browser_MCP/`（主扩展源码）/ `device/browser_MCP_win/`（Windows 原生输入构建） |
| 配置项 / 环境变量 | `deploy/server/main/api/core/settings.py`（**配置总入口**） |
| AI 角色 prompt | `doc/prompt/` |
| 知识工坊 Agent | `deploy/server/library/`（服务端内置虚拟 Agent） |

## 环境变量速查

| 变量名 | 是否必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | **必填** | `postgresql+psycopg://user:pass@host/db` |
| `HEYSURE_INTERNAL_TOKEN` | **必填** | 进程间 `/internal/*` Bearer Token，四进程必须一致 |
| `HEYSURE_SERVICE_ROLE` | 可选 | 进程身份（gateway/worker/mcp/connector），各 run.bat 已设 |
| `JWT_SECRET` | 可选 | 用户登录 token 签名（未设时随机生成） |
| `AI_RUNTIME_URL` | 可选 | Gateway → AI Runtime（默认 `http://127.0.0.1:3003`） |
| `MCP_RUNTIME_URL` | 可选 | Gateway → MCP Runtime（默认 `http://127.0.0.1:3001`） |
| `CONNECTOR_RUNTIME_URL` | 可选 | Gateway → Connector（默认 `http://127.0.0.1:3002`） |
| `TAVILY_API_KEY` | 可选 | Web 搜索功能 |
| `HEYSURE_TIMEZONE` | 可选 | 任务定时/循环墙钟时区（默认 `Asia/Shanghai`；置空退回服务器本地时区） |
| `LOG_LEVEL` | 可选 | DEBUG/INFO/WARNING（默认 INFO） |
| `LOG_JSON` | 可选 | 容器部署时设 `true`，输出 JSON 格式日志 |

完整清单：`deploy/server/main/api/core/settings.py`

## 常见症状 → 定位路径

| 症状 | 优先检查 | 关键文件 |
| --- | --- | --- |
| 启动报 DB 连接错误 | `DATABASE_URL` 格式 / PostgreSQL 是否运行 | `deploy/server/main/api/database.py` |
| `/internal/*` 返回 401 | `HEYSURE_INTERNAL_TOKEN` 四进程是否一致 | `deploy/server/main/api/auth.py` |
| 前端请求 404 | 路由是否存在且已注册到 gateway | `deploy/server/main/gateway/routers/` → `gateway/app.py` |
| AI 不回复 / 推理卡住 | AI Runtime (3003) 进程是否运行；查看 3003 日志 | `deploy/server/main/ai_runtime/worker.py` |
| MCP 工具不显示 | 工具是否已注册，设备权限是否开启 | `deploy/server/main/mcp_runtime/mcp/registry.py` + `permissions.py` |
| 端侧设备掉线 | Connector (3002) Socket.IO 是否正常 | `deploy/server/main/connector_runtime/app.py` + `api/sio.py` |
| 聊天消息丢失 | 持久化流程 | `deploy/server/main/api/services/chat/chat_persistence.py` |
| 任务不触发 | 调度器是否随 Gateway 启动 | `deploy/server/main/api/services/tasks/task_system.py` + `tasks/task_schedule.py` + `chat_runtime/chat_scheduler.py` |
| 知识库搜索无结果 | 关键词是否命中；文件是否在 topics/ 或技能目录 | `deploy/server/main/api/services/knowledge/kb_store.py`（`keyword_search_knowledge`） |
| 前端样式/组件异常 | Tailwind 类名白名单；组件 props 是否正确传递 | `deploy/web/src/components/` + `deploy/web/src/styles/main.css` |
| 桌面端工具调用失败 | Socket.IO 消息链路；runtime 工具执行日志 | Windows：`device/windows/src/agent.ts` + `executor/` + `runtime/` |

## 聊天请求链路（问题定位参考）

```
用户发消息（Web）
  → POST /api/chat/send                      (gateway:3000 — chat.py router)
  → chat_runtime/（chat_stream / run_state 等） 编排与流式
  → POST /internal/ai/run                    (ai_runtime:3003)
  → ai_runtime/worker.py + litellm           模型推理
  → 触发工具调用 → POST /internal/mcp/call   (mcp_runtime:3001)
  → tools/ 执行工具逻辑（或下发端侧设备）
  → 返回结果 → 继续推理（最多 chat_max_steps 步）
  → Socket.IO emit("chat_message")           推送到前端
  → chat/chat_persistence.py                 保存消息
```

## 关键约定

- **配置看 `settings.py`**：所有环境变量的真实清单在 `deploy/server/main/api/core/settings.py`。
- **内部接口要带 token**：进程间 `/internal/*` 需 `HEYSURE_INTERNAL_TOKEN` bearer。
- **不要提交构建产物**：`deploy/web/dist`、`device/*/dist`、`__pycache__`、`*.db` 已在 `.gitignore`。
- **桌面端壳无法在 CI/远程完整验证**：Windows Tauri 需 Rust/VS Build Tools；Linux Agent 可用 Python 单测/本机进程验证。
- **端侧代码按平台独立**：`device/windows`（Tauri）、`device/linux`（Python 服务器 Agent）、浏览器与 Android 各自独立，互不共享 `shared/`。
- **改 `deploy/server/main/api/` 影响全部 4 个进程**，注意进程角色差异。

## 服务端可靠性与复杂度强制规则

后续修改 `deploy/server/`、根目录 Compose/CI 或服务端运维脚本时，必须先阅读并遵循：

- [`doc/server-reliability-complexity-refactoring-plan.md`](doc/server-reliability-complexity-refactoring-plan.md)：架构不变量、阶段目标与完成定义。
- [`doc/server-reliability-operations.md`](doc/server-reliability-operations.md)：发布、回滚、故障演练与月度 Top-N 检查。
- [`doc/db-migrations.md`](doc/db-migrations.md)：Alembic 唯一迁移权威和遗留库接管边界。
- [`doc/refactoring/server-reliability-implementation-log.md`](doc/refactoring/server-reliability-implementation-log.md)：已完成拆分、测试和线上验收证据，避免重复造轮子或把已删除兼容层加回来。

### 代码结构

- 复杂度 baseline 是历史债务上限，只能下降，禁止通过扩大 baseline、增加豁免或移动代码来规避门禁。
- 新增生产文件不得超过 500 有效行；新增或改写的业务函数目标不超过 80 有效行、圈复杂度不超过 15。接近上限时先拆 DTO、纯函数、状态机或领域服务。
- `main/ai_runtime/inference/core.py` 是稳定入口和少量已记录兼容导出；禁止把新业务重新塞入 `_run_worker_impl`。外层运行编排放在 `worker_run_flow.py`，模型轮次、轮次后处理和工具批次分别使用现有 flow 模块。
- 跨步骤流程必须使用显式状态、动作枚举和不可变 DTO；不得用大型闭包、`nonlocal` 或散落布尔值隐式驱动状态。任务必须定义合法转换、不可复活终态、owner/lease/deadline 和恢复策略。
- 删除兼容入口前先用 `rg` 证明无调用并检查路由、测试和外部合同；确需保留时必须写明调用方、边界和删除条件，禁止无行为的永久 no-op。

### 数据库与四进程边界

- Schema 只能由 Alembic/`db-migrate` 修改。Gateway、AI、MCP、Connector Runtime 启动时只能执行只读 schema guard，禁止 `create_all`、隐式 DDL 或自动补表。
- 遗留未版本化数据库只能通过 `main/api/db.py` 的显式 `_legacy_adopt` 边界接管；不得把兼容 DDL 放回普通 Runtime 启动路径。
- `main/api/` 是四进程共享层：导入时不得创建 App、注册 Socket handler、启动线程/调度器、连接外部服务或修改数据库。进程装配归各自 `gateway/`、`ai_runtime/`、`mcp_runtime/`、`connector_runtime/`。
- 内部 HTTP 必须携带统一 `HEYSURE_INTERNAL_TOKEN`；日志、异常、测试输出和运维脚本不得回显 token、密码、Cookie、消息正文或原始 SQL。
- MCP/Connector/AI 的 readiness 应在 Compose 网络内按各自真实端口验证；不要因宿主未映射 3001–3003 就误判服务不可用。

### 测试与验收

- Server 改动提交前至少运行 `deploy/server/other/scripts/verify_server.py`；该入口统一执行复杂度、架构、语法和 unit/contract 测试。不得在门禁失败时直接改宽 baseline。
- 数据库、锁、迁移或事务改动必须增加真实 PostgreSQL integration 测试；不要用 SQLite 结果代替 PostgreSQL 行为。
- 状态机关键分支覆盖率不低于 90%，本次新增/修改关键模块增量覆盖率不低于 85%；成功路径之外还要覆盖失败、超时、取消、断线、重连、迟到和重复回执。
- 四进程或部署链路改动必须验证登录、真实 AI、MCP 和模拟 Agent；设备故障矩阵使用 `smoke_four_runtime.py --fault-matrix`，重启/lease 语义改动使用 `restart_fault_exercise.py`。
- 运行线上重启演练时显式传入已存在的测试账号；生产通常关闭注册，不能依赖 smoke 自动创建账号。项目统一验收账号仍为本文开头的 `heysure`。

### 发布与运维

- 发布前确认唯一发布所有者，避免面板自动部署与人工部署并发操作同一 Compose 项目；先只读核对目标提交、工作区、磁盘、内存和当前容器状态。
- 每次数据库相关或服务端发布前必须创建可恢复的 PostgreSQL custom-format 备份，并记录路径与大小。
- 只允许可验证的 fast-forward 同步；网络受限时使用带 SHA-256 校验的 Git bundle，不能复制未校验工作树覆盖服务器。
- 使用 `rolling_release.py` 执行迁移先行和逐 Runtime readiness 门禁；任一服务未就绪立即停止并按脚本恢复旧镜像，不得继续发布后续服务。
- 发布后必须核对 Git 提交、Alembic revision、四 Runtime readiness、Web/API、过期 `ChatRun`/`AgentDispatchTask` 数量；可靠性整改还须运行故障矩阵和规定轮数的重启演练。
- `reliability_top_n.py` 的慢模型轮次、长事务、锁等待、ChatRun 队列和 dispatch 队列按月复查；输出必须保持脱敏。

## Git 约定

- 提交信息清晰、描述性；除非明确要求，不要创建 PR。
- 根仓库与 `deploy/server`、`deploy/web`、`device` 是独立仓库。先在子模块提交，再提交根仓库的子模块指针；只暂存任务相关文件，保留用户已有改动。

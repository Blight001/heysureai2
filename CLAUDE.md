# CLAUDE.md — HeySure AI 2.0 项目导航

> 供 Claude Code 在每次会话开始时快速理解项目，**不要删除**。
> 面向"哪里改什么"的导航地图，背景与理念见 [`README.md`](README.md)。

## 一句话定位

HeySure AI 2.0 是一个**多端 AI agent 协作平台**：Web 控制台 + Python 后端（拆成 4 个进程）+ 跨平台桌面/浏览器/手机端 agent。AI 成员可被创建、治理、调用工具、记录知识。

## 测试环境（供 Claude 联调）

已部署的测试服务器，Claude 可直接 curl 验证行为：

- Web 控制台：`http://49.234.181.190:58150/`
- API 网关（可直连）：`http://49.234.181.190:3000/`
- 测试账号：`heysure` / `heysure`（以后所有测试统一用这个账号密码）
- 登录：`POST /api/auth/login`，body `{"account":"heysure","password":"heysure"}`，返回 `access_token` 与 `agent_socket_url`。

> 注意：经 :58150 登录时 `agent_socket_url` 会返回 `http://...:58150`（web 已正确反代 `/socket.io/` 含 WS 升级，可用）；经 :3000 直连登录返回 `http://...:3000`。

## 顶层结构（多仓库）

本项目采用**多仓库**布局：

| 仓库            | 本地目录 | 技术栈 | 作用 | 详细文档 |
|-----------------|----------|--------|------|----------|
| HeySure-Web     | `web/`   | Vue 3 + Vite + TS | 前端控制台 | [`web/CLAUDE.md`](web/CLAUDE.md) |
| HeySure-Server  | `server/`| Python + FastAPI + Socket.IO | 后端（4 进程） | [`server/CLAUDE.md`](server/CLAUDE.md) |
| HeySure-Device  | `device/`| Electron / Chrome MV3 / Kotlin + TS | 端侧执行器 | [`device/CLAUDE.md`](device/CLAUDE.md) |
| (workspace)     | `doc/`   | Markdown | 设计文档 | 保留在工作区根目录 |

首次克隆请使用带子模块的方式：
- `git clone --recurse-submodules <仓库地址>`
- 或者普通 clone 后执行：`git submodule update --init --recursive`

子模块会自动把 web/ server/ device/ 对接到对应的独立仓库。

拆分历史见 `SPLIT_GUIDE.md`。

## 架构与端口

```
Web 控制台 (58150)
   │ REST + Socket.IO
   ▼
API Gateway (3000)  ── 对外唯一入口，挂载 server/main/gateway/routers/*
   │ 内部 HTTP (/internal/*, 需 HEYSURE_INTERNAL_TOKEN)
   ├──► AI Runtime        (3003)  聊天队列消费 / 模型推理
   ├──► MCP Runtime       (3001)  工具注册 / 权限校验 / 工具执行
   └──► Connector Runtime (3002)  QQ/飞书机器人 + 端侧 agent 调度
                                      │ Socket.IO
                                      ▼
                          桌面 agent / 浏览器扩展 / 手机（执行本机操作）
```

- 4 进程**共享** `server/main/api/`（模型、DB、认证、服务、配置）；各 `*_runtime/` 只负责把共享层接成一个进程。
- 进程角色通过 `HEYSURE_SERVICE_ROLE` 区分：`gateway | worker | mcp | connector`。
- 数据库仅支持 PostgreSQL，`DATABASE_URL` 为必填项。

## 常用命令

```bash
# 首次初始化（多仓库）
git clone --recurse-submodules ...
# 或之后：
git submodule update --init --recursive

# Docker（一键全栈）
docker compose up -d --build      # 或 docker-run.bat

# 本地分进程（Windows）
server\run.bat
web\run.bat
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

Gateway 的 `lifespan` 会加载 MCP 插件、重置 agent presence、启动调度器，**必须最先起**。
Docker Compose 已通过 `depends_on` + `healthcheck` 自动处理顺序。

## "改 X 去哪里"速查

**注意**：代码现在分布在三个独立仓库中（init 后布局与原来相同）。

| 需求 | 位置 |
| --- | --- |
| 新增 / 改 REST 接口 | `server/main/gateway/routers/<域>.py`（文件名即域） |
| 业务逻辑 / 数据访问 | `server/main/api/services/`（按域分子包：`knowledge/` `tasks/` `mcp/` `device_tools/` `chat/` `access/` `storage/`）与 `server/main/api/models/` |
| 新增 MCP 工具 | `server/tools/`（实现）→ `server/main/mcp_runtime/mcp/registry.py`（注册）→ `web/src/utils/mcpTools.ts`（前端展示） |
| 聊天 / 推理流程 | `server/main/api/chat_runtime/`（编排）+ `server/main/ai_runtime/`（worker） |
| 定时 / 循环任务 | `server/main/api/services/tasks/task_schedule.py`（唯一权威实现，REST/MCP/调度器共用） |
| QQ / 飞书机器人 | `server/main/connector_runtime/bots/` 与 `dispatch/` |
| 前端页面 / 组件 | `web/src/components/<域>/`（chat / dashboard / home / librarian / common） |
| 前端调后端 API 封装 | `web/src/api/<域>.ts`（http.ts 是统一客户端） |
| 桌面端本机执行 | 各平台独立 `src/runtime/`（受控执行底座） |
| 浏览器自动化 | `device/extension/src/` |
| 配置项 / 环境变量 | `server/main/api/core/settings.py`（**配置总入口**） |
| AI 角色 prompt | `doc/prompt/` |
| 知识工坊 Agent | `server/library/`（服务端内置虚拟 Agent） |

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
| `LOG_LEVEL` | 可选 | DEBUG/INFO/WARNING（默认 INFO） |
| `LOG_JSON` | 可选 | 容器部署时设 `true`，输出 JSON 格式日志 |

完整清单：`server/main/api/core/settings.py`

## 常见症状 → 定位路径

| 症状 | 优先检查 | 关键文件 |
| --- | --- | --- |
| 启动报 DB 连接错误 | `DATABASE_URL` 格式 / PostgreSQL 是否运行 | `server/main/api/database.py` |
| `/internal/*` 返回 401 | `HEYSURE_INTERNAL_TOKEN` 四进程是否一致 | `server/main/api/auth.py` |
| 前端请求 404 | 路由是否存在且已注册到 gateway | `server/main/gateway/routers/` → `gateway/main.py` |
| AI 不回复 / 推理卡住 | AI Runtime (3003) 进程是否运行；查看 3003 日志 | `server/main/ai_runtime/worker.py` |
| MCP 工具不显示 | 工具是否已注册，设备权限是否开启 | `server/main/mcp_runtime/mcp/registry.py` + `permissions.py` |
| 端侧设备掉线 | Connector (3002) Socket.IO 是否正常 | `server/main/connector_runtime/app.py` + `api/sio.py` |
| 聊天消息丢失 | 持久化流程 | `server/main/api/services/chat/chat_persistence.py` |
| 任务不触发 | 调度器是否随 Gateway 启动 | `server/main/api/services/tasks/task_system.py` + `tasks/task_schedule.py` |
| 知识库搜索无结果 | 关键词是否命中；文件是否在 topics/ 或技能目录 | `server/main/api/services/knowledge/kb_store.py`（`keyword_search_knowledge`） |
| 前端样式/组件异常 | Tailwind 类名白名单；组件 props 是否正确传递 | `web/src/components/` + `web/src/styles/main.css` |
| 桌面端工具调用失败 | Socket.IO 消息链路；runtime 工具执行日志 | 各平台 `src/services/agent-runtime.ts` + `executor/` |

## 聊天请求链路（问题定位参考）

```
用户发消息（Web）
  → POST /api/chat/send                      (gateway:3000 — chat.py router)
  → chat_runtime/orchestrator.py             编排推理步骤
  → POST /internal/ai/run                    (ai_runtime:3003)
  → ai_runtime/worker.py + litellm           模型推理
  → 触发工具调用 → POST /internal/mcp/call   (mcp_runtime:3001)
  → tools/ 执行工具逻辑
  → 返回结果 → 继续推理（最多 chat_max_steps 步）
  → Socket.IO emit("chat_message")           推送到前端
  → chat/chat_persistence.py                 保存消息
```

## 关键约定

- **配置看 `settings.py`**：所有环境变量的真实清单在 `server/main/api/core/settings.py`。
- **内部接口要带 token**：进程间 `/internal/*` 需 `HEYSURE_INTERNAL_TOKEN` bearer。
- **不要提交构建产物**：`web/dist`、`device/*/dist`、`__pycache__`、`*.db` 已在 `.gitignore`。
- **桌面端壳无法在 CI/远程验证**：Electron GUI 依赖 X11/原生模块，只能 `tsc` 编译检查。
- **win/linux/mac 桌面端独立**：通用逻辑已复制到各平台 `src/`（windows/linux/mac 各自拥有完整副本），可独立修改。
- **改 `server/main/api/` 影响全部 4 个进程**，注意进程角色差异。

## Git 约定

- 提交信息清晰、描述性；除非明确要求，不要创建 PR。

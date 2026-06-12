# CLAUDE.md — server/ 后端

> 详细中文说明见 [`README.md`](README.md)。本文件是给 Claude 的快速导航与约定补充。

## 心智模型：1 个共享层 + 4 个进程

```
api/            ← 共享库（模型 / DB / 认证 / 服务 / 配置），被下面 4 个进程 import
gateway/        ← 进程① 对外网关 (3000)：挂载 routers/*，Socket.IO，静态资源
mcp_runtime/    ← 进程② MCP 工具运行时 (3001)：工具注册 / 权限 / 执行
connector_runtime/ ← 进程③ 连接器 (3002)：QQ/飞书 bot + 端侧 agent 调度
ai_runtime/     ← 进程④ AI worker (3003)：聊天队列消费 / 模型推理
```

每个 `*_runtime/main.py` 只做一件事：设置进程角色环境变量 → import 共享 `api` → 用 uvicorn 起一个端口。**改 `api/` 会同时影响 4 个进程。**

## api/ 内部分层

| 子目录 | 职责 |
| --- | --- |
| `api/core/` | `settings.py`(**配置总入口**)、`config.py`、`logging_config.py`、`migrations.py` |
| `api/models/` | SQLModel/ORM 数据模型（user / chat / project / agent_* / knowledge …） |
| `api/services/` | 业务逻辑（task_system / librarian / kb_store / governance / chat_persistence …） |
| `api/chat_runtime/` | 聊天编排：调度、流式、prompt 组装、MCP 解析 |
| `api/runtime/` | 进程控制、心跳、内部 HTTP 客户端 |
| `api/integrations/` | 外部数据源（clawhub / media_source） |
| `api/database.py` `api/sio.py` `api/socket_events.py` | DB 引擎、Socket.IO server、socket 事件注册 |

## "改 X 去哪里"

| 需求 | 位置 |
| --- | --- |
| 新增 REST 接口 | `gateway/routers/<域>.py`，文件名即域（auth/chat/agents/ai/projects/mcp/...） |
| 新增 / 改数据模型 | `api/models/`，注意迁移 `api/core/migrations.py` |
| 业务逻辑 | `api/services/` |
| 新增 MCP 工具 | `mcp_runtime/mcp/`（注册 + 权限校验） |
| 聊天/推理 | 编排在 `api/chat_runtime/`，worker 在 `ai_runtime/` |
| 任务定时/循环 schedule | `api/services/task_schedule.py`（解析/校验/续期的唯一权威实现，REST/MCP/调度器共用） |
| 知识/进化工坊 | `workshop/`（**服务端内置**，每账号自动上线；`direction.md`/`policy.py`/`tools.py` 即控制面，`engine.py` 执行编排），绑定接口 `gateway/routers/workshop.py` + `api/workshop_bindings.py`；工具实现在 `mcp_runtime/mcp/tools/{librarian,evolution}.py` 但不在内置 registry，AI 须绑定工坊才可调用 |
| 机器人/连接器 | `connector_runtime/bots/`、`connector_runtime/dispatch/` |
| 配置项 | `api/core/settings.py` |

## 开发命令

```bash
cd server
pip install -r requirements.txt
python -m gateway.main          # 然后按需起 mcp/connector/ai_runtime.main
```

## 注意点

- 进程间 `/internal/*` 调用需 `HEYSURE_INTERNAL_TOKEN` bearer。
- 未配置 `DATABASE_URL` 时回落 SQLite (`server/data/heysure.db`)。
- `data/` `logs/` `uploads/` `venv/` 为运行时产物，已 gitignore。
- 启动顺序对依赖敏感：gateway 在 lifespan 里加载 MCP 插件、重置 agent presence、启动调度器。

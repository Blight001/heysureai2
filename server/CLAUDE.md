# CLAUDE.md — server/ 后端

> 详细中文说明见 [`README.md`](README.md)。本文件是给 Claude 的快速导航与约定补充。

## 目录布局

```
server/
  main/           ← 运行时核心（5 个包 + 4 个进程）
    api/          ← 共享库（模型 / DB / 认证 / 服务 / 配置）
    gateway/      ← 进程① 对外网关 (3000)
    mcp_runtime/  ← 进程② MCP 工具运行时 (3001)
    connector_runtime/ ← 进程③ 连接器 (3002)
    ai_runtime/   ← 进程④ AI worker (3003)
  other/          ← 非运行时辅助
    migrations/   ← Alembic 迁移
    scripts/      ← 运维/迁移脚本
    tests/        ← pytest 测试
  workshop/       ← 图书馆内置设备（知识工坊 Agent，server 根下）
  tools/          ← 工具箱内置设备（默认全绑的服务端固定工具集，server 根下）
  static/ data/ logs/  ← 静态资源与运行时产物
```

`PYTHONPATH` 需包含 `server/main` 与 `server` 根目录（`run_*.bat` 与 Dockerfile 已配置），因此 import 路径不变：`api`、`gateway`、`workshop`、`tools` 等。

## 心智模型：1 个共享层 + 4 个进程

每个 `*_runtime/main.py` 只做一件事：设置进程角色环境变量 → import 共享 `api` → 用 uvicorn 起一个端口。**改 `main/api/` 会同时影响 4 个进程。**

## api/ 内部分层

| 子目录 | 职责 |
| --- | --- |
| `main/api/core/` | `settings.py`(**配置总入口**)、`config.py`、`logging_config.py`、`migrations.py` |
| `main/api/models/` | SQLModel/ORM 数据模型（user / chat / project / agent_* / knowledge …） |
| `main/api/services/` | 业务逻辑（task_system / librarian / kb_store / governance / chat_persistence …） |
| `main/api/chat_runtime/` | 聊天编排：调度、流式、prompt 组装、MCP 解析 |
| `main/api/runtime/` | 进程控制、心跳、内部 HTTP 客户端 |
| `main/api/integrations/` | 外部数据源（clawhub / media_source） |
| `main/api/database.py` `main/api/sio.py` `main/api/socket_events.py` | DB 引擎、Socket.IO server、socket 事件注册 |

## "改 X 去哪里"

| 需求 | 位置 |
| --- | --- |
| 新增 REST 接口 | `main/gateway/routers/<域>.py`，文件名即域（auth/chat/agents/ai/projects/mcp/...） |
| 新增 / 改数据模型 | `main/api/models/`，注意迁移 `other/migrations/` |
| 业务逻辑 | `main/api/services/` |
| 新增 MCP 工具 | `main/mcp_runtime/mcp/`（注册 + 权限校验） |
| 聊天/推理 | 编排在 `main/api/chat_runtime/`，worker 在 `main/ai_runtime/` |
| 任务定时/循环 schedule | `main/api/services/task_schedule.py`（解析/校验/续期的唯一权威实现，REST/MCP/调度器共用） |
| 知识工坊（图书馆）Agent | `workshop/` 服务端内置虚拟 Agent，绑定接口为 `main/gateway/routers/workshop.py` + `main/api/workshop_bindings.py` |
| 工具箱（内置设备） | `tools/engine.py` 收拢工具箱身份/展示/绑定/门禁；门禁由 `main/mcp_runtime/mcp/core.py` 在 `MCPRegistry.call` 调用，绑定与图书馆共用 `main/api/workshop_bindings.py` 的通用绑定层 |
| 机器人/连接器 | `main/connector_runtime/bots/`、`main/connector_runtime/dispatch/` |
| 配置项 | `main/api/core/settings.py` |

## 开发命令

```bash
cd server
pip install -r requirements.txt
set PYTHONPATH=main;.    # Windows；Linux/macOS 用 main:.
python -m gateway.main          # 然后按需起 mcp/connector/ai_runtime.main
pytest                          # 读取 pytest.ini，测试在 other/tests/
```

## 注意点

- 进程间 `/internal/*` 调用需 `HEYSURE_INTERNAL_TOKEN` bearer。
- 数据库仅支持 PostgreSQL，`DATABASE_URL` 为必填项。
- `data/` `logs/` `venv/` 为运行时产物，已 gitignore。
- 启动顺序对依赖敏感：gateway 在 lifespan 里加载 MCP 插件、重置 agent presence、启动调度器。
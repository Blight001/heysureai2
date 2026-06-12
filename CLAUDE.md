# CLAUDE.md — HeySure AI 2.0 项目导航

> 本文件供 Claude Code / 协作者在每次会话开始时快速理解项目，**不要删除**。
> 面向"哪里改什么"的导航地图，背景与理念见 [`README.md`](README.md) / [`README.zh-CN.md`](README.zh-CN.md)。

## 一句话定位

HeySure AI 2.0 是一个**多端 AI agent 协作平台**：Web 控制台 + Python 后端（拆成 4 个进程）+ 跨平台桌面/浏览器端 agent。AI 成员可被创建、治理、调用工具、记录知识。

## 顶层结构（改东西先看这张表）

| 目录 | 技术栈 | 作用 | 详细文档 |
| --- | --- | --- | --- |
| `web/` | Vue 3 + Vite + TS | 前端控制台（聊天 / 仪表盘 / AI 配置 / 知识库） | [`web/CLAUDE.md`](web/CLAUDE.md) |
| `server/` | Python + FastAPI + Socket.IO | 后端，拆成 4 个进程（见下） | [`server/CLAUDE.md`](server/CLAUDE.md) · [`server/README.md`](server/README.md) |
| `agent/` | Electron / Chrome MV3 + TS / Python | 端侧执行器：Windows / Linux 桌面 + 浏览器扩展 + 知识与进化工坊（`workshop/`） | [`agent/CLAUDE.md`](agent/CLAUDE.md) |
| `doc/` | Markdown | 各角色 prompt 与设计文档 | `doc/prompt/` · 角色分工与知识流转见 [`doc/角色与知识流转.md`](doc/角色与知识流转.md) |

## 架构与端口（运行时心智模型）

```
Web 控制台 (58150)
   │ REST + Socket.IO
   ▼
API Gateway (3000)  ──对外唯一入口，挂载 server/gateway/routers/*
   │ 内部 HTTP (/internal/*, 需 HEYSURE_INTERNAL_TOKEN)
   ├──► AI Runtime        (3003)  聊天队列消费 / 模型推理
   ├──► MCP Runtime       (3001)  工具注册 / 权限校验 / 工具执行
   └──► Connector Runtime (3002)  QQ / 飞书机器人 + 端侧 agent 调度
                                      │ Socket.IO
                                      ▼
                          桌面 agent / 浏览器扩展（执行本机操作）
```

- 4 个进程**共享** `server/api/` 这一层（模型、DB、认证、服务、配置）；各 `*_runtime/` 只负责把共享层接成一个进程。
- 进程角色通过启动前设置环境变量区分（见各 `*_runtime/main.py` 顶部注释）。
- 默认数据库：未配置 `DATABASE_URL` 时回落到 `server/data/heysure.db` (SQLite)；生产用 Postgres。

## 常用命令

```bash
# Docker（最省事，一键起全栈）
docker compose up -d --build      # Windows 可用 docker-run.bat

# 本地分进程（开发，Windows 脚本）
server\run.bat        # 一次性平铺打开 4 个后端窗口
web\run.bat           # 前端 dev server
agent\windows\run.bat # Windows 桌面 agent

# 单独手动起后端进程（任意平台）
cd server
python -m gateway.main          # 3000
python -m mcp_runtime.main      # 3001
python -m connector_runtime.main# 3002
python -m ai_runtime.main       # 3003

# 前端
cd web && npm install && npm run dev   # npm run build 出产物到 web/dist

# 健康检查
curl http://127.0.0.1:3000/    # 返回 {"message":"HeySure Server is running"}
```

## "我想改 X，去哪里"速查

| 需求 | 位置 |
| --- | --- |
| 新增 / 改 REST 接口 | `server/gateway/routers/<域>.py`（按域拆分，文件名即域） |
| 业务逻辑 / 数据访问 | `server/api/services/` 与 `server/api/models/` |
| 新增 MCP 工具 | `server/mcp_runtime/mcp/`（注册 + 权限），前端展示见 `web/src/utils/mcpTools.ts` |
| 聊天 / 推理流程 | `server/api/chat_runtime/`（编排） + `server/ai_runtime/`（worker） |
| QQ / 飞书机器人 | `server/connector_runtime/bots/` 与 `dispatch/` |
| 前端页面 / 组件 | `web/src/components/<域>/`（chat / dashboard / home / librarian / common） |
| 前端调后端的 API 封装 | `web/src/api/<域>.ts` |
| 桌面端本机操作工具 | `agent/<windows\|linux>/src/tools/` |
| 浏览器自动化 | `agent/extension/src/` |
| 配置项 / 环境变量 | `server/api/core/settings.py`（**配置总入口**） |
| AI 角色 prompt | `doc/prompt/` |

## 关键约定与注意点（容易踩的坑）

- **配置看 `settings.py`**：所有环境变量的真实清单在 `server/api/core/settings.py`，README 只列常用项。
- **内部接口要带 token**：进程间 `/internal/*` 调用需 `HEYSURE_INTERNAL_TOKEN` 的 bearer。
- **不要提交构建产物**：`web/dist`、`agent/*/dist`、`__pycache__`、`*.db` 等已在 `.gitignore`，新增产物目录记得补充。
- **桌面 agent 无法在本 CI/远程环境运行验证**：`agent/windows`、`agent/linux` 是 Electron GUI（依赖 X11/原生模块），只能编译检查（`tsc`），实际行为需在本机验证。
- **win/linux agent 高度同源**：两者共享同一套架构，仅平台相关工具实现不同；改通用逻辑时**两边都要改**（详见 `agent/CLAUDE.md` 的"重复代码"小节）。
- **后端是单一共享层 + 多进程**：改 `server/api/` 会影响全部 4 个进程，注意进程角色差异。

## Git 约定

- 开发分支：`claude/project-organization-U0HrE`（按任务指定）。
- 提交信息清晰、描述性；除非明确要求，不要创建 PR。

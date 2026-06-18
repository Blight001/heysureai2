# HeySure Server

`server` 目录包含 HeySure 后端服务。当前后端按职责拆成多个进程：公网 API 网关、MCP 工具运行时、连接器运行时和 AI worker。

## 快速启动

在 Windows 下直接运行：

```bat
server\run.bat
```

这个脚本会通过 `tile_windows.ps1` 分别打开以下服务窗口：

| 服务 | 启动脚本 | 默认地址/端口 | 说明 |
| --- | --- | --- | --- |
| API Gateway | `run_gateway.bat` | `http://127.0.0.1:3000` | 对外 REST API、Socket.IO、静态头像资源 |
| MCP Runtime | `run_mcp.bat` | `http://127.0.0.1:3001` | MCP 工具注册、加载和内部调用 |
| Connector Runtime | `run_connector.bat` | `http://127.0.0.1:3002` | QQ、飞书等连接器和 agent 调度 |
| AI Runtime | `run_ai.bat` | `http://127.0.0.1:3003` | 处理远程聊天队列和 AI 推理任务 |

也可以单独运行对应的 `run_*.bat` 脚本调试某个服务。

## 环境配置

启动脚本会读取仓库根目录的 `.env`。常用配置包括：

```env
DATABASE_URL=postgresql+psycopg://heysure:heysure@127.0.0.1:5432/heysure
HEYSURE_INTERNAL_TOKEN=heysure-dev-internal-token-change-me
```

重要变量：

- `DATABASE_URL`：必填的 PostgreSQL 数据库连接；缺失或使用其他数据库时服务拒绝启动。
- `HEYSURE_INTERNAL_TOKEN`：拆分进程之间访问 `/internal/*` 接口时使用的内部令牌。
- `MCP_RUNTIME_URL`：MCP runtime 地址，默认 `http://127.0.0.1:3001`。
- `CONNECTOR_RUNTIME_URL`：connector runtime 地址，默认 `http://127.0.0.1:3002`。
- `AI_RUNTIME_URL`：AI runtime 状态服务地址，默认可设为 `http://127.0.0.1:3003`。
- `AI_DISPATCH_MODE`：`remote` 时聊天任务进入队列，由 `ai-runtime` 消费。

完整配置入口见 `main/api/core/settings.py`。

## 目录说明

| 路径 | 说明 |
| --- | --- |
| `main/gateway/` | FastAPI + Socket.IO 网关进程，挂载 `gateway/routers/` 下的 HTTP 路由 |
| `main/api/` | 跨进程共享的模型、数据库、配置、认证、服务和运行时辅助代码 |
| `main/ai_runtime/` | AI worker 入口、任务队列消费、推理流程和内部状态服务 |
| `main/mcp_runtime/` | MCP 插件加载、工具注册、工具 HTTP 包装 |
| `main/connector_runtime/` | 外部连接器、机器人适配器和 endpoint agent 调度 |
| `other/migrations/` | Alembic 数据库迁移 |
| `other/scripts/` | 辅助脚本（部署 webhook、SQLite 迁移等） |
| `other/tests/` | pytest 测试 |
| `workshop/` | 知识工坊内置 Agent |
| `data/` | 本地运行数据与 workspace |
| `logs/` | 服务日志 |
| `static/` | 后端静态资源 |

## 开发命令

安装依赖：

```bat
cd server
venv\Scripts\activate
pip install -r requirements.txt
```

手动启动网关：

```bat
cd server
set PYTHONPATH=main;.
venv\Scripts\activate
python -m gateway.main
```

手动启动各拆分服务：

```bat
python -m mcp_runtime.main
python -m connector_runtime.main
python -m ai_runtime.main
```

运行测试：

```bat
cd server
pytest
```

## 访问检查

网关启动后可以访问：

```text
http://127.0.0.1:3000/
```

返回 `{"message":"HeySure Server is running"}` 表示 API Gateway 正常运行。

内部 runtime 的 `/internal/*` 接口需要带上 `HEYSURE_INTERNAL_TOKEN` 对应的 bearer token。
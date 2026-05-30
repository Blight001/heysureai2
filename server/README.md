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

- `DATABASE_URL`：数据库连接。未配置时默认使用 `server/data/heysure.db`。
- `HEYSURE_INTERNAL_TOKEN`：拆分进程之间访问 `/internal/*` 接口时使用的内部令牌。
- `MCP_RUNTIME_URL`：MCP runtime 地址，默认 `http://127.0.0.1:3001`。
- `CONNECTOR_RUNTIME_URL`：connector runtime 地址，默认 `http://127.0.0.1:3002`。
- `AI_RUNTIME_URL`：AI runtime 状态服务地址，默认可设为 `http://127.0.0.1:3003`。
- `AI_DISPATCH_MODE`：`remote` 时聊天任务进入队列，由 `ai-runtime` 消费。

完整配置入口见 `api/core/settings.py`。

## 目录说明

| 路径 | 说明 |
| --- | --- |
| `gateway/` | FastAPI + Socket.IO 网关进程，挂载 `gateway/routers/` 下的 HTTP 路由 |
| `api/` | 跨进程共享的模型、数据库、配置、认证、服务和运行时辅助代码 |
| `ai_runtime/` | AI worker 入口、任务队列消费、推理流程和内部状态服务 |
| `mcp_runtime/` | MCP 插件加载、工具注册、工具 HTTP 包装 |
| `connector_runtime/` | 外部连接器、机器人适配器和 endpoint agent 调度 |
| `data/` | 本地数据、workspace、SQLite 默认数据库 |
| `logs/` | 服务日志 |
| `scripts/` | 辅助脚本 |
| `static/` | 后端静态资源 |
| `uploads/` | 上传文件目录 |

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
venv\Scripts\activate
python -m gateway.main
```

手动启动各拆分服务：

```bat
python -m mcp_runtime.main
python -m connector_runtime.main
python -m ai_runtime.main
```

## 访问检查

网关启动后可以访问：

```text
http://127.0.0.1:3000/
```

返回 `{"message":"HeySure Server is running"}` 表示 API Gateway 正常运行。

内部 runtime 的 `/internal/*` 接口需要带上 `HEYSURE_INTERNAL_TOKEN` 对应的 bearer token。

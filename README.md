# HeySure AI 2.0

HeySure AI 2.0 是一个由后端服务、Web 前端和 Windows 桌面 agent 组成的 AI 助手项目。根目录用于组织各子项目、Docker 编排和共享配置。

## 项目结构

| 路径 | 说明 |
| --- | --- |
| `server/` | Python 后端服务，包含 API Gateway、AI Runtime、MCP Runtime、Connector Runtime |
| `web/` | Vue + Vite Web 前端 |
| `agent/win/` | Windows Electron 桌面 agent |
| `doc/` | 项目设计、优化路线和 prompt 文档 |
| `docker-compose.yml` | 后端、前端、数据库的一体化容器编排 |
| `.env` | 本地服务共享环境变量 |

## 快速启动

### Docker 启动

在根目录运行：

```bat
docker-run.bat
```

等价于：

```bat
docker compose up -d --build
```

默认暴露端口：

| 服务 | 地址 |
| --- | --- |
| Web | `http://127.0.0.1:58150` |
| API Gateway | `http://127.0.0.1:3000` |
| Connector Runtime | `http://127.0.0.1:3002` |

MCP Runtime、AI Runtime 和 PostgreSQL 默认只在 Docker 网络内部访问。

### 本地开发启动

1. 启动后端：

```bat
server\run.bat
```

2. 启动 Web：

```bat
web\run.bat
```

3. 启动 Windows agent：

```bat
agent\win\run.bat
```

## 环境变量

根目录 `.env` 会被后端启动脚本读取。当前常用配置：

```env
DATABASE_URL=postgresql+psycopg://heysure:heysure@127.0.0.1:5432/heysure
HEYSURE_INTERNAL_TOKEN=heysure-dev-internal-token-change-me
```

常见变量：

- `DATABASE_URL`：后端数据库连接。
- `HEYSURE_INTERNAL_TOKEN`：后端拆分进程之间访问内部接口的 token。
- `SERVER_URL`：Web 前端连接的后端地址，默认 `http://127.0.0.1:3000`。

后端更完整的说明见 `server/README.md`。

## 开发命令

Web：

```bat
cd web
npm install
npm run dev
```

Windows agent：

```bat
cd agent\win
npm install
npm run dev
```

Server：

```bat
cd server
venv\Scripts\activate
pip install -r requirements.txt
python -m gateway.main
```

## 访问检查

后端启动后访问：

```text
http://127.0.0.1:3000/
```

返回 `{"message":"HeySure Server is running"}` 表示 API Gateway 正常。

Web 启动后访问 Vite 输出的本地地址；Docker 模式默认访问：

```text
http://127.0.0.1:58150
```

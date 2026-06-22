<p align="center">
  <img src="server/static/extension.png" alt="Browser extension" width="160" />
  <img src="server/static/HeySure.png" alt="HeySure AI" width="160" />
  <img src="server/static/windows.png" alt="Desktop agent" width="160" />
</p>

<p align="center">
  English | <a href="README.zh-CN.md">简体中文</a>
</p>

<h1 align="center">HeySure AI 2.0</h1>

<p align="center">
  A digital-society operating system for AI collaboration, governance, tool execution, and cross-platform access.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Vue-3-42b883?logo=vue.js&logoColor=white" alt="Vue 3" />
  <img src="https://img.shields.io/badge/FastAPI-Gateway-009688?logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Python-3.9+-3776ab?logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/Socket.IO-Realtime-010101?logo=socket.io&logoColor=white" alt="Socket.IO" />
  <img src="https://img.shields.io/badge/Docker-Compose-2496ed?logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/MCP-Runtime-7c3aed" alt="MCP Runtime" />
  <img src="https://img.shields.io/badge/License-Apache--2.0-blue" alt="Apache-2.0" />
</p>

---

## Overview

HeySure AI 2.0 is more than a chat app. It is a runnable agent ecosystem built around:

- a web console for configuration and operations
- a FastAPI gateway for public APIs and realtime updates
- an AI runtime for inference and chat dispatch
- an MCP runtime for tool registration and permission control
- connector runtimes for external platforms
- desktop agents for Windows, Linux, and macOS
- a Chrome extension and an Android endpoint for additional access paths

The platform is designed so AI members can be created, configured, observed, coordinated, and given controlled access to tools. Over time, conversations, tasks, tool calls, and lifecycle events are recorded into reusable knowledge and audit trails.

## Contents

- [Key Features](#key-features)
- [Principles](#principles)
- [Architecture](#architecture)
- [Project Layout](#project-layout)
- [Quick Start](#quick-start)
- [Development](#development)
- [Environment](#environment)
- [Docs](#docs)
- [License](#license)

## Key Features

| Feature | Description |
| --- | --- |
| AI member governance | Create and manage AI members with model settings, roles, tool permissions, and task flows. |
| Tool-based execution | Register and call tools through the MCP runtime, including workspace, memory, task, conversation, and communication tools. |
| Multi-client access | Use the same backend from the web console, desktop agents, Chrome extension, Android endpoint, QQ connector, and Feishu connector. |
| Real-time state | Share task progress, agent presence, runtime state, and chat updates through REST APIs and Socket.IO. |
| Knowledge inheritance | Turn conversations, tasks, outcomes, and lifecycle events into long-term reusable context. |

## Principles

| Principle | Meaning |
| --- | --- |
| Governable | AI members have identity, permissions, tasks, state, and lifecycle boundaries instead of being opaque model calls. |
| Traceable | Conversations, task runs, tool calls, and configuration changes can be recorded and audited. |
| Composable | Models, tools, connectors, frontend clients, and local agents are connected through stable interfaces. |
| Inheritable | Useful experience is preserved through knowledge entries, task records, and future agent context. |

## Architecture

```text
Web Console
  -> API Gateway
  -> AI Runtime
  -> MCP Runtime
  -> Connector Runtime
  -> Desktop / Browser / Android endpoints
  -> Persistence / state broadcast / knowledge capture
```

Typical flow:

```text
User / external platform
  -> API Gateway
  -> AI Runtime
  -> MCP Runtime
  -> Connector / Agent
  -> persistence / state broadcast / knowledge capture
```

## Project Layout

| Path | Role |
| --- | --- |
| `web/` | Vue 3 + Vite web console. |
| `server/main/gateway/` | FastAPI + Socket.IO gateway exposing REST APIs, realtime events, and static assets. |
| `server/main/api/` | Shared models, database access, authentication, services, runtime helpers, and business logic. |
| `server/main/ai_runtime/` | Chat queue consumption, inference calls, message persistence, and runtime status. |
| `server/main/mcp_runtime/` | MCP tool registration, plugin loading, permission checks, and internal tool calls. |
| `server/main/connector_runtime/` | QQ and Feishu bots plus external agent dispatch. |
| `server/other/` | Alembic migrations, helper scripts, and pytest tests. |
| `device/windows/` | Windows desktop agent. |
| `device/linux/` | Linux desktop agent. |
| `device/mac/` | macOS desktop agent. |
| `device/extension/` | Chrome MV3 browser extension. |
| `device/android/` | Android endpoint app and optional ADB-based controller. |
| `device/shared/` | Shared desktop agent source, scripts, and assets. |
| `doc/` | Architecture notes, prompts, governance ideas, and system design documents. |

## Quick Start

### Docker Compose

```bat
docker-run.bat
```

Equivalent to:

```bat
docker compose up -d --build
```

| Service | URL |
| --- | --- |
| Web Console | `http://127.0.0.1:58150` |
| API Gateway | `http://127.0.0.1:3000` |
| Connector Runtime | `http://127.0.0.1:3002` |
| Postgres | Compose service `db:5432` |

### Local Windows Development

```bat
windows-run.bat
server\run.bat
web\run.bat
device\windows\run.bat
```

Health check:

```text
http://127.0.0.1:3000/
```

The gateway is healthy when it returns:

```json
{"message":"HeySure Server is running"}
```

## Environment

Backend scripts read the root `.env` file. Start by copying `.env.example` to `.env` at the repository root. Common variables:

```env
DATABASE_URL=postgresql+psycopg://heysure:heysure@127.0.0.1:5432/heysure
HEYSURE_INTERNAL_TOKEN=heysure-dev-internal-token-change-me
MCP_RUNTIME_URL=http://127.0.0.1:3001
CONNECTOR_RUNTIME_URL=http://127.0.0.1:3002
AI_RUNTIME_URL=http://127.0.0.1:3003
AI_DISPATCH_MODE=remote
SERVER_URL=http://127.0.0.1:3000
WORKSPACE_ROOT=C:\path\to\workspace
```

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL connection string. Startup fails if it is missing or points to another database. |
| `HEYSURE_INTERNAL_TOKEN` | Token used by the gateway when calling internal runtime `/internal/*` endpoints. |
| `MCP_RUNTIME_URL` | MCP runtime URL. |
| `CONNECTOR_RUNTIME_URL` | Connector runtime URL. |
| `AI_RUNTIME_URL` | AI runtime status service URL. |
| `AI_DISPATCH_MODE` | Use `remote` to send chat tasks to the queue consumed by `ai_runtime`. |
| `SERVER_URL` | Base URL used by the web app and device clients. |
| `WORKSPACE_ROOT` | Working directory used by desktop and Android endpoint clients. |

See `server/main/api/core/settings.py` for the full configuration surface.

## Development

### Web

```bat
cd web
npm install
npm run dev
npm run build
```

### Server

```bat
cd server
install-deps.bat
python -m gateway.main
```

Start split runtimes manually:

```bat
python -m mcp_runtime.main
python -m connector_runtime.main
python -m ai_runtime.main
```

### Desktop agents

```bat
device\run-windows.bat
device\run-linux.sh
device\run-mac.sh
```

### Android

```bat
cd device\android
gradle wrapper
./gradlew assembleDebug
```

### Browser extension

```bat
cd device\extension
npm install
npm run build
```

### Keeping things tidy (monorepo)

这个仓库同时包含 **web / server / device** 三大块，容易感觉“太杂”。

虽然 `.gitignore` 已排除构建产物，但本地磁盘上 `node_modules`、`dist`、`build`、`__pycache__`、`venv` 仍然会让目录显得很重。

**一键清理：**

```bat
clean.bat          # Windows 双击
pwsh clean.ps1     # 或 PowerShell 7
```

清理后需要重新 `npm install` / 安装 Python 依赖。

想彻底“仓库里套仓库”有两种主流做法（目前仍是单仓库 monorepo）：

- **Git Submodule**：把 web/server/device 独立成仓库，用 submodule 嵌套进来。
- **独立仓库 + bootstrap**（推荐）：拆成 3 个仓库，根目录放一个 `init-env.ps1` 脚本自动 clone 到 `web/`、`server/`、`device/` 目录，保持所有启动脚本和 docker-compose 不变。

需要的话告诉我，我可以帮你实施任一方案。

## Docs

- Backend overview: [`server/README.md`](server/README.md)
- Windows desktop agent: [`device/windows/README.md`](device/windows/README.md)
- Linux desktop agent: [`device/linux/README.md`](device/linux/README.md)
- macOS desktop agent: [`device/mac/README.md`](device/mac/README.md)
- Browser extension: [`device/extension/README.md`](device/extension/README.md)
- Android endpoint: [`device/android/README.md`](device/android/README.md)
- Shared desktop source: [`device/shared/README.md`](device/shared/README.md)

## License

Apache-2.0

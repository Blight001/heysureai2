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

This is a **multi-repository** project. The workspace root only contains orchestration files.

| Path (after init) | Role |
| --- | --- |
| `web/`                  | HeySure-Web: Vue 3 + Vite web console (standalone repo) |
| `server/`               | HeySure-Server: all backend code (standalone repo) |
| `device/`               | HeySure-Device: all client agents + extension + Android (standalone repo) |
| `doc/`                  | Architecture notes, prompts, and design documents (lives in workspace) |

Inside the component repositories you will find their own `README.md` and `CLAUDE.md`.

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
# One-time (or when you want to refresh components)
pwsh -File init-env.ps1

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

Backend scripts read the `.env` file in the **workspace root** (same directory as `docker-compose.yml` and `init-env.ps1`).

Copy `.env.example` → `.env` and fill it in. Common variables:

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

### Web (HeySure-Web)

```bat
cd web
npm install
npm run dev
npm run build
```

### Server (HeySure-Server)

```bat
cd server
install-deps.bat
python -m gateway.main
```

Start split runtimes manually (from server/):

```bat
python -m mcp_runtime.main
python -m connector_runtime.main
python -m ai_runtime.main
```

### Desktop agents (HeySure-Device)

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

**Tip**: For the full experience (Docker Compose + all launchers), run `init-env.ps1` / `init-env.sh` once from the workspace root.

### Repository Structure (multi-repo)

This repository is now a **lightweight workspace** that orchestrates three independent repositories:

| Repository       | Local path | Purpose |
|------------------|------------|---------|
| HeySure-Web      | `web/`     | Vue 3 web console |
| HeySure-Server   | `server/`  | FastAPI gateway + 4 runtimes (shared api layer) |
| HeySure-Device   | `device/`  | Desktop agents (win/linux/mac) + browser extension + Android |

**First-time setup (recommended):**

```bat
# Windows
pwsh -File init-env.ps1

# or cross-platform
bash init-env.sh
```

This will clone the three component repos into `web/`, `server/`, and `device/`.

See [SPLIT_GUIDE.md](SPLIT_GUIDE.md) if you are performing or reproducing the original split from the monorepo.

After bootstrap:
- `docker compose up -d --build` and all `run*.bat` scripts work exactly as before.
- `clean.bat` / `clean.ps1` still works for heavy cleanup.

You must place a `.env` (copy from `.env.example`) in the **workspace root**.

### Keeping the workspace clean

```bat
clean.bat          # Windows
pwsh clean.ps1
```

This removes `node_modules`, `venv`, `dist`, build artifacts, etc. Re-install deps after cleaning.

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

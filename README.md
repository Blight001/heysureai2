<p align="center">
  <img src="server/static/extension.png" alt="Browser extension" width="160" />
  <img src="server/static/HeySure.png" alt="HeySure AI" width="160" />
  <img src="server/static/windows.png" alt="Windows agent" width="160" />
</p>

<p align="center">
  English | <a href="README.zh-CN.md">简体中文</a>
</p>

<h1 align="center">HeySure AI 2.0</h1>

<p align="center">
  A digital-society operating system for AI agent collaboration, governance, tool execution, and cross-platform access.
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

HeySure AI 2.0 is not a single chatbot. It is a runnable agent ecosystem that brings together a web console, backend gateway, AI runtime, MCP tool runtime, external connectors, desktop agents, and a browser extension.

The platform is designed so AI members can be created, configured, observed, coordinated, and given controlled access to tools. Over time, their work can be recorded into reusable knowledge, task history, and lifecycle archives.

The core idea is simple: AI should not only answer messages. It should become a governable, auditable, inheritable, and workflow-aware digital member.

## Contents

- [Key Features](#key-features)
- [Design Principles](#design-principles)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Development Commands](#development-commands)
- [MCP Tools](#mcp-tools)
- [Digital Society Model](#digital-society-model)
- [Roadmap](#roadmap)
- [Documentation](#documentation)
- [License](#license)

## Key Features

| Feature | Description |
| --- | --- |
| AI member governance | Create and manage AI members with model settings, roles, tool permissions, automation policies, and task flows. |
| Tool-based execution | Register and call tools through the MCP Runtime, including workspace, project, memory, task, conversation, and communication tools. |
| Multi-client access | Use the same backend from the web console, Windows desktop agent, Linux desktop agent, Chrome extension, QQ connector, and Feishu connector. |
| Real-time state | Share task progress, agent presence, runtime state, and chat updates through REST APIs and Socket.IO. |
| Knowledge inheritance | Convert conversations, tasks, outcomes, and agent lifecycle events into long-term reusable context. |

HeySure AI 2.0 uses a digital-society metaphor:

| Concept | Role |
| --- | --- |
| EvolutionArena | Tracks active AI members, tasks, status, and growth. |
| KnowledgeBase | Stores reusable experience distilled from real work. |
| Valhalla | Archives retired AI members, final reports, unfinished tasks, and handoff notes. |
| Archivist | A server-side core administrator that observes, records, summarizes, and preserves continuity. |

## Design Principles

| Principle | Meaning |
| --- | --- |
| Governable | AI members have identity, permissions, tasks, state, and lifecycle boundaries instead of being opaque model calls. |
| Traceable | Conversations, task runs, tool calls, configuration changes, and agent state can be recorded and audited. |
| Composable | Models, tools, connectors, frontend clients, and local agents are connected through stable interfaces. |
| Inheritable | Useful experience is preserved through knowledge entries, task records, and future agent context. |

## Architecture

```text
┌────────────────────────────────────────────────────────────────────┐
│                            Web Console                             │
│          AI config / Chat / Tasks / Dashboard / Admin views          │
└───────────────────────────────┬────────────────────────────────────┘
                                │ REST / Socket.IO
┌───────────────────────────────▼────────────────────────────────────┐
│                          API Gateway                               │
│      Auth, sessions, chat, projects, agents, static assets, APIs     │
└───────────────┬───────────────────┬───────────────────┬────────────┘
                │                   │                   │
                ▼                   ▼                   ▼
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│      AI Runtime      │  │     MCP Runtime      │  │  Connector Runtime   │
│ Queue / inference    │  │ Tools / permissions  │  │ Bots / dispatch      │
└──────────┬───────────┘  └──────────┬───────────┘  └──────────┬───────────┘
           │                         │                         │
           ▼                         ▼                         ▼
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│    Model Providers   │  │   Workspace / Data   │  │ Desktop / Browser    │
│ OpenAI-compatible    │  │ Projects / memory    │  │ Agents / extension   │
└──────────────────────┘  └──────────────────────┘  └──────────────────────┘
```

A typical AI task follows this path:

```text
User / external platform
  -> API Gateway
  -> AI Runtime
  -> MCP Runtime
  -> Connector / Agent
  -> persistence / state broadcast / knowledge capture
```

The model handles reasoning and decisions. The MCP Runtime enforces tool boundaries. The Connector Runtime connects the system to external platforms and endpoint agents. The Gateway provides the public entry point and state synchronization.

## Project Structure

| Path | Role |
| --- | --- |
| `web/` | Vue 3 + Vite console for home, chat, dashboard, AI configuration, tasks, and knowledge management. |
| `server/gateway/` | FastAPI + Socket.IO gateway exposing REST APIs, realtime events, and static assets. |
| `server/api/` | Shared models, database access, authentication, services, runtime helpers, and business logic. |
| `server/ai_runtime/` | AI worker for chat queues, inference calls, message persistence, and runtime status. |
| `server/mcp_runtime/` | MCP tool registration, plugin loading, permission checks, and internal tool calls. |
| `server/connector_runtime/` | QQ and Feishu bot connectors plus external agent dispatch. |
| `device/windows/` | Windows desktop client (shell) with window, screen, mouse, keyboard, clipboard, shell, and filesystem tools. |
| `device/linux/` | Linux desktop client (shell) with equivalent local automation capabilities. |
| `device/extension/` | Chrome MV3 browser extension for browser automation and lightweight client features. |
| `doc/` | Architecture notes, prompts, governance ideas, and system design documents. |

## Quick Start

### Option 1: Docker Compose

```bat
docker-run.bat
```

This is equivalent to:

```bat
docker compose up -d --build
```

| Service | URL |
| --- | --- |
| Web Console | `http://127.0.0.1:58150` |
| API Gateway | `http://127.0.0.1:3000` |
| Connector Runtime | `http://127.0.0.1:3002` |
| Postgres | Internal Compose service `db:5432` |

### Option 2: Local Windows Development

```bat
server\run.bat          :: start backend split services
web\run.bat             :: start the web console
device\windows\run.bat  :: start the Windows desktop client (shell)
```

Health check:

```text
http://127.0.0.1:3000/
```

The gateway is running when it returns:

```json
{"message":"HeySure Server is running"}
```

### Environment

Backend launch scripts read the root `.env` file. Common variables:

```env
DATABASE_URL=postgresql+psycopg://heysure:heysure@127.0.0.1:5432/heysure
HEYSURE_INTERNAL_TOKEN=heysure-dev-internal-token-change-me
MCP_RUNTIME_URL=http://127.0.0.1:3001
CONNECTOR_RUNTIME_URL=http://127.0.0.1:3002
AI_RUNTIME_URL=http://127.0.0.1:3003
AI_DISPATCH_MODE=remote
```

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL connection string. Startup fails if it is missing or uses another database. |
| `HEYSURE_INTERNAL_TOKEN` | Bearer token used by the gateway when calling internal runtime `/internal/*` endpoints. |
| `MCP_RUNTIME_URL` | MCP runtime URL. Defaults to `http://127.0.0.1:3001`. |
| `CONNECTOR_RUNTIME_URL` | Connector runtime URL. Defaults to `http://127.0.0.1:3002`. |
| `AI_RUNTIME_URL` | AI runtime status service URL. Usually `http://127.0.0.1:3003`. |
| `AI_DISPATCH_MODE` | Use `remote` to send chat tasks to the queue consumed by `ai_runtime`. |

See `server/api/core/settings.py` for the full configuration surface.

## Development Commands

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
venv\Scripts\activate
pip install -r requirements.txt
python -m gateway.main
```

Start split runtimes manually:

```bat
python -m mcp_runtime.main
python -m connector_runtime.main
python -m ai_runtime.main
```

### Windows Client (device)

```bat
cd device\windows
npm install
npm run dev
npm run build
```

Package the Windows client:

```bat
device\windows\build.bat
```

### Linux Client (device)

```sh
cd device/linux
npm install
npm run dev
npm run build
```

### Browser Extension

```bat
cd device\extension
npm install
npm run build
```

Then open Chrome Extensions and load `device/extension/` as an unpacked extension.

## MCP Tools

The MCP Runtime centralizes tool registration, invocation, and permission boundaries.

| Tool | Capability |
| --- | --- |
| `workspace` | Workspace and file context. |
| `projects` | Project management. |
| `tasks` | Task system. |
| `memory` | Memory and long-term context. |
| `librarian` | Knowledge capture and review. |
| `conversation` | Conversation lookup, management, and context operations. |
| `communication` | Communication between AI members. |
| `web_search` | Web search. |
| `introspection` | Runtime introspection. |

The platform separates configured capabilities from capabilities allowed for a specific run. AI configuration defines the theoretical permission set, runtime context narrows it for a session or task, MCP execution validates registration and authorization before tool calls, and endpoint agents or connectors handle higher-risk actions.

## Digital Society Model

HeySure AI 2.0 treats agents as digital members with lifecycle state.

| Stage | System behavior |
| --- | --- |
| Creation | Assign identity, role, model configuration, tool permissions, and initial tasks. |
| Onboarding | Build context from prompts, KnowledgeBase entries, task history, and administrator configuration. |
| Execution | Complete work through chat runtime, MCP tools, desktop agents, browser extension, or external bots. |
| Observation | Record heartbeats, messages, tool calls, task progress, failures, and resource usage. |
| Summarization | Distill successful patterns, failure causes, and reusable experience into the knowledge system. |
| Handoff | Preserve reports, final notes, unfinished work, and next-step recommendations when an agent exits. |

The `Archivist` core administrator is responsible for observation, guidance, summarization, and continuity so each run can become a reusable system asset.

## Roadmap

| Stage | Goal |
| --- | --- |
| Foundation | Stabilize the base links between Web, Gateway, AI Runtime, MCP Runtime, and Connector Runtime. |
| Observability | Add complete `detected / parsed / authorized / executing / completed / failed` tracking for MCP calls. |
| Governance | Complete prompt layering, runtime tool-permission narrowing, and high-risk action boundaries. |
| Memory | Connect task records, conversation summaries, knowledge entries, and lifecycle archives into long-term memory. |
| Evolution | Introduce skills, hooks, and automated task orchestration for controlled agent evolution. |

## Documentation

> New here and wondering "where do I change X"? Start with [`CLAUDE.md`](CLAUDE.md) — the project navigation map for contributors and Claude Code (architecture, ports, common commands, a "where to change X" lookup, and conventions). Each module has its own `CLAUDE.md` too.

| Document | Content |
| --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | **Navigation entry point**: architecture / ports / commands / "where to change X" / conventions. |
| [`server/CLAUDE.md`](server/CLAUDE.md) | Backend map: shared layer + 4 processes, `api/` layering, change lookup. |
| [`web/CLAUDE.md`](web/CLAUDE.md) | Frontend map: directory responsibilities and change lookup. |
| [`device/CLAUDE.md`](device/CLAUDE.md) | Device map: the three client shells and the win/linux duplication notes. |
| `server/README.md` | Backend service layout, local startup, environment variables, and runtime ports. |
| `device/linux/README.md` | Linux desktop client (shell) notes. |
| `device/extension/README.md` | Browser extension notes. |
| `doc/prompt/` | Prompts for core administrator, assistant administrator, desktop assistant, browser assistant, and MCP tool calling. |

## License

This project is licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.

---

<p align="center">
  <sub>HeySure AI 2.0 · Governable and inheritable AI agents for real workflows</sub>
</p>

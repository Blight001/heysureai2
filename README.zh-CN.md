<p align="center">
  <img src="server/static/extension.png" alt="浏览器扩展" width="160" />
  <img src="server/static/HeySure.png" alt="HeySure AI" width="160" />
  <img src="server/static/windows.png" alt="桌面端" width="160" />
</p>

<p align="center">
  <a href="README.md">English</a> | 简体中文
</p>

<h1 align="center">HeySure AI 2.0</h1>

<p align="center">
  面向 AI 协作、治理、工具执行与跨端接入的“数字社会”操作系统。
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

## 概览

HeySure AI 2.0 不是单一聊天机器人，而是一套可运行的 Agent 生态系统，包含：

- Web 控制台，用于配置和运维
- FastAPI 网关，用于公开 API 和实时状态同步
- AI Runtime，用于推理与任务分发
- MCP Runtime，用于工具注册和权限控制
- Connector Runtime，用于对接外部平台
- Windows / Linux / macOS 桌面端
- Chrome 浏览器扩展
- Android 端设备

平台的目标是让 AI 成员可以被创建、配置、观察、协同，并获得受控的工具访问能力。随着运行，聊天、任务、工具调用和生命周期事件会沉淀为可复用的知识与审计记录。

## 目录

- [核心特性](#核心特性)
- [设计原则](#设计原则)
- [系统架构](#系统架构)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [开发方式](#开发方式)
- [环境变量](#环境变量)
- [文档入口](#文档入口)
- [许可证](#许可证)

## 核心特性

| 特性 | 说明 |
| --- | --- |
| AI 成员治理 | 创建和管理 AI 成员，配置模型、角色、工具权限与任务流。 |
| 基于工具的执行 | 通过 MCP Runtime 注册和调用工具，覆盖工作区、记忆、任务、对话与通信能力。 |
| 多端接入 | 同一后端同时服务 Web 控制台、桌面端、浏览器扩展、Android 端、QQ 连接器和飞书连接器。 |
| 实时状态 | 通过 REST API 和 Socket.IO 同步任务进度、在线状态、运行状态与聊天更新。 |
| 知识继承 | 将对话、任务、结果和生命周期事件沉淀为长期可复用上下文。 |

## 设计原则

| 原则 | 含义 |
| --- | --- |
| 可治理 | AI 成员拥有身份、权限、任务、状态与生命周期边界，而不是黑盒模型调用。 |
| 可追溯 | 对话、任务运行、工具调用和配置变更都可以记录与审计。 |
| 可组合 | 模型、工具、连接器、前端和本地端点通过稳定接口协同。 |
| 可传承 | 有价值的经验会通过知识条目、任务记录和后续上下文继续发挥作用。 |

## 系统架构

```text
Web Console
  -> API Gateway
  -> AI Runtime
  -> MCP Runtime
  -> Connector Runtime
  -> Desktop / Browser / Android 端点
  -> 持久化 / 状态广播 / 知识沉淀
```

一条典型的 AI 任务路径如下：

```text
用户 / 外部平台
  -> API Gateway
  -> AI Runtime
  -> MCP Runtime
  -> Connector / Agent
  -> 持久化 / 状态广播 / 知识沉淀
```

## 项目结构

| 路径 | 作用 |
| --- | --- |
| `web/` | Vue 3 + Vite Web 控制台。 |
| `server/main/gateway/` | FastAPI + Socket.IO 网关，提供 REST API、实时事件和静态资源。 |
| `server/main/api/` | 通用模型、数据库访问、认证、服务层、运行时辅助与业务逻辑。 |
| `server/main/ai_runtime/` | 聊天队列消费、推理调用、消息持久化与运行状态。 |
| `server/main/mcp_runtime/` | MCP 工具注册、插件加载、权限检查与内部工具调用。 |
| `server/main/connector_runtime/` | QQ、飞书机器人以及外部 Agent 调度。 |
| `server/other/` | Alembic 迁移、辅助脚本和 pytest 测试。 |
| `device/windows/` | Windows 桌面端。 |
| `device/linux/` | Linux 桌面端。 |
| `device/mac/` | macOS 桌面端。 |
| `device/extension/` | Chrome MV3 浏览器扩展。 |
| `device/android/` | Android 端应用和可选的 ADB 控制器。 |
| `device/shared/` | 桌面端共享源码、脚本和资源。 |
| `doc/` | 架构说明、Prompt 设计、治理思路和系统设计文档。 |

## 快速开始

### Docker Compose

```bat
docker-run.bat
```

等价于：

```bat
docker compose up -d --build
```

| 服务 | 地址 |
| --- | --- |
| Web 控制台 | `http://127.0.0.1:58150` |
| API Gateway | `http://127.0.0.1:3000` |
| Connector Runtime | `http://127.0.0.1:3002` |
| Postgres | Compose 内部服务 `db:5432` |

### 本地 Windows 开发

```bat
server\run.bat
web\run.bat
device\windows\run.bat
```

健康检查：

```text
http://127.0.0.1:3000/
```

若返回以下内容，说明网关正常：

```json
{"message":"HeySure Server is running"}
```

## 环境变量

后端启动脚本会读取仓库根目录的 `.env`。常用变量如下：

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

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | 必填的 PostgreSQL 连接串。如果缺失，或指向其它数据库，启动会失败。 |
| `HEYSURE_INTERNAL_TOKEN` | Gateway 调用内部 runtime `/internal/*` 接口时使用的 token。 |
| `MCP_RUNTIME_URL` | MCP Runtime 地址。 |
| `CONNECTOR_RUNTIME_URL` | Connector Runtime 地址。 |
| `AI_RUNTIME_URL` | AI Runtime 状态服务地址。 |
| `AI_DISPATCH_MODE` | 设为 `remote` 时，聊天任务会进入 `ai_runtime` 消费的队列。 |
| `SERVER_URL` | Web 应用和设备端客户端使用的后端地址。 |
| `WORKSPACE_ROOT` | 桌面端和 Android 端的工作区目录。 |

完整配置入口见 `server/main/api/core/settings.py`。

## 开发方式

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

单独启动拆分后的 runtime：

```bat
python -m mcp_runtime.main
python -m connector_runtime.main
python -m ai_runtime.main
```

### 桌面端

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

### 浏览器扩展

```bat
cd device\extension
npm install
npm run build
```

## 文档入口

- 后端说明：[`server/README.md`](server/README.md)
- Windows 桌面端：[`device/windows/README.md`](device/windows/README.md)
- Linux 桌面端：[`device/linux/README.md`](device/linux/README.md)
- macOS 桌面端：[`device/mac/README.md`](device/mac/README.md)
- 浏览器扩展：[`device/extension/README.md`](device/extension/README.md)
- Android 端：[`device/android/README.md`](device/android/README.md)
- 桌面端共享源码：[`device/shared/README.md`](device/shared/README.md)

## 许可证

Apache-2.0

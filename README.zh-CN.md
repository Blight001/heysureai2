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

- Web 控制台，用于配置和运维，内置实时像素风“Agent 世界”视图
- FastAPI 网关，用于公开 API 和实时状态同步
- AI Runtime，用于推理与任务分发
- MCP Runtime，用于工具注册和权限控制
- Connector Runtime，用于对接外部平台，并中继端侧 WebRTC 远程控制
- Windows（Tauri）/ Linux（Electron）/ macOS（Electron）桌面端
- 两款 Chrome 浏览器扩展
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
| 知识工坊 | 图书管理员 Agent 负责审核提议知识、归档为可检索的主题，并可从 ClawHub 安装共享技能。 |
| 远程控制 | 基于 WebRTC 的屏幕与键鼠远程控制，覆盖 Windows、Android 与浏览器端，STUN/TURN 中继服务器可在服务端配置。 |
| Agent 世界 | 像素风视图（`web/game/`），将 AI 成员、作坊与知识事件实时渲染成一个持续运行的世界。 |
| 自助运维 | 管理员可在控制台内触发基于 Git 的仓库更新，以及数据库的完整备份与恢复。 |

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

远程控制会话经 Connector Runtime 通过 Socket.IO 完成信令协商；协商完成后，画面与键鼠数据直接走点对点 WebRTC。

## 项目结构

本项目采用**多仓库**结构。工作区根目录仅保留编排文件。

| 路径（init 后） | 作用 |
| --- | --- |
| `web/`     | HeySure-Web：Vue 3 Web 控制台（独立仓库） |
| `server/`  | HeySure-Server：全部后端代码（独立仓库） |
| `device/`  | HeySure-Device：全部端侧客户端（独立仓库） |
| `doc/`     | 架构与设计文档（保留在工作区） |

各组件仓库内部有自己的 `README.md` 和 `CLAUDE.md`。

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

重装系统后，先确认以下必需环境：

- Python：推荐 Python 3.11 或 3.12（[下载](https://www.python.org/downloads/windows/)，安装时勾选 `Add python.exe to PATH`）
- PostgreSQL：推荐 PostgreSQL 16（[下载](https://www.postgresql.org/download/windows/)）
- Node.js：推荐 Node.js 22 LTS 或更新的 LTS 版本（[下载](https://nodejs.org/en/download)）

安装 PostgreSQL 后，创建项目默认用户和数据库：

```sql
CREATE USER heysure WITH PASSWORD 'heysure';
CREATE DATABASE heysure OWNER heysure;
```

如果用户已存在，可以只重置密码：

```sql
ALTER USER heysure WITH PASSWORD 'heysure';
```

环境就绪后，拉取子模块并启动：

```bat
# 首次（或需要刷新组件时）执行
git submodule update --init --recursive

windows-run.bat
server\run.bat
web\run.bat
device\windows\run.bat
```

`windows-run.bat` 会打开后台管理面板（`server/tk_launcher.py`），提供三个按钮：

- `安装依赖`：安装后台 Python 依赖
- `环境检查`：检查 Python、后台虚拟环境、PostgreSQL、Node.js、npm、前端依赖
- `全部启动`：启动 gateway、mcp、connector、ai、web

健康检查：

```text
http://127.0.0.1:3000/
```

若返回以下内容，说明网关正常：

```json
{"message":"HeySure Server is running"}
```

## 环境变量

后端启动脚本读取**工作区根目录**的 `.env`（与 `docker-compose.yml` 同级）。

请复制 `.env.example` 为 `.env` 并填写。常用变量如下：

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

单独启动拆分后的 runtime（在 server/ 目录下）：

```bat
python -m mcp_runtime.main
python -m connector_runtime.main
python -m ai_runtime.main
```

### 桌面端 (HeySure-Device)

```bat
device\windows\run.bat
device\linux\run.sh
device\mac\run.sh
```

Windows 现为 Tauri 2 应用（Rust + WebView2），不再是 Electron；Linux / macOS 仍为 Electron。构建 Windows 壳需要额外的 Rust 工具链和 Visual Studio Build Tools，详见 [`device/windows/README.md`](device/windows/README.md)。

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

另有一款免构建的扩展 [`device/browser_automation/`](device/browser_automation/README.md)，专注自动化卡片与 Cookie 抓取，在 Chrome 扩展页直接「加载已解压的扩展程序」即可。

**提示**：子模块初始化后即可正常使用 Docker Compose 和启动脚本。

### 仓库结构（多仓库）

本仓库现在是一个**轻量级工作区（workspace）**，用于编排三个独立仓库：

| 仓库            | 本地路径   | 用途 |
|-----------------|------------|------|
| HeySure-Web     | `web/`     | Vue 3 Web 控制台 |
| HeySure-Server  | `server/`  | 后端网关 + 4 个 runtime（共享 api 层） |
| HeySure-Device  | `device/`  | 桌面端（win/linux/mac）+ 两款浏览器扩展 + Android |

**首次初始化（Git 子模块）：**

```bat
# 推荐方式，一次性带子模块克隆
git clone --recurse-submodules <工作区仓库地址>

# 如果已经普通 clone 了：
git submodule update --init --recursive
```

这样 web/ server/ device/ 会从三个独立仓库（HeySure-Web/Server/Device）拉取进来。

之后 docker compose 和各种启动脚本即可正常工作。

`.env` 请放在工作区根目录（从 `.env.example` 复制）。

旧的 `init-env.ps1` / `init-env.sh` 已不再需要（仅作参考保留）。

之后 `docker compose` 和所有启动脚本的行为和原来 monorepo 时完全一致。

### 清理工作区

```bat
clean.bat          # Windows
pwsh clean.ps1
```

会删除 node_modules、venv、dist 等生成物。清理后需重新安装依赖。

## 文档入口

- 后端说明：[`server/README.md`](server/README.md)
- Windows 桌面端：[`device/windows/README.md`](device/windows/README.md)
- Linux 桌面端：[`device/linux/README.md`](device/linux/README.md)
- macOS 桌面端：[`device/mac/README.md`](device/mac/README.md)
- 浏览器扩展（完整 Agent）：[`device/extension/README.md`](device/extension/README.md)
- 浏览器自动化插件：[`device/browser_automation/README.md`](device/browser_automation/README.md)
- Android 端：[`device/android/README.md`](device/android/README.md)
- Agent 世界（控制台内嵌游戏视图）：[`web/game/README.md`](web/game/README.md)

## 许可证

Apache-2.0

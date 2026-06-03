<p align="center">
  <img src="server/static/extension.png" alt="extension.png" width="160" />
  <img src="server/static/HeySure.png" alt="HeySure AI" width="160" />
  <img src="server/static/windows.png" alt="windows.png" width="160" />
</p>

<h1 align="center">HeySure AI 2.0</h1>

<p align="center">
  面向 AI Agent 协作、治理、工具执行与跨端接入的数字社会操作系统
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Vue-3-42b883?logo=vue.js&logoColor=white" alt="Vue 3" />
  <img src="https://img.shields.io/badge/FastAPI-Gateway-009688?logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Python-3.9+-3776ab?logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/Socket.IO-Realtime-010101?logo=socket.io&logoColor=white" alt="Socket.IO" />
  <img src="https://img.shields.io/badge/Docker-Compose-2496ed?logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/MCP-Runtime-7c3aed" alt="MCP Runtime" />
</p>

---

## 📖 简介

HeySure AI 2.0 不是单一聊天机器人，而是一套可运行的 **Agent 生态平台**。它把 Web 控制台、后端网关、AI 推理队列、MCP 工具运行时、外部连接器、Windows 桌面 Agent 与浏览器扩展组织在同一个体系内，让 AI 成员可以被 **创建、配置、观察、协作、调用工具**，并在长期运行中沉淀知识与经验。

核心目标：让 AI 不只是回答问题，而是成为 **可管理、可审计、可传承、可接入现实工作流** 的数字成员。

## 🧭 目录

- [核心能力](#-核心能力)
- [设计原则](#-设计原则)
- [系统架构](#-系统架构)
- [核心模块](#-核心模块)
- [快速启动](#-快速启动)
- [开发命令](#-开发命令)
- [MCP 工具](#-mcp-工具)
- [数字社会](#-数字社会)
- [演进路线](#-演进路线)
- [文档索引](#-文档索引)

## ✨ 核心能力

| 能力 | 说明 |
| --- | --- |
| 🧑‍💼 AI 成员治理 | 创建与管理 AI 成员，配置模型、角色、工具权限、自动控制策略与任务流 |
| 🛠️ 工具化执行 | 通过 MCP Runtime 注册和调用工具，覆盖工作区、项目、记忆、任务、会话与通信 |
| 🌐 多端接入 | Web 控制台、Windows 桌面 Agent、Chrome 扩展、QQ / 飞书连接器共享同一套后端 |

系统采用「数字社会」架构隐喻：

- **EvolutionArena** — 记录活跃 AI 的状态、任务与成长过程
- **KnowledgeBase** — 将实践经验压缩为可复用知识
- **Valhalla** — 归档退场 AI 的遗言、未竟事项与传承信息
- **Archivist** — 运行在服务端的核心管理员，负责观察、记录、总结与传承

## 🎯 设计原则

| 原则 | 含义 |
| --- | --- |
| 可治理 | AI 成员拥有身份、权限、任务、状态和生命周期，而非黑盒调用 |
| 可追溯 | 对话、任务、工具调用、配置变更与 Agent 状态均可记录、回放和审计 |
| 可组合 | 模型、工具、连接器、前端入口和本机 Agent 通过稳定协议解耦组合 |
| 可传承 | 运行经验沉淀进知识库、任务记录与后续 Agent 的上下文 |

## 🏗️ 系统架构

```text
┌────────────────────────────────────────────────────────────────────┐
│                            Web Console                             │
│                 AI 配置 / 对话 / 任务 / Dashboard / 管理视图          │
└───────────────────────────────┬────────────────────────────────────┘
                                │ REST / Socket.IO
┌───────────────────────────────▼────────────────────────────────────┐
│                          API Gateway                               │
│           认证、会话、聊天、项目、Agent 管理、静态资源、统一入口       │
└───────────────┬───────────────────┬───────────────────┬────────────┘
                │                   │                   │
                ▼                   ▼                   ▼
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│      AI Runtime      │  │     MCP Runtime      │  │  Connector Runtime   │
│  队列消费 / 推理执行  │  │ 工具注册 / 权限 / 调用 │  │ QQ / 飞书 / Agent 调度 │
└──────────┬───────────┘  └──────────┬───────────┘  └──────────┬───────────┘
           │                         │                         │
           ▼                         ▼                         ▼
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│    Model Providers   │  │   Workspace / Data   │  │ Desktop / Browser    │
│ OpenAI-compatible 等 │  │ 项目、记忆、任务、文件 │  │ Windows Agent / 扩展   │
└──────────────────────┘  └──────────────────────┘  └──────────────────────┘
```

一次典型 AI 任务的运行链路：

```text
用户 / 外部平台 → API Gateway → AI Runtime → MCP Runtime → Connector / Agent → 持久化 / 状态广播 / 知识沉淀
```

模型负责推理与决策，MCP Runtime 负责工具边界，Connector Runtime 负责连接外部世界，Gateway 负责统一入口和状态同步。

## 🧩 核心模块

| 路径 | 角色 |
| --- | --- |
| `web/` | Vue 3 + Vite 控制台：首页、对话、Dashboard、AI 配置、任务与知识管理 |
| `server/gateway/` | FastAPI + Socket.IO 网关，对外暴露 REST API、实时事件和静态资源 |
| `server/api/` | 共享模型、数据库、认证、服务层、运行时辅助与业务逻辑 |
| `server/ai_runtime/` | AI worker：聊天队列、推理调用、消息落库与运行状态 |
| `server/mcp_runtime/` | MCP 工具注册、插件加载、工具权限与内部调用入口 |
| `server/connector_runtime/` | QQ、飞书等机器人连接器与外部 Agent 调度 |
| `agent/windows/` | Windows 桌面 Agent：窗口、屏幕、鼠标、键盘、剪贴板、Shell、文件等本机能力 |
| `agent/extension/` | Chrome MV3 浏览器扩展，支持浏览器自动化与轻量客户端能力 |
| `doc/` | 系统理念、架构路线、对话区、权限分层与 Prompt 设计文档 |

## 🚀 快速启动

### 方式一：Docker Compose（推荐）

```bat
docker-run.bat
```

> 等价于 `docker compose up -d --build`

| 服务 | 地址 |
| --- | --- |
| Web Console | `http://127.0.0.1:58150` |
| API Gateway | `http://127.0.0.1:3000` |
| Connector Runtime | `http://127.0.0.1:3002` |
| Postgres | Compose 内部服务 `db:5432` |

### 方式二：本地 Windows 开发

```bat
server\run.bat          :: 启动后端拆分服务
web\run.bat             :: 启动 Web 控制台
agent\windows\run.bat   :: 启动 Windows 桌面 Agent
```

> 健康检查：访问 `http://127.0.0.1:3000/`，返回 `{"message":"HeySure Server is running"}` 表示 Gateway 正常。

### 环境配置

根目录 `.env` 会被后端启动脚本读取，常用变量：

```env
DATABASE_URL=postgresql+psycopg://heysure:heysure@127.0.0.1:5432/heysure
HEYSURE_INTERNAL_TOKEN=heysure-dev-internal-token-change-me
MCP_RUNTIME_URL=http://127.0.0.1:3001
CONNECTOR_RUNTIME_URL=http://127.0.0.1:3002
AI_RUNTIME_URL=http://127.0.0.1:3003
AI_DISPATCH_MODE=remote
```

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | 数据库连接，未配置时可回退到本地 SQLite |
| `HEYSURE_INTERNAL_TOKEN` | Gateway 访问内部 runtime `/internal/*` 接口的令牌 |
| `AI_DISPATCH_MODE` | `remote` 表示聊天任务进入队列，由 AI Runtime 消费 |

完整配置见 `server/api/core/settings.py`。

## 💻 开发命令

<details>
<summary><b>Web</b></summary>

```bat
cd web
npm install
npm run dev
npm run build
```
</details>

<details>
<summary><b>Server</b></summary>

```bat
cd server
venv\Scripts\activate
pip install -r requirements.txt
python -m gateway.main

:: 单独启动内部 runtime
python -m mcp_runtime.main
python -m connector_runtime.main
python -m ai_runtime.main
```
</details>

<details>
<summary><b>Windows Agent</b></summary>

```bat
cd agent\windows
npm install
npm run dev
npm run build

:: 一键打包
agent\windows\build.bat
```
</details>

<details>
<summary><b>Browser Extension</b></summary>

```bat
cd agent\extension
npm install
npm run build
```

随后在 Chrome 扩展页面选择「加载已解压的扩展程序」，加载 `agent/extension/` 目录。
</details>

## 🔌 MCP 工具

MCP Runtime 统一管理工具的注册、调用和权限边界，当前覆盖：

| 工具 | 能力 |
| --- | --- |
| `workspace` | 工作区与文件上下文 |
| `projects` | 项目管理 |
| `tasks` | 任务系统 |
| `memory` | 记忆与长期上下文 |
| `librarian` | 知识管理员与知识沉淀 |
| `conversation` | 会话检索、管理与上下文操作 |
| `communication` | AI 间通信 |
| `web_search` | 网络搜索 |
| `introspection` | 运行时自省 |

平台将「能配置的能力」与「本轮实际允许的能力」分层处理：AI 配置层定义理论权限，运行上下文层按会话与任务收窄，MCP 执行层在调用前完成注册匹配、权限校验与参数解析，外部执行层由独立 Agent / Connector 承接高风险动作。

## 🌍 数字社会

HeySure AI 2.0 将 Agent 视为拥有生命周期的数字成员：

| 阶段 | 系统动作 |
| --- | --- |
| 创建 | 分配身份、角色、模型配置、工具权限与初始任务 |
| 入职 | 从 Prompt、KnowledgeBase、历史任务与管理员配置中获取上下文 |
| 执行 | 通过聊天运行时、MCP 工具、桌面 Agent、浏览器扩展或外部机器人完成任务 |
| 观察 | 记录心跳、消息、工具调用、任务进度、异常与资源消耗 |
| 总结 | 将成功模式、失败原因与可复用经验沉淀到知识系统 |
| 交接 | 在任务结束或 Agent 退场时保留报告、遗言与后续建议 |

核心管理员 `Archivist` 负责观察、指引、总结与传承，让每次执行都成为可复盘、可继承的系统资产。

## 🛣️ 演进路线

| 阶段 | 目标 |
| --- | --- |
| Foundation | 稳定 Web、Gateway、AI Runtime、MCP Runtime、Connector Runtime 的基础链路 |
| Observability | 为 MCP 调用补齐 `detected / parsed / authorized / executing / completed / failed` 状态追踪 |
| Governance | 完成 Prompt 分层、工具权限运行时分层与高风险操作边界 |
| Memory | 将任务记录、会话摘要、知识库与生命周期档案连接成长期记忆系统 |
| Evolution | 引入 skill / hook / 自动任务编排，让 Agent 在受控环境中持续演进 |

> 核心判断：Agent 系统的上限不只取决于模型能力，更取决于上下文组织、工具边界、执行可观测性与失败后的复盘机制。

## 📚 文档索引

| 文档 | 内容 |
| --- | --- |
| `doc/项目升级计划.md` | 升级计划总文档，含数字社会核心管理员、沉淀技能卡片、浏览器 MCP 工具整理（第四章）、Claude Code 集成-权限分层设计等各章节方案 |
| `doc/prompt/` | 核心管理员、辅助管理员、桌面助手、浏览器助手、MCP 工具调用等 Prompt |

## 📄 许可证

当前仓库尚未声明开源许可证。对外分发或商业使用前，请先补充明确的 License。

---

<p align="center">
  <sub>HeySure AI 2.0 · 让 AI 成为可治理、可传承的数字成员</sub>
</p>

# HeySure AI 2.0

<p align="center">
  <img src="web/src/assets/logo/HeySure.png" alt="HeySure AI" width="180" />
</p>

> 一个面向 AI Agent 协作、治理、工具执行与跨端接入的数字社会操作系统。

HeySure AI 2.0 不是单一聊天机器人，而是一套可运行的 Agent 生态平台。它把 Web 控制台、后端网关、AI 推理队列、MCP 工具运行时、外部连接器、Windows 桌面 Agent 与浏览器扩展组织在同一个体系内，让 AI 成员可以被创建、配置、观察、协作、调用工具，并在长期运行中沉淀知识与经验。

系统设计参考 `doc/` 中的数字社会、核心管理员、MCP 执行链路、机器人对话区与工程优化文档。项目的核心目标是：让 AI 不只是回答问题，而是成为可管理、可审计、可传承、可接入现实工作流的数字成员。

## 项目定位

HeySure AI 2.0 面向三类能力：

| 能力 | 说明 |
| --- | --- |
| AI 成员治理 | 创建和管理不同 AI 成员，配置模型、角色、工具权限、自动控制策略与任务流 |
| 工具化执行 | 通过 MCP Runtime 注册和调用工具，支持工作区、项目、记忆、任务、会话、通信等能力 |
| 多端接入 | Web 控制台、Windows 桌面 Agent、Chrome 扩展、QQ / 飞书等连接器接入同一套后端 |

在产品叙事上，它采用“数字社会”的架构隐喻：

- `EvolutionArena`：记录活跃 AI 的状态、任务与成长过程
- `KnowledgeBase`：将实践中的经验压缩为可复用知识
- `Valhalla`：归档退场 AI 的遗言、未竟事项与传承信息
- `Archivist`：运行在服务端的核心管理员，负责观察、记录、总结与传承

## 设计原则

HeySure AI 2.0 的系统设计遵循四个原则：

| 原则 | 含义 |
| --- | --- |
| 可治理 | AI 成员不是黑盒调用，而是拥有身份、权限、任务、状态和生命周期的运行实体 |
| 可追溯 | 对话、任务、工具调用、配置变更和 Agent 状态都应能被记录、回放和审计 |
| 可组合 | 模型、工具、连接器、前端入口和本机 Agent 相互解耦，通过稳定协议组合 |
| 可传承 | 运行中产生的经验不会停留在一次对话里，而会进入知识库、任务记录和后续 Agent 的上下文 |

这意味着系统关注的不只是“让 AI 能回答”，而是“让 AI 能进入组织化工作流，并在长期运行中变得更可靠”。

## 系统架构

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

## 运行链路

一次典型的 AI 任务会穿过以下链路：

```text
用户 / 外部平台
    │
    ▼
API Gateway
    │  创建会话、落库消息、发布实时事件
    ▼
AI Runtime
    │  组装 Prompt、加载上下文、调用模型、解析工具意图
    ▼
MCP Runtime
    │  校验权限、执行工具、返回结构化结果
    ▼
Connector / Agent
    │  需要时调度桌面、浏览器、QQ、飞书等外部执行端
    ▼
消息持久化 / 状态广播 / 知识沉淀
```

这条链路把“模型生成文本”和“系统执行动作”分开处理：模型负责推理与决策，MCP Runtime 负责工具边界，Connector Runtime 负责连接外部世界，Gateway 负责统一入口和状态同步。

## 核心模块

| 路径 | 角色 |
| --- | --- |
| `web/` | Vue 3 + Vite 控制台，提供首页、对话、Dashboard、AI 配置、任务与知识管理界面 |
| `server/gateway/` | FastAPI + Socket.IO 网关，对外暴露 REST API、实时事件和静态资源 |
| `server/api/` | 共享模型、数据库、认证、服务层、运行时辅助和业务逻辑 |
| `server/ai_runtime/` | AI worker，负责聊天队列、推理调用、消息落库和运行状态 |
| `server/mcp_runtime/` | MCP 工具注册、插件加载、工具权限与内部调用入口 |
| `server/connector_runtime/` | QQ、飞书等机器人连接器，以及外部 Agent 调度 |
| `agent/windows/` | Windows 桌面 Agent，具备窗口、屏幕、鼠标、键盘、剪贴板、Shell、文件等本机工具能力 |
| `agent/extension/` | Chrome MV3 浏览器扩展，支持浏览器自动化工具与轻量客户端能力 |
| `doc/` | 系统理念、架构路线、机器人对话区、权限分层与 Prompt 设计文档 |

## 主要特性

- 多 AI 成员管理：支持成员创建、模型配置、角色配置、头像、任务和状态管理
- 分进程后端：Gateway、AI Runtime、MCP Runtime、Connector Runtime 按职责拆分
- MCP 工具体系：内置工作区、项目、任务、记忆、知识管理员、通信、会话等工具
- 实时通信：通过 Socket.IO 支撑 Web、桌面 Agent、浏览器扩展和连接器之间的事件流
- 多渠道机器人：支持 QQ、飞书等外部渠道接入，并将对话纳入统一运行链路
- 桌面自动化：Windows Agent 可执行屏幕、窗口、鼠标、键盘、Shell、文件系统等操作
- 浏览器自动化：Chrome 扩展可执行导航、点击、输入、滚动、提取、截图等网页任务
- 数字社会治理：通过 EvolutionArena、KnowledgeBase、Valhalla 组织 AI 生命周期与知识传承

## Agent 生命周期

HeySure AI 2.0 将 Agent 视为拥有生命周期的数字成员，而不是一次性函数调用。

| 阶段 | 系统动作 |
| --- | --- |
| 创建 | 分配身份、角色、模型配置、工具权限和初始任务 |
| 入职 | 从 Prompt、KnowledgeBase、历史任务和管理员配置中获取上下文 |
| 执行 | 通过聊天运行时、MCP 工具、桌面 Agent、浏览器扩展或外部机器人完成任务 |
| 观察 | 记录心跳、消息、工具调用、任务进度、异常和资源消耗 |
| 总结 | 将成功模式、失败原因和可复用经验沉淀到知识系统 |
| 交接 | 在任务结束、配置变更或 Agent 退场时保留报告、遗言和后续建议 |

这个生命周期设计为后续的自动任务编排、AI 间协作、技能系统、Hook 机制和长期记忆提供基础。

## 治理与权限

平台将“能配置的能力”和“本轮实际允许的能力”区分开来：

- AI 配置层：定义某个 AI 理论上可以使用哪些模型、工具和连接器
- 运行上下文层：根据当前会话、任务、用户身份和系统策略收窄本轮权限
- MCP 执行层：在工具真正执行前进行注册表匹配、权限校验和参数解析
- 外部执行层：桌面、浏览器、机器人等高风险动作由独立 Agent 或 Connector 承接

这种分层让系统可以逐步支持更细的权限策略，例如只读工具、危险操作二次确认、按任务授予工具、按 Agent 限制工作区，以及对所有工具调用进行可观测记录。

## 快速启动

### 方式一：Docker Compose

适合完整体验分进程部署：

```bat
docker-run.bat
```

等价于：

```bat
docker compose up -d --build
```

默认服务：

| 服务 | 地址 |
| --- | --- |
| Web Console | `http://127.0.0.1:58150` |
| API Gateway | `http://127.0.0.1:3000` |
| Connector Runtime | `http://127.0.0.1:3002` |
| Postgres | Compose 内部服务 `db:5432` |

### 方式二：本地 Windows 开发

启动后端拆分服务：

```bat
server\run.bat
```

启动 Web 控制台：

```bat
web\run.bat
```

启动 Windows 桌面 Agent：

```bat
agent\windows\run.bat
```

后端健康检查：

```text
http://127.0.0.1:3000/
```

返回 `{"message":"HeySure Server is running"}` 表示 API Gateway 正常。

## 环境配置

根目录 `.env` 会被后端启动脚本读取。常用配置：

```env
DATABASE_URL=postgresql+psycopg://heysure:heysure@127.0.0.1:5432/heysure
HEYSURE_INTERNAL_TOKEN=heysure-dev-internal-token-change-me
MCP_RUNTIME_URL=http://127.0.0.1:3001
CONNECTOR_RUNTIME_URL=http://127.0.0.1:3002
AI_RUNTIME_URL=http://127.0.0.1:3003
AI_DISPATCH_MODE=remote
```

关键变量：

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | 数据库连接。未配置时后端可回退到本地 SQLite |
| `HEYSURE_INTERNAL_TOKEN` | Gateway 与内部 runtime 之间访问 `/internal/*` 接口的令牌 |
| `MCP_RUNTIME_URL` | MCP Runtime 地址 |
| `CONNECTOR_RUNTIME_URL` | Connector Runtime 地址 |
| `AI_RUNTIME_URL` | AI Runtime 状态服务地址 |
| `AI_DISPATCH_MODE` | `remote` 表示聊天任务进入队列，由 AI Runtime 消费 |

完整配置入口见 `server/api/core/settings.py`。

## 开发命令

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

单独启动内部 runtime：

```bat
python -m mcp_runtime.main
python -m connector_runtime.main
python -m ai_runtime.main
```

### Windows Agent

```bat
cd agent\windows
npm install
npm run dev
npm run build
```

一键打包 Windows 桌面 Agent：

```bat
agent\windows\build.bat
```

### Browser Extension

```bat
cd agent\extension
npm install
npm run build
```

然后在 Chrome 扩展程序页面选择“加载已解压的扩展程序”，加载 `agent/extension/` 目录。

## MCP 工具与权限

MCP Runtime 负责统一管理工具的注册、调用和权限边界。当前工具覆盖：

- `workspace`：工作区与文件上下文
- `projects`：项目管理
- `tasks`：任务系统
- `memory`：记忆与长期上下文
- `librarian`：知识管理员与知识沉淀
- `conversation`：会话检索、管理与上下文操作
- `communication`：AI 间通信
- `web_search`：网络搜索能力
- `introspection`：运行时自省

工具权限与运行时边界是系统后续扩展 skill / hook 体系的基础，相关路线见 `doc/系统优化路线.md`。

## 数字社会设计

HeySure AI 2.0 的长期目标，是让 AI 成员在同一个系统中形成可观察、可协作、可演进的工作网络。

核心管理员 `Archivist` 的职责不是直接控制所有 Agent，而是：

- 观察：记录每个 AI 的诞生、任务、成长与退场
- 指引：为新 AI 准备使命书、上下文与必读知识
- 总结：从实践日志中提炼成功模式和失败教训
- 传承：将退场 AI 的经验归档到 Valhalla 与 KnowledgeBase

这套设计让 AI 的每次执行不只是一次孤立调用，而是可以被复盘、压缩、继承和继续利用的系统资产。

## 适用场景

HeySure AI 2.0 更适合需要“AI 持续参与工作”的场景，而不是一次性的问答工具。

| 场景 | 价值 |
| --- | --- |
| 个人 AI 工作台 | 将多个 AI 成员、桌面工具、浏览器工具和项目上下文统一到一个控制台 |
| 项目型 AI 团队 | 为不同岗位配置不同 AI，例如代码审查、资料整理、自动化执行、任务跟进 |
| 多渠道智能助理 | 让 Web、QQ、飞书、浏览器扩展共享同一套 AI 成员和会话体系 |
| 自动化实验平台 | 使用 MCP 工具和 Agent 运行时测试 AI 的任务拆解、工具调用和执行闭环 |
| 长期知识沉淀 | 将对话、任务和工具执行中的经验转化为可复用的知识资产 |

## 演进路线

项目当前重点不在堆叠更多页面，而在打磨 Agent 运行时的稳定边界。

| 阶段 | 目标 |
| --- | --- |
| Foundation | 稳定 Web、Gateway、AI Runtime、MCP Runtime、Connector Runtime 的基础链路 |
| Observability | 为 MCP 调用补齐 `detected / parsed / authorized / executing / completed / failed` 状态追踪 |
| Governance | 完成 Prompt 分层、工具权限运行时分层和高风险操作边界 |
| Memory | 将任务记录、会话摘要、知识库和 Agent 生命周期档案连接成长期记忆系统 |
| Evolution | 引入 skill / hook / 自动任务编排，让 Agent 可以在受控环境中持续演进 |

这条路线的核心判断是：Agent 系统的上限不只取决于模型能力，更取决于上下文组织、工具边界、执行可观测性和失败后的复盘机制。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| `doc/数字社会核心管理员-管理手册.md` | Archivist、EvolutionArena、KnowledgeBase、Valhalla 的完整设计 |
| `doc/机器人对话区设计.md` | QQ / 飞书 / Web 统一对话池与多会话切换方案 |
| `doc/Claude Code 集成-权限分层设计.md` | Claude Code 集成和权限分层思路 |
| `doc/系统优化路线.md` | MCP 解析、执行状态、Prompt 分层、权限运行时等系统路线 |
| `doc/工程优化路线.md` | Settings、logging、测试、类型化、大文件拆分等工程路线 |
| `doc/prompt/` | 核心管理员、桌面助手、浏览器助手、MCP 工具调用等 Prompt |

## 当前状态

项目已经具备完整的基础运行骨架：

- Web 控制台可运行
- 后端支持拆分进程和 Docker Compose 部署
- MCP Runtime 与工具注册体系已存在
- Windows 桌面 Agent 与 Chrome 扩展具备独立执行入口
- QQ / 飞书连接器与统一机器人对话区设计已进入系统规划
- 工程侧已经开始向 Settings、logging、分层 runtime、可观测 MCP 链路演进

后续重点会集中在：更稳定的 MCP 执行可观测性、Prompt 组装分层、工具权限运行时分层、自动化测试 baseline、前端类型化，以及 Agent 生命周期治理的进一步落地。

## 许可证

当前仓库未声明开源许可证。对外分发或商业使用前，请先补充明确的 License。

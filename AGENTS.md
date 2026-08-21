# AGENTS.md — HeySure AI 2.0 项目导航

> 供 Codex / 通用 coding agent 在每次会话开始时快速理解项目，**不要删除**。
> 面向"哪里改什么"的导航地图，背景与理念见 [`README.md`](README.md)。
> 同内容的 Claude 版见 [`CLAUDE.md`](CLAUDE.md)。

## 一句话定位

HeySure AI 2.0 是一个**多端 AI agent 协作平台**：Web 控制台 + Python 后端（拆成 4 个进程）+ 跨平台端侧执行器（Windows Tauri 桌面 / Linux 服务器 Agent / Chrome 扩展 / Android）。AI 成员可被创建、治理、调用工具、记录知识。

## 测试环境（供 Agent 联调）

已部署的测试服务器，可直接 curl 验证行为：

- Web 控制台：`http://49.234.181.190:58150/`
- API 网关（可直连）：`http://49.234.181.190:3000/`
- 测试账号：`heysure` / `heysure`（以后所有测试统一用这个账号密码）
- 登录：`POST /api/auth/login`，body `{"account":"heysure","password":"heysure"}`，返回 `access_token` 与 `agent_socket_url`。

> 注意：经 :58150 登录时 `agent_socket_url` 会返回 `http://...:58150`（web 已正确反代 `/socket.io/` 含 WS 升级，可用）；经 :3000 直连登录返回 `http://...:3000`。

## 服务器 MCP 对接

后续对测试服务器执行部署、更新、迁移、重启、验收或故障恢复时，**优先使用 [HeySure Baota Ops](plugin://heysure-baota-ops@personal)**。开始操作前先确认该插件已安装且其 `heysure-baota-operations` 技能与宝塔 MCP 连接可用；可用时必须先读取并遵循该技能，再通过它完成只读侦察、发布门禁、代码同步、数据库备份、滚动发布和发布验收。

- HeySure Baota Ops 插件或技能不可用、未连接、缺少必要权限或缺少当前步骤所需能力时，才回退到下述底层宝塔 MCP，并在操作记录中说明回退原因。
- 无论使用 HeySure Baota Ops 还是底层宝塔 MCP，本文规定的唯一 Compose 入口、持久化路径、敏感信息保护、当次发布授权、数据库备份、滚动顺序和验收门禁都必须完整执行；不得因切换入口跳过任何安全约束。
- 不得同时让两个 MCP 或面板自动任务并发修改同一 Compose 项目；发布前必须确认唯一发布所有者。

### 底层宝塔 MCP 回退通道

当前 Codex 环境已配置宝塔 MCP 服务器，工具命名空间为 `mcp__baota__*`，可直接用于测试服务器的只读检查、项目文件操作和经确认的运维操作。

- 服务器：`49.234.181.190`（与上方测试环境为同一台服务器）。
- **唯一 Compose 发布入口**：`/www/server/panel/data/compose/heysureai2`。所有 `docker compose`、构建、重建、迁移和滚动发布都必须从这里执行；容器标签 `com.docker.compose.project.working_dir` 必须等于该路径。
- **唯一持久化数据根目录**：`/www/wwwroot/heysureai2/deploy/server/data`。四个 Runtime 的 `/app/data` 必须绝对挂载到其 `app/` 子目录；PostgreSQL 挂载数据根目录，但只使用保留子目录 `postgres/`（`PGDATA=/var/lib/postgresql/data/postgres`）。Runtime 不得挂载或访问 `postgres/`。
- `/www/wwwroot/heysureai2` 不再作为 Compose 发布入口。不得从该目录执行 Compose，不得把 Runtime 数据挂载恢复为 `./deploy/server/data` 等相对路径。
- 重建容器前必须同时核对 Compose 工作目录标签和所有持久化 Mount Source；任一项偏离上述路径时停止发布。
- 该项目当前未登记在宝塔“网站”列表中，应按 **Docker Compose 项目**处理；不要因为 `SiteList` 搜不到 `heysure` 就判断项目不存在。
- 定位文件优先使用宝塔 MCP 的 `LS`、`Glob`、`Grep`、`Read`；查看站点、服务和系统状态时优先使用对应的宝塔专用工具，必要时才使用 `Bash`。
- 默认先进行只读侦察，核对实际目录、Git 提交、容器和服务状态，再提出或执行变更；不得用本地工作区状态推测服务器当前状态。
- 禁止读取或回显服务器 `.env`、密码、Token、Cookie、私钥等敏感信息。确需核对配置时只检查变量是否存在或输出脱敏结果。
- 修改服务器文件前必须创建可恢复备份并记录位置，修改后执行语法、配置或服务有效性验证；发布、重启、删除、覆盖、迁移等高风险操作须先获得用户明确确认，并遵循本文“发布与运维”规则。
- 不得修改宝塔面板、宝塔核心服务或 `bt_agent_mcp` 插件及其数据目录。

> 以上路径和部署形态已于 2026-08-13 通过宝塔 MCP 发布前后复核；后续操作仍须先重新检查服务器现状。

### 宝塔快速发布清单（2026-08-13 已实测）

本节是标准发布顺序。即使用户说“直接部署”，仍须先完成只读门禁；发布、迁移、容器替换必须已有当次明确授权。

1. **本地提交与推送**：按 `deploy/server` → `deploy/web` →（有改动时）`device` → 根仓库的顺序提交、推送。根仓库最后提交子模块指针。四个仓库都要先确认与各自 `origin/main` 无分叉；不得只推根仓库指针而遗漏子仓库提交。
2. **服务器只读门禁**：进入唯一 Compose 目录，检查根提交、Server/Web 子模块提交、`git status --porcelain`、`docker compose ps`、磁盘/内存；逐容器核对 Compose 工作目录标签和 Mount Source。`device` 不属于服务器 Compose 发布内容。
3. **配置与密钥**：只检查 `.env` 中变量“存在/缺失”，禁止输出值。生产必须存在三枚互不相同的强随机值：`JWT_SECRET`、`HEYSURE_INTERNAL_TOKEN`、`HEYSURE_BOT_ENCRYPTION_SECRET`。首次补齐或经明确授权轮换前，先把 `.env` 备份到持久化备份目录，修改后设为 `0600`，仅验证长度、互异性和存在性。
4. **同步代码**：只允许 `git fetch` + 指定提交的 `git merge --ff-only`，随后执行 `git submodule sync -- deploy/server deploy/web` 与 `git submodule update --init --recursive -- deploy/server deploy/web`，再逐项比对预期 SHA，并运行 `docker compose config --quiet`。
5. **数据库备份**：在 `/www/wwwroot/heysureai2/deploy/server/data/backups` 创建 PostgreSQL custom-format 备份，确认文件非空、记录文件名与字节数，并设为 `0600`。数据库相关或 Server 发布没有可恢复备份时不得继续。
6. **迁移和 Runtime 发布**：从唯一 Compose 目录运行 `python3 deploy/server/other/scripts/rolling_release.py --timeout 180`。该脚本构建镜像、执行 Alembic、按 Gateway → MCP → Connector → AI 顺序替换，并逐步检查 readiness；不要再手工并行重建四个 Runtime。
7. **Web 发布**：Runtime 全部通过后再构建和替换 Web。正常路径是 `docker compose build web`，成功后执行 `docker compose up -d --no-deps web`。构建失败时旧 Web 容器不会自动被替换，先确认线上仍可用再排障。
8. **发布验收**：至少验证 `docker compose ps`、API/Web HTTP 200、四个 Runtime 容器内 `/internal/health/ready`、Alembic revision 等于代码 head、测试账号登录、管理员 `/api/diagnostics/selftest` 全通过、陈旧 `ChatRun`/`AgentDispatchTask` 为零、Git 工作树干净，并再次核对 Compose 标签和挂载。
9. **四进程 smoke**：宿主 Python 可能没有 `python-socketio`，不要为此污染宿主环境；优先在依赖完整的 Gateway 容器内运行：

```bash
docker compose exec -T api-gateway sh -lc \
  'python other/scripts/smoke_four_runtime.py \
  --gateway http://api-gateway:3000 \
  --connector http://connector-runtime:3002 \
  --internal-token "$HEYSURE_INTERNAL_TOKEN" \
  --account heysure --password heysure --timeout 180'
```

密钥轮换影响必须在发布前说明：更换 `JWT_SECRET` 会立即使旧登录 Token 失效；更换 `HEYSURE_INTERNAL_TOKEN` 必须让四个 Runtime 使用同一个新值并一起滚动替换；更换已有数据使用中的 `HEYSURE_BOT_ENCRYPTION_SECRET` 会导致已加密机器人凭据不可解密，通常需要机器人重新登录，因此已有生产值时不得把“生成新值”当作普通发布步骤。

### Clash / Docker Web 构建注意事项

当前服务器 Mihomo（Clash 内核）的 HTTP 代理监听在 `127.0.0.1:7890`。宿主机经该地址可用，但普通 Docker build 中的 `127.0.0.1` 是构建容器自身；Compose `.env` 若把 `DOCKER_HTTP_PROXY` 等设为 `http://172.17.0.1:7890`，而 Mihomo 仍只监听回环地址，构建会报：

```text
connect ECONNREFUSED 172.17.0.1:7890
```

这代表“代理参数已传入但 Docker 网桥无法访问”，不是 npm 镜像源故障。仅在宿主 shell 使用 `env -u HTTP_PROXY ... docker compose build web` 也不一定有效，因为 Compose 会继续从 `.env` 的 `DOCKER_*_PROXY` 生成 build args。

优先使用以下安全方案，不要为了构建把 Clash 开放到 `0.0.0.0` 或开启公网/LAN 访问：

```bash
docker build --network host \
  -t heysureai2-web \
  -f deploy/web/Dockerfile \
  --build-arg HTTP_PROXY=http://127.0.0.1:7890 \
  --build-arg HTTPS_PROXY=http://127.0.0.1:7890 \
  --build-arg ALL_PROXY=http://127.0.0.1:7890 \
  --build-arg http_proxy=http://127.0.0.1:7890 \
  --build-arg https_proxy=http://127.0.0.1:7890 \
  --build-arg all_proxy=http://127.0.0.1:7890 \
  deploy/web
docker compose up -d --no-deps --force-recreate web
```

构建前可分别验证：宿主 `curl --proxy http://127.0.0.1:7890 ...` 是否成功、`ss -lntp` 是否仅监听回环、Docker 访问 `host.docker.internal:7890` 是否被拒绝。需要切换节点时通过 Mihomo 本地控制 API 或既有 Clash 管理方式切换，并在切换后重新执行代理 curl；不得读取、回显订阅 URL、控制密钥或节点凭据。选择新节点失败时应恢复原节点。Web Dockerfile 当前使用 `cnpm` 且未复制 lockfile，因此网络不稳时优先复用上述宿主网络构建方式；不要反复重试普通 Compose build 浪费时间。

代理边界必须保持清晰：`DOCKER_HTTP_PROXY`、`DOCKER_HTTPS_PROXY`、`DOCKER_ALL_PROXY` 和 `DOCKER_NO_PROXY` 只作为 Docker **镜像构建参数**使用，不注入 Gateway、AI、MCP、Connector、Web 或 `db-migrate` 的运行时环境。宿主侧 repo-updater 可继承宿主代理完成 Git 拉取；Compose 内所有机器人连接（微信 iLink、QQ、飞书）必须直连，避免本机回环代理端口导致 502。`DOCKER_NO_PROXY` 至少包含 `ilinkai.weixin.qq.com`、`novac2c.cdn.weixin.qq.com`、`.weixin.qq.com` 和 `.qq.com`。修改代理配置后应检查容器环境中不存在非空的 `HTTP_PROXY`、`HTTPS_PROXY` 或 `ALL_PROXY`，并实际调用微信二维码接口验证不再出现 `ProxyError`。

### 滚动发布脚本的 Compose 目录陷阱

`deploy/server/other/scripts/rolling_release.py` 不会使用调用者当前目录作为 Compose 目录；它默认根据脚本位置推导工作区根目录。仅先 `cd /www/server/panel/data/compose/heysureai2` 再运行脚本仍可能误用 `/www/wwwroot/heysureai2/docker-compose.yml`，违反唯一发布入口约束。

服务器执行滚动发布时必须显式设置：

```bash
HEYSURE_COMPOSE_DIR=/www/server/panel/data/compose/heysureai2 \
python3 /www/wwwroot/heysureai2/deploy/server/other/scripts/rolling_release.py --timeout 180
```

2026-08-13 的典型误导症状：唯一发布目录的 Compose 已给 `db-migrate` 映射 `JWT_SECRET`，但脚本仍报 Pydantic `JWT_SECRET Field required`。这不代表应重新生成或回显 `.env` 密钥，而是脚本选错了 Compose 文件。处理顺序必须是：检查唯一目录中的 Compose 片段 → 确认 `.env` 变量只检查“存在且非空” → 显式设置 `HEYSURE_COMPOSE_DIR` → 再发布。发布后再次核对所有容器的 `com.docker.compose.project.working_dir` 和持久化 Mount Source。

服务器 GitHub 直连超时时，先验证宿主 `127.0.0.1:7890` 代理能访问 GitHub，再只给单次 `git fetch` 注入 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`；不要全局导出，更不能注入 Runtime。Mihomo 控制 API 若要求鉴权，不得为切换节点读取或回显控制密钥。一次 Git 同步失败后先确认仓库没有部分合并，再进行下一次同步。

## 顶层结构（多仓库）

本项目采用**多仓库 + git submodule**布局：

| 仓库            | 本地目录 | 技术栈 | 作用 | 详细文档 |
|-----------------|----------|--------|------|----------|
| HeySure-Web     | `deploy/web/`   | Vue 3 + Vite + TS | 前端控制台 | [`deploy/web/AGENTS.md`](deploy/web/AGENTS.md) / [`deploy/web/CLAUDE.md`](deploy/web/CLAUDE.md) |
| HeySure-Server  | `deploy/server/`| Python + FastAPI + Socket.IO | 后端（4 进程） | [`deploy/server/AGENTS.md`](deploy/server/AGENTS.md) / [`deploy/server/CLAUDE.md`](deploy/server/CLAUDE.md) |
| HeySure-Device  | `device/`| Tauri / Chrome MV3 / Kotlin / Python | 端侧执行器 | [`device/AGENTS.md`](device/AGENTS.md) / [`device/CLAUDE.md`](device/CLAUDE.md) |
| (workspace)     | `doc/`   | Markdown | 设计文档 / 角色 prompt | 保留在工作区根目录 |

服务器部署只初始化 Web 与后端（不会下载设备仓库）：

```bash
git clone <仓库地址>
git submodule update --init --recursive -- deploy/server deploy/web
```

需要端侧开发时再执行 `git submodule update --init --recursive -- device`。

子模块定义见根目录 [`.gitmodules`](.gitmodules)。

## 架构与端口

```
Web 控制台 (58150)
   │ REST + Socket.IO
   ▼
API Gateway (3000)  ── 对外唯一入口，挂载 deploy/server/main/gateway/routers/*
   │ 内部 HTTP (/internal/*, 需 HEYSURE_INTERNAL_TOKEN)
   ├──► AI Runtime        (3003)  聊天队列消费 / 模型推理
   ├──► MCP Runtime       (3001)  工具注册 / 权限校验 / 工具执行
   └──► Connector Runtime (3002)  QQ/飞书机器人 + 端侧 agent 调度
                                      │ Socket.IO
                                      ▼
              Windows Tauri / Linux Agent / 浏览器扩展 / Android
```

- 4 进程**共享** `deploy/server/main/api/`（模型、DB、认证、服务、配置）；各 `*_runtime/` 只负责把共享层接成一个进程。
- 进程角色通过 `HEYSURE_SERVICE_ROLE` 区分：`gateway | worker | mcp | connector`。
- 数据库仅支持 PostgreSQL，`DATABASE_URL` 为必填项。

## 常用命令

```bash
# 服务器初始化（不下载设备仓库）
git clone ...
git submodule update --init --recursive -- deploy/server deploy/web

# Docker（一键全栈）
docker compose up -d --build      # 或 docker-run.bat

# 本地分进程（Windows）
deploy\server\run.bat
deploy\web\run.bat
device\windows\run.bat

# 手动单进程
cd deploy/server
python -m gateway.main
...

# 健康检查
curl http://127.0.0.1:3000/
```

## 启动顺序依赖

```
PostgreSQL → Gateway (3000) → MCP Runtime (3001)
                            → Connector Runtime (3002)
                            → AI Runtime (3003)
```

各进程在自己的 `lifespan` 装配职责：Gateway 提供 API 与其调度器，MCP Runtime 加载 MCP，
Connector Runtime 管理端侧 Socket/presence，AI Runtime 负责推理。Gateway 仍按上面的依赖顺序先起；
Docker Compose 已通过 `depends_on` + `healthcheck` 自动处理顺序。

## "改 X 去哪里"速查

**注意**：代码分布在三个独立仓库中（submodule init 后布局与下表相同）。

| 需求 | 位置 |
| --- | --- |
| 新增 / 改 REST 接口 | `deploy/server/main/gateway/routers/<域>.py`（文件名即域） |
| 业务逻辑 / 数据访问 | `deploy/server/main/api/services/`（按域分子包：`knowledge/` `tasks/` `mcp/` `device_tools/` `chat/` `access/` `storage/`）与 `deploy/server/main/api/models/` |
| 新增 MCP 工具 | `deploy/server/tools/`（实现）→ `deploy/server/main/mcp_runtime/mcp/registry.py`（注册）→ `deploy/web/src/utils/mcpTools.ts`（前端展示） |
| 聊天 / 推理流程 | `deploy/server/main/api/chat_runtime/`（调度/流式/MCP 解析）+ `deploy/server/main/ai_runtime/`（worker + litellm） |
| 定时 / 循环任务 | `deploy/server/main/api/services/tasks/task_schedule.py`（唯一权威实现，REST/MCP/调度器共用） |
| QQ / 飞书机器人 | `deploy/server/main/connector_runtime/bots/` 与 `dispatch/` |
| 前端页面 / 组件 | `deploy/web/src/components/<域>/`（chat / dashboard / home / common） |
| 前端调后端 API 封装 | `deploy/web/src/api/<域>.ts`（http.ts 是统一客户端） |
| Windows 桌面本机执行 | `device/windows/src/`（TS）+ `device/windows/src-tauri/`（Rust） |
| Linux 服务器 Agent | `device/linux/agent/`（Python） |
| OpenCut 视频编辑器 | `device/AI-FREE-app/`（本地端口 `127.0.0.1:5173`，`opencut.*` MCP） |
| 浏览器自动化 | `device/browser/browser_MCP/`（主扩展源码）/ `device/browser/browser_MCP_win/`（Windows 原生输入构建） |
| 设备固定/动态 MCP、任务与远控协议 | `device/read.md`（统一标准） |
| 配置项 / 环境变量 | `deploy/server/main/api/core/settings.py`（**配置总入口**） |
| AI 角色 prompt | `doc/prompt/` |
| 知识工坊 Agent | `deploy/server/library/`（服务端内置虚拟 Agent） |

## 环境变量速查

| 变量名 | 是否必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | **必填** | `postgresql+psycopg://user:pass@host/db` |
| `HEYSURE_INTERNAL_TOKEN` | **必填** | 进程间 `/internal/*` Bearer Token，四进程必须一致 |
| `HEYSURE_SERVICE_ROLE` | 可选 | 进程身份（gateway/worker/mcp/connector），各 run.bat 已设 |
| `JWT_SECRET` | **必填** | 用户登录 token 签名，至少 32 字符；禁止使用公开默认值 |
| `AI_RUNTIME_URL` | 可选 | Gateway → AI Runtime（默认 `http://127.0.0.1:3003`） |
| `MCP_RUNTIME_URL` | 可选 | Gateway → MCP Runtime（默认 `http://127.0.0.1:3001`） |
| `CONNECTOR_RUNTIME_URL` | 可选 | Gateway → Connector（默认 `http://127.0.0.1:3002`） |
| `TAVILY_API_KEY` | 可选 | Web 搜索功能 |
| `HEYSURE_TIMEZONE` | 可选 | 任务定时/循环墙钟时区（默认 `Asia/Shanghai`；置空退回服务器本地时区） |
| `LOG_LEVEL` | 可选 | DEBUG/INFO/WARNING（默认 INFO） |
| `LOG_JSON` | 可选 | 容器部署时设 `true`，输出 JSON 格式日志 |

完整清单：`deploy/server/main/api/core/settings.py`

## 常见症状 → 定位路径

| 症状 | 优先检查 | 关键文件 |
| --- | --- | --- |
| 启动报 DB 连接错误 | `DATABASE_URL` 格式 / PostgreSQL 是否运行 | `deploy/server/main/api/database.py` |
| `/internal/*` 返回 401 | `HEYSURE_INTERNAL_TOKEN` 四进程是否一致 | `deploy/server/main/api/auth.py` |
| 前端请求 404 | 路由是否存在且已注册到 gateway | `deploy/server/main/gateway/routers/` → `gateway/app.py` |
| AI 不回复 / 推理卡住 | AI Runtime (3003) 进程是否运行；查看 3003 日志 | `deploy/server/main/ai_runtime/worker.py` |
| MCP 工具不显示 | 工具是否已注册，设备权限是否开启 | `deploy/server/main/mcp_runtime/mcp/registry.py` + `permissions.py` |
| 端侧设备掉线 | Connector (3002) Socket.IO 是否正常 | `deploy/server/main/connector_runtime/app.py` + `api/sio.py` |
| 聊天消息丢失 | 持久化流程 | `deploy/server/main/api/services/chat/chat_persistence.py` |
| 任务不触发 | 调度器是否随 Gateway 启动 | `deploy/server/main/api/services/tasks/task_system.py` + `tasks/task_schedule.py` + `chat_runtime/chat_scheduler.py` |
| 知识库搜索无结果 | 关键词是否命中；文件是否在 topics/ 或技能目录 | `deploy/server/main/api/services/knowledge/kb_store.py`（`keyword_search_knowledge`） |
| 前端样式/组件异常 | Tailwind 类名白名单；组件 props 是否正确传递 | `deploy/web/src/components/` + `deploy/web/src/styles/main.css` |
| 桌面端工具调用失败 | Socket.IO 消息链路；runtime 工具执行日志 | Windows：`device/windows/src/agent.ts` + `executor/` + `runtime/` |

## 聊天请求链路（问题定位参考）

```
用户发消息（Web）
  → POST /api/chat/send                      (gateway:3000 — chat.py router)
  → chat_runtime/（chat_stream / run_state 等） 编排与流式
  → POST /internal/ai/run                    (ai_runtime:3003)
  → ai_runtime/worker.py + litellm           模型推理
  → 触发工具调用 → POST /internal/mcp/call   (mcp_runtime:3001)
  → tools/ 执行工具逻辑（或下发端侧设备）
  → 返回结果 → 继续推理（最多 chat_max_steps 步）
  → Socket.IO emit("chat_message")           推送到前端
  → chat/chat_persistence.py                 保存消息
```

## 关键约定

- **配置看 `settings.py`**：所有环境变量的真实清单在 `deploy/server/main/api/core/settings.py`。
- **内部接口要带 token**：进程间 `/internal/*` 需 `HEYSURE_INTERNAL_TOKEN` bearer。
- **不要提交构建产物**：`deploy/web/dist`、`device/*/dist`、`__pycache__`、`*.db` 已在 `.gitignore`。
- **桌面端壳无法在 CI/远程完整验证**：Windows Tauri 需 Rust/VS Build Tools；Linux Agent 可用 Python 单测/本机进程验证。
- **端侧代码按平台独立**：`device/windows`（Tauri）、`device/linux`（Python 服务器 Agent）、浏览器与 Android 各自独立，互不共享 `shared/`。
- **改 `deploy/server/main/api/` 影响全部 4 个进程**，注意进程角色差异。

## 服务端可靠性与复杂度强制规则

后续修改 `deploy/server/`、根目录 Compose/CI 或服务端运维脚本时，必须先阅读并遵循：

- [`doc/server-reliability-complexity-refactoring-plan.md`](doc/server-reliability-complexity-refactoring-plan.md)：架构不变量、阶段目标与完成定义。
- [`doc/server-reliability-operations.md`](doc/server-reliability-operations.md)：发布、回滚、故障演练与月度 Top-N 检查。
- [`doc/db-migrations.md`](doc/db-migrations.md)：Alembic 唯一迁移权威和遗留库接管边界。
- [`doc/refactoring/server-reliability-implementation-log.md`](doc/refactoring/server-reliability-implementation-log.md)：已完成拆分、测试和线上验收证据，避免重复造轮子或把已删除兼容层加回来。

### 代码结构

- 复杂度 baseline 是历史债务上限，只能下降，禁止通过扩大 baseline、增加豁免或移动代码来规避门禁。
- 新增生产文件不得超过 500 有效行；新增或改写的业务函数目标不超过 80 有效行、圈复杂度不超过 15。接近上限时先拆 DTO、纯函数、状态机、领域服务，或前端的 types / utils / composable / 子组件。Server 与 Web 使用同一组阈值。
- `main/ai_runtime/inference/core.py` 是稳定入口和少量已记录兼容导出；禁止把新业务重新塞入 `_run_worker_impl`。外层运行编排放在 `worker_run_flow.py`，模型轮次、轮次后处理和工具批次分别使用现有 flow 模块。
- 跨步骤流程必须使用显式状态、动作枚举和不可变 DTO；不得用大型闭包、`nonlocal` 或散落布尔值隐式驱动状态。任务必须定义合法转换、不可复活终态、owner/lease/deadline 和恢复策略。
- 删除兼容入口前先用 `rg` 证明无调用并检查路由、测试和外部合同；确需保留时必须写明调用方、边界和删除条件，禁止无行为的永久 no-op。

### 数据库与四进程边界

- Schema 只能由 Alembic/`db-migrate` 修改。Gateway、AI、MCP、Connector Runtime 启动时只能执行只读 schema guard，禁止 `create_all`、隐式 DDL 或自动补表。
- 遗留未版本化数据库只能通过 `main/api/db.py` 的显式 `_legacy_adopt` 边界接管；不得把兼容 DDL 放回普通 Runtime 启动路径。
- `main/api/` 是四进程共享层：导入时不得创建 App、注册 Socket handler、启动线程/调度器、连接外部服务或修改数据库。进程装配归各自 `gateway/`、`ai_runtime/`、`mcp_runtime/`、`connector_runtime/`。
- 内部 HTTP 必须携带统一 `HEYSURE_INTERNAL_TOKEN`；日志、异常、测试输出和运维脚本不得回显 token、密码、Cookie、消息正文或原始 SQL。
- MCP/Connector/AI 的 readiness 应在 Compose 网络内按各自真实端口验证；不要因宿主未映射 3001–3003 就误判服务不可用。

### 测试与验收

- Server 改动提交前至少运行 `deploy/server/other/scripts/verify_server.py`；该入口统一执行复杂度、架构、语法和 unit/contract 测试。不得在门禁失败时直接改宽 baseline。
- Web 改动提交前至少运行 `deploy/web` 下的 `npm run verify`；该入口统一执行与 Server 相同阈值的复杂度门禁和 `vue-tsc`。不得在门禁失败时直接改宽 `scripts/guardrail_baseline.json`。
- 数据库、锁、迁移或事务改动必须增加真实 PostgreSQL integration 测试；不要用 SQLite 结果代替 PostgreSQL 行为。
- 状态机关键分支覆盖率不低于 90%，本次新增/修改关键模块增量覆盖率不低于 85%；成功路径之外还要覆盖失败、超时、取消、断线、重连、迟到和重复回执。
- 四进程或部署链路改动必须验证登录、真实 AI、MCP 和模拟 Agent；设备故障矩阵使用 `smoke_four_runtime.py --fault-matrix`，重启/lease 语义改动使用 `restart_fault_exercise.py`。
- 运行线上重启演练时显式传入已存在的测试账号；生产通常关闭注册，不能依赖 smoke 自动创建账号。项目统一验收账号仍为本文开头的 `heysure`。

### 发布与运维

- 发布前确认唯一发布所有者，避免面板自动部署与人工部署并发操作同一 Compose 项目；先只读核对目标提交、工作区、磁盘、内存和当前容器状态。
- 每次数据库相关或服务端发布前必须创建可恢复的 PostgreSQL custom-format 备份，并记录路径与大小。
- 只允许可验证的 fast-forward 同步；网络受限时使用带 SHA-256 校验的 Git bundle，不能复制未校验工作树覆盖服务器。
- 使用 `rolling_release.py` 执行迁移先行和逐 Runtime readiness 门禁；任一服务未就绪立即停止并按脚本恢复旧镜像，不得继续发布后续服务。
- 发布后必须核对 Git 提交、Alembic revision、四 Runtime readiness、Web/API、过期 `ChatRun`/`AgentDispatchTask` 数量；可靠性整改还须运行故障矩阵和规定轮数的重启演练。
- `reliability_top_n.py` 的慢模型轮次、长事务、锁等待、ChatRun 队列和 dispatch 队列按月复查；输出必须保持脱敏。

## Git 约定

- 提交信息清晰、描述性；除非明确要求，不要创建 PR。
- 根仓库与 `deploy/server`、`deploy/web`、`device` 是独立仓库。先在子模块提交，再提交根仓库的子模块指针；只暂存任务相关文件，保留用户已有改动。

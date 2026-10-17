# AGENTS.md — HeySure AI 2.0

本文件是仓库级导航，只保留必须遵守的约束和常用入口；模块细节见各子仓库 `AGENTS.md`、`README.md` 与 `doc/`。可并行且边界清晰的工作优先委派，主 Agent 负责整合和最终验收。

## 仓库地图

| 路径 | 用途 | 说明 |
|---|---|---|
| `deploy/server/` | Python/FastAPI 后端 | Gateway、AI、MCP、Connector 四进程 |
| `deploy/web/` | Vue 3 + Vite 控制台 | 前端页面与 API 客户端 |
| `device/` | Windows/Linux/浏览器/Android 端侧 | 端侧执行器与协议实现 |
| `doc/` | 设计文档、Prompt、运行手册 | 规范与背景资料 |

以上目录是独立 Git 仓库（根仓库通过 submodule 引用）。修改子仓库前先阅读对应 `AGENTS.md`；不要提交 `dist/`、`__pycache__/`、`*.db` 等构建产物。

## 运行架构

```text
Web :58150 → Gateway :3000 → MCP :3001
                         ├→ Connector :3002
                         └→ AI :3003
```

`deploy/server/main/api/` 是四进程共享层；进程装配分别位于 `gateway/`、`ai_runtime/`、`mcp_runtime/`、`connector_runtime/`，由 `HEYSURE_SERVICE_ROLE` 区分。共享层导入不得创建 App、线程、外部连接或执行 DDL。

## HeySure Member MCP 凭证

调用 `[HeySure Member MCP](plugin://heysure-member-mcp@personal)` 时使用仓库根目录 `.env` 中的 MCP 配置：

```toml
[mcp_servers.heysure_member]
url = "<Member MCP endpoint>"
bearer_token_env_var = "<Bearer token>"
tool_timeout_sec = 120
```

- `url` 是 Member MCP 的 HTTP endpoint；当前测试环境为 `http://49.234.181.190:58150/mcp/member`。
- 请求必须带 `Authorization: Bearer <token>`。当前配置中的 `bearer_token_env_var` 字段保存的是实际 Bearer 凭证（历史字段名仍保留），不是需要回显或提交的普通配置值；调用前应从 `.env` 读取并在内存中使用，禁止写入日志、提交到 Git 或在回复中展示。
- 凭证只用于 Member MCP；不要将它与四进程内部调用使用的 `HEYSURE_INTERNAL_TOKEN` 混用。凭证缺失或失效时，应先验证 endpoint、`initialize` 和 `tools/list`，再进行具体工具调用。

## 不可违反的约束

- 配置唯一入口：`deploy/server/main/api/core/settings.py`。`DATABASE_URL`、`JWT_SECRET`、`HEYSURE_INTERNAL_TOKEN` 必须存在；四个 Runtime 使用同一内部 Token，日志和测试输出不得泄露密钥、Cookie、密码或消息正文。
- `/internal/*` 只接受统一 Bearer Token。Schema 只能由 Alembic/db-migrate 修改；Runtime 启动仅做只读 schema guard，禁止 `create_all` 或隐式补表。
- 新生产文件不超过 500 个有效行；业务函数目标不超过 80 行、圈复杂度不超过 15；不得扩大 baseline 或增加豁免规避门禁。
- 任务、锁、租约和跨进程流程必须有显式状态、owner/lease/deadline、失败/超时/取消/重连语义；不得恢复已终态任务。
- 只修改任务相关文件并保留用户已有改动；不创建 PR，提交信息应能说明变更目的。

## 服务器发布门禁

仅在用户明确授权发布、迁移、重启或删除时执行；默认先只读侦察。唯一入口和数据路径：

- Compose：`/www/server/panel/data/compose/heysureai2`
- 持久化数据根：`/www/wwwroot/heysureai2/deploy/server/data`

发布前后都要核对 Compose `working_dir` 标签和 Mount Source：四个 Runtime 的 `/app/data` 必须绝对挂载到数据根下各自的 `app/` 子目录，PostgreSQL 只使用 `data/postgres`（`PGDATA=/var/lib/postgresql/data/postgres`），Runtime 不得挂载 `postgres/`。禁止从 `/www/wwwroot/heysureai2` 运行 Compose。标准顺序：

1. 核对服务器 Git、工作树、容器、磁盘/内存和唯一 Compose 目录。
2. 子仓库按 `server → web →（有改动时）device → root` 提交/推送；服务器只允许 `git fetch`、指定提交 `merge --ff-only` 和 submodule sync/update。
3. 生产配置还必须存在强随机且互不相同的 `HEYSURE_BOT_ENCRYPTION_SECRET`；已有机器人数据时不得随意轮换，否则已加密凭据将无法解密。
4. 数据库或 Server 发布前，在 `data/backups` 创建非空、`0600` 的 PostgreSQL custom-format 备份。
5. 从唯一 Compose 目录显式设置 `HEYSURE_COMPOSE_DIR`，运行 `rolling_release.py --timeout 180`；Gateway→MCP→Connector→AI 逐个 readiness 通过后再构建并替换 Web。
6. 验收 `docker compose ps`、API/Web HTTP 200、四 Runtime `/internal/health/ready`、Alembic head、测试登录/selftest、陈旧 `ChatRun`/`AgentDispatchTask` 为零，并再次核对标签与挂载。任一门禁失败立即停止并回滚。

代理、宝塔工具和故障恢复的详细步骤不要复制到本文件，统一遵循 `doc/server-reliability-operations.md` 及项目运维技能；不得读取或回显服务器 `.env`、Token、Cookie、私钥等敏感值。

## 开发与测试

```bash
# 全栈
docker compose up -d --build
# 后端验证
python deploy/server/other/scripts/verify_server.py
# 前端验证（在 deploy/web）
npm run verify
# API 健康检查
curl http://127.0.0.1:3000/
```

数据库、锁、迁移或事务改动必须增加真实 PostgreSQL integration 测试；四进程改动运行 `smoke_four_runtime.py`，重启/lease 语义改动运行 `restart_fault_exercise.py`。Windows Tauri 需要 Rust/VS Build Tools，Linux Agent 依赖其 `README`/脚本。

## 改动定位

- REST 路由：`deploy/server/main/gateway/routers/`
- 业务与数据：`deploy/server/main/api/services/`、`models/`
- AI/聊天：`deploy/server/main/api/chat_runtime/`、`ai_runtime/`
- MCP：`deploy/server/tools/`、`main/mcp_runtime/mcp/registry.py`
- 前端：`deploy/web/src/components/`、`src/api/`
- 端侧：`device/windows/`、`device/linux/`、`device/browser/`
- Prompt：`doc/prompt/`

## 规范索引

- `doc/server-reliability-complexity-refactoring-plan.md`
- `doc/server-reliability-operations.md`
- `doc/db-migrations.md`
- `doc/refactoring/server-reliability-implementation-log.md`
- `deploy/server/AGENTS.md`、`deploy/web/AGENTS.md`、`device/AGENTS.md`

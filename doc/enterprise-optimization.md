# HeySure AI 2.0 企业级优化与数据库整改方案

> 本文档面向"如何把当前项目升级为可长期维护的企业级系统"，所有结论基于对仓库的实测（截至 2026-06-09）。
> 阅读顺序建议：先看 [§1 现状结论](#1-现状结论)，再直接跳到 [§4 数据库整改](#4-数据库整改重点)（本次优化的重点）。

---

## 1. 现状结论

**结构不是严重缺陷。** `共享 api 层 + 4 进程 + 多端` 的分层合理，按域拆 router、`settings.py` 单一配置入口、JWT + 多级 RBAC、敏感词日志脱敏都说明项目有认真设计。

**真正的差距在工程化成熟度与数据库治理。** 具体见下表。

| 维度 | 现状（实测） | 成熟度 |
| --- | --- | --- |
| 架构分层 | 4 进程共享 `server/api/`，按域拆 router | ★★★ |
| 认证授权 | JWT(HS256)+bcrypt，MCP 工具 4 级 RBAC，内部 token | ★★★ |
| 容器化 | server / web 各一 Dockerfile + docker-compose（PG16） | ★★☆ |
| 文档 | 双语 README + 分层 CLAUDE.md | ★★★ |
| **自动化测试** | **全仓库 0 个测试**（无 pytest/vitest/conftest） | ☆☆☆ |
| **CI/CD** | **无 `.github/workflows`**，无任何流水线 | ☆☆☆ |
| **代码质量门禁** | flake8 装了但未配置；无 ruff/mypy/eslint/prettier/pre-commit | ☆☆☆ |
| **依赖锁定** | Python `requirements.txt` 多为 `>=`（web 有 lock） | ★☆☆ |
| **数据库迁移** | 自研 `migrations.py` **1722 行**，SQLite/PG 双路径，无版本表 | ☆☆☆ |
| 可观测性 | 有结构化日志；无 metrics / tracing / 标准探针 | ★☆☆ |
| 接口治理 | 有 CORS；无全局异常处理 / 限流 / request-id / OpenAPI 导出 | ★☆☆ |

### 1.1 安全红线（须最先处理）

1. **硬编码默认密钥** — `server/api/core/settings.py`：
   ```python
   jwt_secret = "heysure-ai-secret-key-change-this-in-production"
   ```
   只要部署时忘记覆盖，JWT 可被任何人伪造。应改为：缺失环境变量时**启动直接报错**，而非回落到公开常量。
2. **CORS 全开** — `server/gateway/app.py`：`allow_origins=["*"]`。生产须收敛白名单。

---

## 2. 总体优化路线图

按"投入产出比 + 风险"排序，分四个阶段。每个阶段都可独立交付、独立验收。

| 阶段 | 主题 | 关键交付物 | 预估 |
| --- | --- | --- | --- |
| **P0** | 安全加固 + 质量门禁 | 移除硬编码密钥、CORS 白名单、锁依赖、CI、pre-commit、ruff/mypy/eslint | 2–3 天 |
| **P1** | 数据库整改（**本文重点**） | Alembic 接管、版本表、统一 SQLite/PG 路径、迁移与数据整合解耦 | 1–2 周 |
| **P2** | 测试地基 + 接口治理 | pytest/vitest 核心覆盖、全局异常处理、request-id、OpenAPI 导出 | 1–2 周 |
| **P3** | 可观测性 + 部署 | Prometheus metrics、`/livez`/`/readyz`、OpenTelemetry、K8s/Helm | 1–2 周 |

---

## 3. P0 — 安全加固与质量门禁

不碰业务逻辑，纯加固。建议第一批落地。

### 3.1 安全
- [ ] `settings.py`：`jwt_secret`、`internal_token` 等关键密钥去掉默认值，缺失则 `raise RuntimeError`（仅开发态允许显式开关）。
- [ ] `gateway/app.py`：CORS `allow_origins` 从 `settings` 读白名单，默认空。
- [ ] 补 `server/.env.example`：把 `settings.py` 的 41 项配置整理成可抄模板（区分必填/选填）。

### 3.2 依赖锁定
- [ ] 引入 `pip-tools`：`requirements.in`（人写）→ `requirements.txt`（锁定哈希）。或迁 `pyproject.toml` + `uv`/`poetry`。
- [ ] CI 中校验锁文件与 `requirements.in` 一致。

### 3.3 质量门禁
- [ ] `pyproject.toml` 增加 `[tool.ruff]`（替换 flake8）+ `[tool.mypy]`（先 `ignore_missing_imports`，渐进开严）。
- [ ] web 增加 `eslint` + `prettier` 配置，`package.json` 加 `lint`/`format` 脚本。
- [ ] `.pre-commit-config.yaml`：ruff、ruff-format、prettier、end-of-file-fixer、检测大文件/密钥。

### 3.4 CI（GitHub Actions）
`.github/workflows/ci.yml`，触发 `push` / `pull_request`：
```
jobs:
  server:  ruff → mypy → pytest（带 coverage）
  web:     npm ci → eslint → vue-tsc → vitest → build
  docker:  docker build server/web（不推送，仅验证可构建）
```

---

## 4. 数据库整改（重点）

> 这是本次优化的核心。当前 `server/api/core/migrations.py` 已 **1722 行**，是项目最大的单点技术负债。

### 4.1 负债诊断（为什么"太乱"）

实测 `migrations.py` 里混了**三类本应分离**的职责：

1. **DDL 补丁**（~20 个 `_migrate_*` 函数）：用裸 `sqlite3.Cursor` 执行 `ALTER TABLE` / 加列。
2. **一次性数据整合**（`run_data_consolidations` 下 4 个 `_consolidate_*`）：把 prompts 迁到文件、valhalla 落库、feishu/qq 扁平列折成 `bot_configs` JSON、bot_session_routes 重组。
3. **JSON 数组手术**（`_remove_json_array_item` / `_collapse_*` / `_rename_*`）：用 `LIKE '%item%'` 在 SQL 里改 JSON 数组成员——脆弱且无类型保证。

具体的四个致命问题：

| # | 问题 | 证据 | 后果 |
| --- | --- | --- | --- |
| **D1** | **SQLite / Postgres 双路径** | `run_pending_migrations()` 跑前半批后 `if database_dialect() != "sqlite": return`；PG 全靠 `SQLModel.metadata.create_all` | 旧 PG 实例**收不到任何 ALTER 补丁** → schema 漂移，开发(SQLite)与生产(PG)结构不一致 |
| **D2** | **无迁移版本表** | 没有 `alembic_version` 之类的版本追踪 | 无法知道某库处于哪个版本、无法回滚、迁移靠"每次启动全量幂等重跑" |
| **D3** | **迁移 = 启动副作用** | `database.py` 在进程启动时调 `run_pending_migrations` + `run_data_consolidations` | 4 个进程并发启动靠 `bootstrap.lock` / PG advisory lock 串行化；迁移失败即启动失败，无独立可观测的迁移步骤 |
| **D4** | **数据整合永久驻留** | `_consolidate_*` 是一次性历史数据搬运，却每次启动都扫全表判断 | 早就完成的搬运逻辑成了永久启动开销与认知负担 |

### 4.2 目标架构

```
              ┌─────────────────────────────────────────┐
              │  Alembic（唯一的 schema 真相来源）        │
              │  versions/  ← 自动 + 人审的版本化迁移      │
              └───────────────┬─────────────────────────┘
                              │ alembic upgrade head
        ┌─────────────────────┴─────────────────────┐
   SQLite (dev/单机)                          PostgreSQL (prod)
        └──────────── 同一套迁移脚本，单一路径 ────────────┘

  应用启动：只连库、不建表、不迁移（迁移交给独立步骤/CI/Job）
```

核心原则：
- **Alembic 成为 schema 唯一真相**，删除 `create_all` 自动建表与自研 DDL 补丁。
- **SQLite 与 PG 走同一套迁移**（Alembic 对两种方言都支持，用 batch 模式处理 SQLite 的 ALTER 限制）。
- **schema 迁移**（DDL）与**数据迁移**（DML/搬运）分开管理，后者可被标记为"已完成"而不再重复扫描。
- **迁移与应用启动解耦**：迁移是 `alembic upgrade head` 的显式步骤（CI / 部署 Job / 容器 entrypoint 前置），应用进程只负责连库。

### 4.3 分步实施（可灰度、可回滚）

**Step 1 — 引入 Alembic 并对齐当前 schema（不改任何表）**
1. `pip install alembic`，`alembic init server/migrations`。
2. `env.py` 接入 `SQLModel.metadata`（已被 `models/__init__.py` 填充）与 `settings.DATABASE_URL`，开启 `render_as_batch=True`（SQLite 必需）。
3. 用 `alembic revision --autogenerate -m "baseline"` 生成**基线迁移**，使其等价于当前 22 张表的最终结构。
4. 对**已有库**用 `alembic stamp head` 打标（声明"当前结构=基线"，不实际执行 DDL），避免重复建表。

**Step 2 — 冻结并退役自研 DDL 补丁**
1. 确认基线迁移覆盖了所有 `_migrate_*` 已经打过的列/约束（逐个比对）。
2. 在 `database.py` 移除 `create_all` 自动建表，改为依赖 Alembic（开发态可保留一个 `alembic upgrade head` 的便捷封装）。
3. 删除 `run_pending_migrations()` 中纯 DDL 的 `_migrate_*` 函数（它们已被基线吸收），消除 D1 双路径。

**Step 3 — 把数据整合改成"一次性已完成"的数据迁移**
1. 把 4 个 `_consolidate_*` 改写成 Alembic 的 **data migration**（在对应 revision 的 `upgrade()` 里执行一次）。
2. 因为有版本表，执行过的 revision 不会再跑 → 解决 D4 的"每次启动全表扫描"。
3. JSON 数组手术（`_collapse/_rename/_remove_*`）同样落到具体 revision，用 Python 解析 JSON 而非 `LIKE` SQL，去掉 D3/脆弱性。

**Step 4 — 迁移与启动解耦**
1. 应用进程启动时**不再迁移**；新增 `python -m api.db migrate`（封装 `alembic upgrade head`）。
2. docker-compose / K8s：用 **init container 或 entrypoint 前置**跑 `migrate`，主进程仅在迁移成功后启动。
3. CI 增加"迁移可前进可回退"测试：空库 `upgrade head` → `downgrade base` → 再 `upgrade head`。

**Step 5 — 收尾与防回归**
- [ ] 删除 `scripts/migrate_sqlite_to_postgres.py` 中已被 Alembic 取代的逻辑（保留纯数据导出/导入部分）。
- [ ] CI 增加 **schema 漂移检测**：`alembic check`（autogenerate 应为空 diff），防止有人改了 model 却忘了生成迁移。
- [ ] 文档化：`doc/db-migrations.md` 写清"改 model → 生成迁移 → review → 合并"流程。

### 4.4 模型层顺带清理（低风险）
- 现状每个 `models/*.py` 把 `XxxCreate` / `XxxUpdate` / `XxxRead` DTO 与 `table=True` 实体混在一起。建议：实体留在 `models/`，请求/响应 DTO 收敛到 `schemas/`（或 router 旁），让"表"与"接口契约"分离，后续 OpenAPI 导出也更干净。
- `defaults.py`（125 行默认值）与 `migrations.py` 里大量 `DEFAULT_*` 引用耦合，整改迁移时一并梳理种子数据（seed）路径。

### 4.5 验收标准（Definition of Done）
- [ ] 全新 SQLite 与全新 PG，`alembic upgrade head` 后 schema **完全一致**（用 `alembic check` 验证 0 diff）。
- [ ] 旧库 `alembic stamp` 后再 `upgrade head` 不丢数据、不重复建表。
- [ ] 应用进程启动**不再执行任何 DDL/数据搬运**。
- [ ] `migrations.py` 从 1722 行降到接近 0（逻辑迁入 `versions/`）。
- [ ] CI 含迁移前进/回退与漂移检测。

---

## 5. P2 — 测试地基与接口治理

### 5.1 测试（先核心后周边）
- **server（pytest + httpx + 临时 SQLite）**：优先 `api/auth.py`、`api/services/*`、网关关键 router（auth/chat/agents）、MCP 权限判定。
- **web（vitest + @vue/test-utils）**：优先 chat 核心组件、API 封装层 `web/src/api/*`。
- 目标：先把"改了就会坏"的核心路径锁住，覆盖率次要。CI 设最低门槛并逐步抬高。

### 5.2 接口治理
- [ ] 全局异常处理器：统一错误响应体 `{code, message, request_id}`，区分 4xx/5xx。
- [ ] `request-id` 中间件：入口生成/透传，写入日志与进程间 `/internal/*` 调用头，打通链路。
- [ ] 导出 OpenAPI：FastAPI 自带 `/openapi.json` + `/docs`，按环境开关；可生成前端类型。

---

## 6. P3 — 可观测性与部署

- [ ] **指标**：`prometheus-fastapi-instrumentator` 暴露 `/metrics`（QPS、延迟、错误率、队列深度、AI 调用耗时）。
- [ ] **探针**：标准 `/livez`（进程活着）、`/readyz`（DB/依赖就绪），供 K8s/LB 摘流。
- [ ] **追踪**：OpenTelemetry 串起 gateway→runtime 的 `/internal/*` 调用，复用 request-id。
- [ ] **部署**：补 `deploy/k8s` 或 Helm chart；迁移作为 Job/init-container；密钥走 Secret/外部 vault。

---

## 7. 落地建议

1. **先合 P0**（安全+门禁），它给后续所有改动提供"安全网"，且不碰业务。
2. **P1 数据库整改单独拉分支、单独 review**，按 §4.3 的 Step 1→5 小步提交，每步可回滚。
3. P2/P3 可与业务迭代并行推进。

> 优先级与风险若需调整，以 §4 数据库整改为不可跳过项——它是当前最大且持续增长的负债。

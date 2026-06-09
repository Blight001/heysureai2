# 数据库迁移指南（Alembic）

> 本文是 [`enterprise-optimization.md` §4 数据库整改](enterprise-optimization.md#4-数据库整改重点) 的落地操作手册。
> 目标：让 **Alembic 成为 schema 的唯一真相来源**，SQLite（开发/单机）与 Postgres（生产）走同一套迁移脚本。

## 当前进度

按 §4.3 的分步实施，**Step 1–5 已全部落地**：

- [x] **Step 1**：引入 Alembic，生成与现有 22 张表等价的基线迁移（`baseline schema`）。
- [x] **Step 2**：`database.py` 移除 `SQLModel.metadata.create_all`，DDL 改由 Alembic 接管；
  已实测基线 schema 与旧 `create_all` 输出**结构完全一致**（22 表，0 差异）。
- [x] **Step 3**：一次性数据整合改为"采纳即一次"——见下方「过渡期：旧库采纳」。
- [x] **Step 4**：迁移与启动解耦——新增 `python -m api.db migrate` CLI，
  `HEYSURE_DB_AUTO_MIGRATE=0` 关闭随启动迁移；docker-compose 增加一次性 `db-migrate` 服务，
  四个进程 `service_completed_successfully` 后再启动。
- [x] **Step 5**：CI（`.github/workflows/db-migrations.yml`）跑 SQLite/PG 的
  upgrade→downgrade→upgrade 与 `alembic check` 漂移检测；`scripts/migrate_sqlite_to_postgres.py`
  目标库建表改用 Alembic。

### 启动期 schema 行为（现状）

`api/database.py::create_db_and_tables()`（四个进程启动时调用）现在委托给
`api.db.ensure_schema()`：

- `HEYSURE_DB_AUTO_MIGRATE`（默认 `true`，向后兼容）：启动时 `alembic upgrade head`。
- 设为 `0`：启动**不迁移**，只校验 schema 已存在（解耦部署用，迁移交给 `db-migrate` 步骤）。

`ensure_schema()` 自动识别三种库状态，单条命令即可覆盖新装与存量部署：

| 库状态 | 行为 |
| --- | --- |
| 空库（无业务表） | `alembic upgrade head` 建出全部表（等价旧 `create_all`） |
| **旧库**（有业务表、无 `alembic_version`） | 跑一次旧的 `run_pending_migrations` + `run_data_consolidations` 把 schema/数据补齐，再 `stamp head` 交给 Alembic |
| Alembic 库（有 `alembic_version`） | `alembic upgrade head`（已最新则秒级 no-op） |

### 过渡期：旧库采纳（实现说明）

`api/core/migrations.py`（1722 行的自研迁移）**已退出每次启动的执行路径**，仅在
`api.db._legacy_adopt` 里对一个**尚未纳管的旧库执行至多一次**：补齐历史列 + 搬运历史数据，
完成后 `stamp head`，此后该库永不再跑旧代码（**直接消解 D3 启动副作用与 D4 每次全表扫描**）。

> 与 §4.5「`migrations.py` 降到接近 0」的偏差说明：出于**生产安全**，旧代码被保留为"一次性采纳兜底"
> 而非删除——线上库已逐次启动应用过这些补丁，采纳时再跑一次是幂等的。待所有部署都采纳 Alembic 后，
> 可在后续版本整体删除 `api/core/migrations.py`（本文件追踪此项）。**新的 schema/数据变更一律写 Alembic
> revision，禁止再往 `migrations.py` 加东西。**

## 目录结构

```
server/
├── alembic.ini            # Alembic 配置（sqlalchemy.url 留空，由 env.py 注入）
└── migrations/
    ├── env.py             # 接入 SQLModel.metadata + settings.database_url
    ├── script.py.mako     # 迁移模板（已加 import sqlmodel）
    ├── README
    └── versions/
        └── *_baseline_schema.py   # 基线：等价于当前 22 张表
```

`env.py` 关键约定：

- **schema 真相**：`import api.models` 触发副作用填充 `SQLModel.metadata`，`target_metadata` 即指向它。
- **数据库 URL**：优先读环境变量 `ALEMBIC_DATABASE_URL`，否则回落到 `api.core.settings.settings.database_url`
  ——与应用连库完全一致。CI / 一次性目标可用 `ALEMBIC_DATABASE_URL` 覆盖。
- **SQLite 批处理**：`render_as_batch=True`（仅 SQLite 生效），用表重建模式模拟 SQLite 不支持的
  `ALTER`（删列/改列）。Postgres 上是 no-op。
- **类型对比**：`compare_type=True`，让 `alembic check` 能发现列类型漂移。

## 常用命令（均在 `server/` 目录下执行）

```bash
pip install -r requirements.txt          # 含 alembic

alembic upgrade head                     # 应用迁移到最新（用 settings 的库）
alembic downgrade -1                     # 回退一格
alembic downgrade base                   # 全部回退
alembic current                          # 查看当前库的版本
alembic history                          # 查看迁移链
alembic check                            # 模型与迁移有无漂移（CI 用）
```

指定其它数据库（不污染默认库）：

```bash
ALEMBIC_DATABASE_URL="sqlite:////tmp/scratch.db" alembic upgrade head
ALEMBIC_DATABASE_URL="postgresql+psycopg://u:p@host/db" alembic upgrade head
```

## 两类库的接入方式

### A. 全新的库（开发/CI/新生产实例）

```bash
alembic upgrade head     # 直接按迁移链建出全部表
```

### B. 已有的库（存量 SQLite / Postgres，结构已由旧 create_all + 补丁建好）

**不要**直接 `upgrade head`（会重复建表报错）。先打标声明"当前结构 = 基线"：

```bash
alembic stamp head       # 只写 alembic_version 版本表，不执行任何 DDL
```

之后该库就纳入 Alembic 管理，后续新迁移可正常 `upgrade`。

## 日常改 schema 的标准流程

1. 在 `api/models/<域>.py` 改/加 SQLModel 模型字段。
2. 生成迁移：
   ```bash
   alembic revision --autogenerate -m "add xxx column to yyy"
   ```
3. **人工 review** `migrations/versions/` 下新生成的脚本：
   - 确认 `upgrade()` / `downgrade()` 对称、可回滚；
   - SQLite 的删列/改列应在 `with op.batch_alter_table(...)` 块内（batch 模式已自动处理）；
   - 涉及数据搬运的，写成显式的 data migration（用 Python 解析，而非 `LIKE` SQL）。
4. 本地双向验证：
   ```bash
   alembic upgrade head && alembic downgrade -1 && alembic upgrade head
   alembic check          # 应输出 "No new upgrade operations detected."
   ```
5. 提交迁移脚本与模型改动到同一个 commit。

## 验证基线（可复现）

```bash
# 新建空库 → 建表 → 确认与模型零漂移 → 回退 → 再建
ALEMBIC_DATABASE_URL="sqlite:////tmp/verify.db" alembic upgrade head
ALEMBIC_DATABASE_URL="sqlite:////tmp/verify.db" alembic check      # No new upgrade operations detected.
ALEMBIC_DATABASE_URL="sqlite:////tmp/verify.db" alembic downgrade base
ALEMBIC_DATABASE_URL="sqlite:////tmp/verify.db" alembic upgrade head
```

Postgres 可用离线 SQL 校验方言（无需真实实例）：

```bash
ALEMBIC_DATABASE_URL="postgresql+psycopg://u:p@localhost/db" alembic upgrade head --sql
```

# 数据库迁移指南（Alembic）

> 本文是 [`enterprise-optimization.md` §4 数据库整改](enterprise-optimization.md#4-数据库整改重点) 的落地操作手册。
> 目标：让 **Alembic 成为 schema 的唯一真相来源**，SQLite（开发/单机）与 Postgres（生产）走同一套迁移脚本。

## 当前进度

按 §4.3 的分步实施，本仓库当前处于 **Step 1（引入 Alembic 并对齐当前 schema）已完成**：

- [x] **Step 1**：引入 Alembic，生成与现有 22 张表等价的基线迁移（`baseline schema`）。
- [ ] Step 2：在 `database.py` 移除 `create_all`，退役自研 DDL 补丁（`_migrate_*`）。
- [ ] Step 3：把 `run_data_consolidations` 的一次性数据整合改写成 Alembic data migration。
- [ ] Step 4：迁移与应用启动解耦（`alembic upgrade head` 作为独立步骤 / init container）。
- [ ] Step 5：CI 漂移检测 + 前进/回退测试。

> ⚠️ **过渡期注意**：Step 1 是**纯附加**的，没有改动应用启动逻辑。`api/database.py` 仍在启动时执行
> `create_all` + `run_pending_migrations` + `run_data_consolidations`。也就是说，应用现在**不依赖** Alembic
> 启动。Alembic 目前用于：(a) 新库的规范建表来源，(b) 后续 Step 2 的切换基础。两套机制并存直到 Step 2 切换完成。

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

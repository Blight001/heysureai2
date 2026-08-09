# HeySure Server 数据库迁移边界

## 唯一结构权威

PostgreSQL schema 只允许由 `deploy/server/other/migrations/` 下的 Alembic
revision 修改。`db-migrate`/`python -m api.db migrate` 是部署期唯一 DDL 入口；
Gateway、AI Runtime、MCP Runtime 和 Connector Runtime 启动时只比较数据库
revision 与代码 head，发现不一致即快速失败。

`HEYSURE_DB_AUTO_MIGRATE` 是已废弃的 Runtime 开关。设为真不会恢复旧行为，
而是直接拒绝启动，避免应用进程等待 ACCESS EXCLUSIVE 锁并阻塞登录请求。

## 三种数据库状态

| 状态 | 处理方式 |
| --- | --- |
| 空数据库 | Alembic 从 baseline 升级到 head |
| 已有业务表、无 `alembic_version` | 进入一次性 legacy-adopt 适配层，完成历史结构/数据收敛后 stamp head |
| 已有 `alembic_version` | 仅执行 Alembic upgrade head |

历史兼容实现位于 `main/api/core/migrations.py`，只允许由
`main/api/db.py::_legacy_adopt` 调用；它不在任何 Runtime 稳态启动路径中。
新 schema 或数据迁移不得继续添加到该模块，必须创建 Alembic revision。

## 兼容与移除条件

legacy-adopt 保留是为了让尚未纳管的旧部署无需人工拼接历史 DDL。满足以下
条件后可删除：

1. 所有受管环境都存在 `alembic_version` 且 revision 可升级到当前 head；
2. 最近一个兼容支持周期内没有 legacy-adopt 事件；
3. 发布备份已验证可恢复；
4. 删除适配层的版本明确声明不再支持 pre-Alembic 直接升级。

数据库回滚采用向前兼容策略：应用镜像可以回退，已执行 migration 默认不做
破坏性 downgrade。任何删除列、改约束或数据重写都必须拆成 expand/migrate/
contract 多阶段 revision。

## 验证证据

- CI 在真实 PostgreSQL 上执行 upgrade、`alembic check` 和集成测试；
- Runtime 生命周期测试捕获启动 SQL，拒绝 CREATE/ALTER/DROP/TRUNCATE；
- 长读事务与 advisory-lock 注入验证 schema guard 不被普通读事务阻塞，且锁等待
  受连接级 `lock_timeout` 限制；
- 滚动发布在替换 Runtime 前完成 migration，并逐服务等待 readiness。

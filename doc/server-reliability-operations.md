# HeySure Server 可靠性运维手册

## 唯一 Compose 入口与持久化路径

测试服务器只允许从 `/www/server/panel/data/compose/heysureai2` 执行 Compose 发布、构建、重建、迁移和滚动替换。`/www/wwwroot/heysureai2` 只承载持久化数据，不得再作为 Compose 工作目录。发布前必须检查运行中容器的 `com.docker.compose.project.working_dir`，不等于唯一入口时立即停止。

持久化挂载必须使用绝对路径，禁止生产 Compose 使用 `./deploy/server/data` 等相对路径。数据根目录固定为 `/www/wwwroot/heysureai2/deploy/server/data`：四个 Runtime 的 `/app/data` 只映射其 `app/` 子目录；PostgreSQL 的 `/var/lib/postgresql/data` 映射数据根目录，并通过 `PGDATA=/var/lib/postgresql/data/postgres` 将数据库集群限制在 `postgres/` 子目录。Runtime 不得挂载或访问 `postgres/`；`postgres/`、`postgres.failed-*` 和数据库备份不得由网页文件管理、应用清理任务或普通发布脚本移动、覆盖或删除。

重建前后都要验证 Compose 工作目录、配置文件路径、Mount Source、PostgreSQL revision 和四 Runtime readiness。仅显示容器 `running` 不算通过。变更持久化路径前必须制作 PostgreSQL custom-format 备份及原目录文件备份；旧目录或旧卷只在明确验收并再次获得删除确认后清理。

## 发布与回滚

发布前必须确认两级 Git 提交、生成 PostgreSQL custom-format 备份，并验证备份
非空。发布使用 `rolling_release.py`：先迁移，再按 Gateway、MCP、Connector、AI
顺序替换服务，每一步以 `/internal/health/ready` 为门禁。任一服务未就绪时停止
后续替换并恢复旧镜像；数据库 migration 采用向前兼容策略，不依赖破坏性降级。

发布后观察项：

1. Web 与 API 公共入口均返回成功；
2. 四 Runtime 的 live/ready/detail 与管理员服务视图一致；
3. Alembic revision 等于代码 head；
4. 过期 `running`/`pending`/`queued` 数量为零；
5. 登录、模拟 Agent 往返和真实 AI+MCP 临时会话通过；
6. 临时会话完成后清理，不保留冒烟消息。

## 故障演练矩阵

CI 的四 Runtime 作业执行以下可重复演练：

| 故障 | 注入方式 | 不变量 |
| --- | --- | --- |
| Runtime 终止/重启 | 逐 Runtime restart，普通提交 2 轮、定时任务 20 轮 | readiness 恢复，过期任务为零 |
| 网络/Agent 无响应 | 模拟 Agent 接收任务但不回执，调用方触发 expire | dispatch 进入 `timeout` 终态，设备队列释放 |
| 设备断线与重连 | 已绑定 Agent 主动断线，以同一设备身份重连 | 绑定由 PostgreSQL 恢复，后续调用成功 |
| PostgreSQL 锁等待 | 两连接竞争同一 advisory lock | 等待受 `lock_timeout` 限制，不形成永久事务 |
| 长读事务 | 保持读事务同时执行 Runtime schema guard | guard 在 2 秒内完成且不执行 DDL |

失败时保留容器日志、run/task ID、owner/lease/deadline、Alembic revision 和发布
提交，不用容器 `running` 状态代替应用 readiness。

## 每月 Top N 复查

每月首个工作日运行 `deploy/server/other/scripts/reliability_top_n.py`，将 JSON
结果随当月运维记录归档。部署环境可在 API Gateway 容器中运行：

```text
python other/scripts/reliability_top_n.py --limit 10
```

快照包含以下脱敏类别，不包含消息正文和原始 SQL：

- `slow_model_turns`：历史模型轮次延迟 Top N；
- `long_transactions`：当前长事务及年龄；
- `lock_waiters`：当前等待 PostgreSQL 锁的会话；
- `chat_run_queue`：queued/running ChatRun 队列年龄；
- `dispatch_queue`：queued/pending AgentDispatchTask 队列年龄。

复查必须记录：与上月差异、超过运行时 timeout/lease 的条目、重复出现的模型或
工具、责任模块、修复 issue 与预计完成时间。任何锁等待、超 lease 队列或持续增长
的慢请求都不能只通过调大阈值处理。

## 事故时间线最小证据

事故记录至少包含发现时间、最后正常时间、影响入口、关联提交/镜像、四 Runtime
readiness、数据库 revision、最老运行任务、锁等待、关键错误日志、缓解动作、恢复
时间与根因。凭据、Token、Cookie、私钥和消息正文不得写入记录。

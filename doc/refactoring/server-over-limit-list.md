# Server 复杂度冻结基线

基线日期：2026-08-09
执行命令：`python deploy/server/other/scripts/check_guardrails.py`

该清单由 `guardrail_baseline.json` 机器校验。存量可以下降，任何新条目或数值增长都会使 CI 失败。首次扫描得到 284 项超限；当前已降至 267 项并收紧基线。

| 指标 | 首次基线 | 当前基线 |
| --- | ---: | ---: |
| 圈复杂度 | 132 | 128 |
| 模块直接依赖 | 16 | 16 |
| 文件有效行数 | 18 | 18 |
| 函数有效行数 | 55 | 49 |
| 嵌套深度 | 34 | 30 |
| 参数数量 | 29 | 26 |

## 优先清理对象

| 文件/函数 | 首次有效规模 | 目标 |
| --- | ---: | ---: |
| `main/ai_runtime/inference/core.py` | 2933 → 2413 行 | 文件 < 800，编排函数 < 80 |
| `_run_worker_impl` | 1626 → 1436 行 | < 80 |
| `_execute_turn_call` | 539 → 535 行 | 独立状态机，无函数 > 200 |
| `main/api/core/migrations.py` | 1589 行 | 只保留显式迁移兼容入口 |
| `main/gateway/routers/admin.py` | 1349 行 | 路由按服务拆分 |
| `main/connector_runtime/dispatch/device_dispatch.py` | 1106 → 808 行 | 状态、仓储、队列、结果分层 |
| `register_agent_socket_events` | 284 → 25 行 | 已完成：只装配 handler |
| `_register_builtin_tools` | 293 → 3 行 | 已完成：声明式模块表 |

## 豁免规则

当前没有永久豁免。Alembic 版本文件不在生产扫描目录中；协议样本、生成数据或集中夹具若未来需要豁免，必须同时记录原因、负责人和计划移除阶段，且不得通过提高全局基线绕过。

## 基线维护

1. 普通开发只运行检查，不得使用 `--write-baseline`。
2. 完成拆分并确认行为等价后，审阅差异，再执行 `--write-baseline` 收紧。
3. 基线文件的超限条目总数和单项数值只能下降。
4. 新文件不得进入超限表。

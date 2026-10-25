# MCP Program Orchestrator

## 目标

`mcp.program` 是一个协议兼容的 Meta-MCP：客户端只需要调用一个普通 MCP
工具，服务端负责在权限边界内编排多个 MCP。它不替代普通 tool call，也不把
任意 JavaScript 直接暴露给生产进程。

```text
MCP Client / Agent
        │ tools/call: mcp.program
        ▼
MCP Runtime
        ├─ 校验 workflow
        ├─ 重新执行每个子工具的 AI 能力授权
        ├─ 依赖调度 / foreach / 有界并发
        └─ 聚合结果
```

## 第一阶段：已落地的 JSON workflow

当前实现位于 `server/tools/program.py`，并注册在
`server/main/mcp_runtime/mcp/builtin_catalog.py`。

支持：

- `action=validate|run`
- `steps`、`depends_on` 和循环检测
- `${input.foo}`、`${steps.fetch.result.items}`、`${item.file_ref}` 引用
- `foreach` 批量调用和 `concurrency` 上限
- 同一依赖层的独立步骤并发执行
- `allowed_tools`、最大步骤数、最大 fan-out、参数/结果大小和总耗时限制
- 每个子调用重新执行 `capability_view.ensure_tool_eligible`
- 禁止嵌套 `mcp.program`

示例：

```json
{
  "action": "run",
  "input": {"query": "项目文档"},
  "program": {
    "steps": [
      {
        "id": "search",
        "tool": "knowledge.search",
        "arguments": {"query": "${input.query}"}
      },
      {
        "id": "details",
        "tool": "workspace.file+manage",
        "depends_on": ["search"],
        "foreach": "${steps.search.result.items}",
        "arguments": {
          "action": "info",
          "file_ref": "${item.file_ref}"
        },
        "concurrency": 4
      }
    ],
    "output": "${steps.details.items}"
  }
}
```

## 第二阶段：已落地的持久化异步任务

`mcp.program` 现在支持 `mode=async`，返回 `run_id`。MCP Runtime 的后台 worker
从 `McpProgramRun` 队列取任务，并支持：

- `action=get` 查询状态和结果
- `action=cancel` 请求取消
- PostgreSQL 持久化输入、上下文、结果和错误（加密 envelope）
- owner、lease、deadline、取消标记和终态
- worker lease 过期时标记为失败，不自动重放可能有副作用的工具

数据库迁移：
`server/other/migrations/versions/h1i2j3k4l5m6_add_mcp_program_runs.py`。

### 第三阶段：审批和副作用边界

- 只读工具允许同层并发。
- 写入、删除、发送、发布等工具默认串行。
- 高风险工具暂停为 `waiting_approval`，审批后从 checkpoint 继续。
- 写操作带幂等键，重试只针对明确的瞬时错误。

### 第四阶段：受限 JavaScript 前端

JS 只编译或执行为上述 workflow 能力，宿主只注入 `mcp.call`、`mcp.map` 等
受控 API。禁止网络、文件系统、环境变量、子进程和任意模块导入。JS 引擎
必须运行在独立的沙箱/工作进程内，不能把 Node `vm` 本身当作安全边界。

## 验证

```powershell
cd deploy/server
$env:PYTHONPATH = "main;."
.\venv\Scripts\python.exe -m pytest -q other/tests/test_mcp_program.py
```

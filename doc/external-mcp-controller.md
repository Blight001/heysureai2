# HeySure 外部 MCP 控制器

## 目标

数字成员可选择两种执行方式：

- `internal_model`：沿用 HeySure 内置模型推理和聊天流程。
- `external_mcp`：由 Codex 等远程 MCP 客户端控制，不调用 HeySure 内置模型。

外部控制成员的网页对话输入关闭，只显示经过脱敏持久化的 MCP 调用结果。控制器能读取该成员当前人格 Prompt、绑定设备和 MCP 范围，但不能读取模型密钥、用户 Token、Cookie 或服务器环境变量。

## 接入流程

1. 在 AI 配置中选择“外部 MCP 控制”并保存。
2. 点击“生成新的控制文档”。服务器生成一个成员级、可吊销、最长 90 天的 Bearer 凭证；明文只返回一次，数据库只保存 SHA-256 哈希。
3. 将控制文档交给 Codex。文档包含远程 Streamable HTTP MCP 地址、环境变量方式的凭证配置和工作约定。
4. Codex 重启并连接后，先调用 `heysure.get_context`，再用运行日志和 `heysure.call_mcp` 工作。
5. 用户可随时吊销凭证；生成新文档也会自动吊销该成员此前的活动凭证。

## 远程 MCP 合同

公开端点：`POST /mcp/external`，采用 JSON-RPC 2.0 的 Streamable HTTP 请求方式，支持 `initialize`、`ping`、`tools/list` 和 `tools/call`。

稳定控制工具：

| 工具 | 权限范围 | 作用 |
| --- | --- | --- |
| `heysure.get_context` | `context:read` | 读取成员 Prompt、设备与配置的 MCP 范围 |
| `heysure.list_mcp_tools` | `context:read` | 查看当前配置工具及 Schema |
| `heysure.call_mcp` | `mcp:call` | 通过原有网关权限链调用服务器或设备 MCP |
| `heysure.start_run` | `run:write` | 建立带 owner、lease 和 deadline 的工作运行 |
| `heysure.finish_run` | `run:write` | 将运行写入不可复活的终态 |
| `heysure.list_events` | `audit:read` | 读取近期脱敏控制日志 |

`heysure.call_mcp` 不直接调用 Registry。它复用现有网关调用入口，因此继续受以下规则约束：成员 MCP 开关、成员工具白名单、角色上限、工具箱/图书馆绑定、端侧设备在线状态和设备权限。

## 状态和恢复语义

控制凭证状态：`active -> revoked | expired`。终态凭证不能恢复，只能重新生成。

控制运行状态：

```text
queued -> leased -> running -> succeeded | failed | cancelled | expired
```

终态不可复活。运行记录包含 credential owner、lease owner、lease deadline、开始/结束时间与摘要。MCP 日志不保存调用参数，只保存脱敏和截断后的结果，避免把密码、Token、Cookie、Secret 等写入审计表。

## 数据与迁移

Alembic revision `fa1b2c3d4e5f` 增加：

- `assistantaiconfig.execution_mode`
- `externalcontrollercredential`
- `externalcontrollerrun`
- `externalcontrollerevent`

外部控制记录通过数据库外键级联跟随用户或 AI 配置删除；Runtime 启动不执行任何 DDL。

## 运维检查

- 公网反向代理必须把 `/mcp/` 转发到 Gateway 3000，且不得记录 Authorization 请求头。
- 正式使用 HTTPS；当前测试服务器的 HTTP 只适合受控联调。
- 发布前执行 PostgreSQL custom-format 备份和 Alembic 迁移。
- 发布后验证凭证生成、MCP initialize/tools/list、context、一次只读 MCP 调用、运行终态、吊销后 401，以及网页只读日志。

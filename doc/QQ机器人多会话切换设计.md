# QQ 机器人多会话切换设计

> 目标：让 QQ 用户能在同一个 AI 下，自由切换/新建/列出**自己在 QQ 建的**对话记录，
> 由 AI 调用 MCP 工具来完成，而不是被钉死在唯一一条会话上。
>
> 状态：设计稿（尚未实现）。分支：`claude/qq-bot-message-delivery-rrRPP`。

---

## 一、问题与误解澄清

### 1.1 现象
服务器联调 QQ 机器人：能连上、能收到用户消息，但"发不回去"，或感觉只能跟一个对话绑定。

### 1.2 核心误解
QQ 官方机器人**没有"同一时刻只能锁定一个对话"的限制**。所谓"锁定"是对**被动回复机制**的误读：

- **被动回复**：用收到的那条用户消息的 `msg_id`（或事件 `event_id`）作为凭证回复。
  - 有效期 **5 分钟**；
  - 同一个 `msg_id` 下可回复多条，用 `msg_seq` 区分（从 1 开始，**同一 msg_id 内必须唯一递增**）。
- **主动推送**：不带 `msg_id` 直接推，需要单独申请的主动消息权限，且有严格频控；没权限会被拒。

关键结论：

> **投递地址跟着"人"走（openid + msg_id），会话只是"消息归到哪段历史"的逻辑分组。二者完全独立。**
> 机器人永远是"回复刚才给我发消息的那个人"，不管这条消息归到哪个 `session_id`，都能正常发回去。
> 因此"切换会话"和"能不能回复"互不冲突 —— **不存在锁**。

### 1.3 当前代码为什么"显得"被锁死
`server/connector_runtime/bots/qq/router.py` 把会话写死了：

```python
session_key = f"{target_type}_{target_id}"
session_id  = f"qq_{config_id}_{session_key}"   # 一个 openid = 永远唯一一条会话
```

一个 openid 永远映射到同一个 `session_id`，所以这个 QQ 用户无法切到该 AI 的其它对话记录。
这只是**路由策略写死了**，不是平台限制。

---

## 二、产品决策（已确认）

| 项 | 决策 |
| --- | --- |
| 会话可见范围 | **仅本人在 QQ 建的会话**（按 openid 隔离，看不到他人/网页端的会话） |
| 切换触发方式 | **让 AI 调用 MCP 工具**完成（用户自然语言说"换个对话/新开一个"，AI 理解后调工具），不用前缀指令 |
| MCP 跨进程上下文 | **打通 HTTP 上下文**（在 `/internal/mcp/call` 传递 `session_context`） |

---

## 三、关键架构事实（实现前必须知道）

### 3.1 部署是分进程的（remote 模式）
`docker-compose.yml`：

```
MCP_RUNTIME_URL=http://mcp-runtime:3001
CONNECTOR_RUNTIME_URL=http://connector-runtime:3002
AI_RUNTIME_URL=http://ai-runtime:3003
AI_DISPATCH_MODE=remote
```

含义：**MCP 工具是跨进程 HTTP 调用的**。
`server/ai_runtime/inference/core.py::_call_mcp_via_runtime` 只在 body 里发
`{tool, user_id, ai_config_id, arguments}`，**不带 `session_id`**。

因此工具进程里 `get_run_session_context()` **返回 None**。
→ 现有 `conversation.forget_before_current / find / create / delete` 在该部署下其实是
**降级依赖 AI 自己传 `session_id`**；要让"切换会话"工具可靠知道"当前是哪个 QQ 用户/哪条会话"，
**必须把会话上下文打通到工具进程**。

### 3.2 会话上下文当前在哪设置
`server/ai_runtime/inference/core.py:969` worker 内：

```python
set_run_session_context({
    "user_id": user_id,
    "ai_config_id": ai_config_id,
    "ai_kind": ai_kind,
    "session_id": session_id,
    "session_name": session_name,
    "model": model,
    "current_user_message_id": current_user_message_id,
})
```

这是 `connector_runtime.dispatch.agent_dispatch` 里的 `contextvar`，**仅在 worker 进程/线程内有效**，
跨 HTTP 到 mcp-runtime 后失效。

### 3.3 收发链路（现状）
```
long_connection.py  (botpy 长连接收消息)
        │  on_c2c_message_create / on_group_at_message_create ...
        ▼
router.py::handle_qq_event_payload
        │  落库 user 消息 + 起 ChatRun + register_qq_session_route
        ▼
ai_runtime worker (core._run_worker) 生成回复，落库 assistant 消息
        │  chat_persistence._save_message → notify.notify_saved_assistant_message
        ▼
notify.py  → bot.load_session_route(session_id) → 拿到 target_id(openid)/msg_id/msg_seq
        ▼
qq/adapter.py::notify_assistant_message → service.send_qq_text_message (被动回复)
```

路由表 `BotSessionRoute` 按 `(channel, user_id, ai_config_id, ai_kind, session_id)` 唯一，
`target_json` 存 `{target_id, target_type}`，外加 QQ 专用列 `source_message_id / source_event_id / next_msg_seq`。

---

## 四、设计方案

### 4.1 核心思想
把"一个 openid 固定一条会话"改成"**一个 openid 带一个可切换的会话游标**"：

- **投递不变**：仍按 `session_id → BotSessionRoute → openid + msg_id` 被动回复，天然支持并发多会话，无需任何锁。
- **会话游标**：新增 `(channel, ai_config_id, ai_kind, openid) → active_session_id` 的指针。
  入站消息按游标归档；无游标则用默认 home 会话（向后兼容）。
- **归属隔离**：某 openid "拥有"的会话 = 存在 `BotSessionRoute(channel=qq, target_id=该openid, session_id=X)` 的所有 X。
  `list_mine` 据此过滤，实现"仅本人在 QQ 建的会话"。

### 4.2 切换语义
- AI 在对话中调 `conversation.switch`：**当前这条消息仍在原会话回复**（回复跟着 openid 走，照常发回），
  **下一条用户消息起进入新会话**，AI 回一句确认。
- 新建 `conversation.new`：建空会话 + 登记归属（写一条 `BotSessionRoute` 占位行，`source_message_id` 留空，
  下一条入站消息会补上）+ 设游标。

---

## 五、改动清单（6 项）

### 改动 1：打通跨进程会话上下文（基础，顺带修好现有工具）
- `server/ai_runtime/inference/core.py::_call_mcp_via_runtime`
  在 HTTP body 增加 `session_context`（即当前 run 的 `get_run_session_context()` 快照）。
- `server/mcp_runtime/app.py` 的 `CallRequest` 增加可选 `session_context` 字段；
  `POST /internal/mcp/call` 收到后用 `set_run_session_context(...)` 包裹 `registry.call`，调用结束复位。
- 附带收益：现有 `conversation.forget_before_current / find / create / delete` 在 remote 模式下
  也能可靠拿到 `session_id`，不再依赖 AI 猜参数。

> 注意：in-process 模式（`MCP_RUNTIME_URL` 为空）走 `registry.call`，contextvar 本就有效；
> 此改动只影响 remote HTTP 路径，需保持两种模式都正确。

### 改动 2：新增游标表 `BotUserCursor`
位置：`server/api/models/bot_session_route.py`，并在 `server/api/models/__init__.py` 导出。

```python
class BotUserCursor(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    channel: str = Field(index=True)
    user_id: int = Field(foreign_key="user.id", index=True)   # AI 拥有者
    ai_config_id: int = Field(foreign_key="assistantaiconfig.id", index=True)
    ai_kind: str = Field(default="core", index=True)
    target_id: str = Field(index=True)                         # 外部用户（QQ openid）
    active_session_id: str = Field(default="")
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)
```

> 新表由各 runtime 启动时的 `create_db_and_tables()`（`SQLModel.metadata.create_all`）自动创建，
> **无需写 ALTER 迁移**（`create_all` 只建缺失的表，不改已有表）。

唯一性：逻辑上 `(channel, ai_config_id, ai_kind, target_id)` 唯一，读写时按这四元组 upsert。

### 改动 3：游标 / 归属 helper
位置：`server/connector_runtime/bots/qq/routes_store.py`（或新建 `session_cursor.py`，保持 channel 无关以便他 bot 复用）。

- `get_active_session_id(session, *, user_id, ai_config_id, ai_kind, target_id, default) -> str`
  - 查 `BotUserCursor`；若指向的会话已不存在或不归该 openid，回退 `default` 并重置游标。
- `set_active_session_id(session, *, user_id, ai_config_id, ai_kind, target_id, session_id)`
  - upsert 游标。
- `list_target_sessions(session, *, user_id, ai_config_id, ai_kind, target_id) -> list[dict]`
  - 取 `BotSessionRoute(channel=qq, ...)`，在 Python 里按 `target_json.target_id == openid` 过滤，
    join `ChatSession` 拿名称/更新时间（数量按"一个 AI 的 QQ 会话数"，规模可控）。
- `resolve_target_for_session(session, *, user_id, ai_config_id, ai_kind, session_id) -> Optional[str]`
  - 由当前 `session_id` 反查 `BotSessionRoute` 拿 openid，供 MCP 工具确定"我在跟谁说话"。

### 改动 4：改 `router.py` 入站路由
`handle_qq_event_payload` 内，把写死的 `session_id` 改为：

```python
home_session_id = f"qq_{config_id}_{target_type}_{target_id}"
session_id = get_active_session_id(
    session,
    user_id=cfg.user_id, ai_config_id=cfg.id, ai_kind=ai_kind,
    target_id=target_id, default=home_session_id,
)
# 首次接触：游标不存在时落为 home，并确保 home 的归属路由存在
```
`session_name` 改为：优先取该 `session_id` 对应 `ChatSession.session_name`，否则用默认名。
其余（落库、`register_qq_session_route`、起 run、busy 回复、deferred）逻辑不变，
只是它们现在作用在"游标指向的会话"上。

### 改动 5：三个 MCP 工具
位置：handler 写在 `server/mcp_runtime/mcp/tools/conversation.py`；
注册在 `server/mcp_runtime/mcp/registry.py`；权限在 `server/mcp_runtime/mcp/permissions.py`（均 `ROLE_MEMBER`）。

所有工具先用 `get_run_session_context()`（改动 1 后跨进程可用）拿到 `session_id`，
再 `resolve_target_for_session` 反查出当前 openid，从而**按 openid 隔离**。

- `conversation.list_mine`
  - 列出当前 QQ 用户自己的会话（id / 名称 / 最近消息时间 / 是否当前活跃）。
- `conversation.switch`
  - 入参 `session_id`（或 `name`/`query` 解析）；校验目标会话在 `list_mine` 范围内；
    `set_active_session_id`；返回"已切换，下一条消息起生效"。
- `conversation.new`
  - 入参 `name`；建 `ChatSession` + 写 `BotSessionRoute` 归属占位行（复制当前 `target_json`，`source_message_id=""`）+ 设游标。
  - 与现有 `conversation.create` 区别：`new` 会绑定到当前 QQ 用户并切过去；`create` 保持通用不动。

### 改动 6：`_build_qq_runtime_prompt` 加引导
在 `server/connector_runtime/bots/qq/router.py::_build_qq_runtime_prompt` 追加：
当用户表达"换/切换/列出/新开 对话/会话"时，调用 `conversation.list_mine / switch / new`；
切换对下一条消息生效，本条回复照常发回当前对话。

---

## 六、边界与注意事项

1. **向后兼容**：老 QQ 用户无游标 → 自动用 home 会话，行为与现状一致。
2. **活跃会话被删**：游标指向不存在的会话时，回退 home 并重置游标，避免"发不出/找不到"。
3. **隐私隔离**：`list_mine`/`switch` 必须严格按 openid 过滤，绝不能让 A 切入 B 或网页端会话。
4. **被动窗口/ msg_seq**（与本特性正交，但建议一并体检）：
   - `routes_store.py` 里 `next_msg_seq` 跨 `msg_id` 只增不重置 —— 新 `msg_id` 应从 `seq=1` 重新开始；
   - AI 生成慢或被 `_wait_for_qq_idle_then_run`（最长可等 24h）拖到 5 分钟外，`msg_id` 过期 → 被动回复必失败，
     目前**无降级、错误被静默吞掉**（`router.py:_send_qq_text` / `adapter.py:notify_assistant_message` 只 `logger.exception`）。
     建议：发送失败时把腾讯返回的 `code/message` 透出到日志与 `/api/qq/diagnose`，便于定位。
5. **两种部署模式都要测**：`MCP_RUNTIME_URL` 置空（in-process）与设值（remote HTTP）下，切换工具都要正确。

---

## 七、实现顺序建议

1. 改动 1（HTTP 上下文）→ 单独验证现有 `conversation.find` 在 remote 模式能拿到 `session_id`。
2. 改动 2 + 3（表 + helper）。
3. 改动 4（路由切换，默认 home，确保兼容）。
4. 改动 5（三个工具）+ 6（prompt）。
5. 端到端联调：QQ 里说"列出我的对话""新开一个聊旅游的""切回刚才那个"，验证归属隔离与回复投递。

---

## 八、涉及文件速查

| 改动 | 文件 |
| --- | --- |
| HTTP 上下文 | `server/ai_runtime/inference/core.py`、`server/mcp_runtime/app.py` |
| 游标表 / 模型 | `server/api/models/bot_session_route.py`、`server/api/models/__init__.py` |
| 游标 / 归属 helper | `server/connector_runtime/bots/qq/routes_store.py` |
| 入站路由 | `server/connector_runtime/bots/qq/router.py` |
| MCP 工具 | `server/mcp_runtime/mcp/tools/conversation.py`、`registry.py`、`permissions.py` |
| 提示词 | `server/connector_runtime/bots/qq/router.py::_build_qq_runtime_prompt` |
| （可选）发送健壮性 | `server/connector_runtime/bots/qq/service.py`、`adapter.py` |

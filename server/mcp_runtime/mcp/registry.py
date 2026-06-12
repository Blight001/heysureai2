from .core import MCPRegistry, MCPTool
from .tools.introspection import (
    _mcp_describe_tool,
)
from .tools.workspace import (
    _get_overview,
    _list_agents,
    _run_command,
)
from .tools.tasks import (
    _task_complete,
    _task_create,
    _task_delete,
    _task_inherit,
    _task_list,
    _task_update,
)
from .tools.prompts import (
    _prompt_list_targets,
    _prompt_read_ai,
    _prompt_read_system,
    _prompt_write_ai,
    _prompt_write_system,
)
from .tools.evolution import (
    _evolution_input,
    _evolution_list,
    _evolution_review,
)
from .tools.communication import (
    _ai_send_message,
    _user_send_message,
)
from .tools.conversation import (
    _create_conversation,
    _delete_conversation,
    _find_conversation,
    _forget_before_current,
    _list_conversations,
    _new_conversation,
    _switch_conversation,
)
from .tools.librarian import (
    _librarian_archive,
    _librarian_consult,
    _librarian_list_topics,
    _librarian_propose,
    _librarian_read,
)
from .tools.web_search import _web_search


def _register_builtin_tools(registry: MCPRegistry) -> None:
    """Populate ``registry`` with all builtin tools.

    Extracted so ``mcp_runtime.mcp.loader`` can rebuild a fresh registry on hot
    reload without needing to ``importlib.reload`` this module (which would
    invalidate references held by callers).
    """
    registry.register(MCPTool(
        name="mcp.describe_tool",
        description=(
            "Load the full description and input schema for allowed MCP tools, then call them. "
            "Pass tool for one tool, tools (array) to load several at once, or query to keyword-search "
            "by name/description. Loaded tools become directly callable."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "tool": {"type": "string", "description": "Exact MCP tool name to inspect."},
                "name": {"type": "string", "description": "Alias of tool."},
                "tools": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Several exact tool names to load in one call.",
                },
                "query": {"type": "string", "description": "Keyword to search across tool names and descriptions."},
            },
        },
        handler=_mcp_describe_tool,
    ))

    registry.register(MCPTool(
        name="workspace.search",
        description="Search the public web using Tavily. Use for current or external information that is not available in the conversation or workspace.",
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query."},
                "search_depth": {
                    "type": "string",
                    "enum": ["basic", "advanced"],
                    "description": "Tavily search depth. Defaults to advanced.",
                },
                "max_results": {"type": "integer", "description": "Maximum results to return, 1-20. Defaults to 5."},
                "include_answer": {"type": "boolean", "description": "Whether Tavily should include a generated answer."},
                "include_raw_content": {"type": "boolean", "description": "Whether to include raw page content when available."},
                "include_images": {"type": "boolean", "description": "Whether to include image results when available."},
            },
            "required": ["query"],
        },
        handler=_web_search,
    ))

    registry.register(MCPTool(
        name="workspace.run_command",
        description=(
            "Run a shell command for development or workspace inspection. Defaults to the current user's "
            "workspace directory with the normal process environment; absolute paths and environment variables "
            "are allowed. Set strict_workspace or sandbox_env when an isolated workspace-only run is needed."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "Command to run."},
                "cwd": {
                    "type": "string",
                    "description": "Optional working directory. Relative paths resolve inside the workspace; absolute paths are allowed.",
                },
                "timeout": {
                    "type": "integer",
                    "description": "Optional timeout in seconds, capped at 600. Defaults to 120.",
                },
                "strict_workspace": {
                    "type": "boolean",
                    "description": "When true, reject an absolute cwd outside the workspace. Defaults to false.",
                },
                "workspace_only": {
                    "type": "boolean",
                    "description": "Alias of strict_workspace.",
                },
                "sandbox_env": {
                    "type": "boolean",
                    "description": "When true, use isolated HOME/TEMP folders inside the workspace. Defaults to false.",
                },
                "isolated_env": {
                    "type": "boolean",
                    "description": "Alias of sandbox_env.",
                },
            },
            "required": ["command"],
        },
        handler=_run_command,
        destructive=True,
    ))
    registry.register(MCPTool(
        name="admin.list_agents",
        description="List connected socket agents and managed AI configs for current user.",
        input_schema={"type": "object", "properties": {}},
        handler=_list_agents,
    ))
    registry.register(MCPTool(
        name="admin.get_overview",
        description="Get admin overview of workspace state plus connected socket agents and managed AI configs.",
        input_schema={"type": "object", "properties": {}},
        handler=_get_overview,
    ))
    registry.register(MCPTool(
        name="task.create",
        description=(
            "Create a task with explicit mode. mode=immediate runs as soon as the scheduler picks it; "
            "mode=scheduled creates a one-time scheduled task using schedule_at or schedule_duration_minutes; "
            "mode=recurring creates a loop task. Loop styles via schedule_loop_mode: "
            "interval (every schedule_duration_minutes after completion), "
            "daily (every day at schedule_daily_time), "
            "weekly (on schedule_weekly_days at schedule_daily_time). "
            "Loops can be bounded by schedule_max_runs and/or schedule_end_at. "
            "schedule_at/schedule_end_at must be Unix seconds or timezone-aware ISO-8601."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "mode": {
                    "type": "string",
                    "enum": ["immediate", "scheduled", "recurring"],
                    "description": "任务类型：immediate=立即执行，scheduled=一次性定时，recurring=循环运行。",
                },
                "title": {"type": "string", "description": "任务标题。"},
                "instruction": {"type": "string", "description": "任务执行说明/要求。"},
                "priority": {"type": "integer", "description": "优先级 1-10，默认 5。"},
                "schedule_at": {"type": ["number", "string"], "description": "一次性执行时间。支持 Unix 秒，或带时区的 ISO-8601（必须包含 +08:00 或 Z）。"},
                "schedule_duration_minutes": {"type": "integer", "description": "scheduled: now + 该分钟数；recurring(interval): 每轮完成后的循环间隔（分钟）。默认 30。"},
                "schedule_loop_mode": {
                    "type": "string",
                    "enum": ["interval", "daily", "weekly"],
                    "description": "循环方式（仅 mode=recurring）：interval=按间隔分钟，daily=每天定时，weekly=每周指定星期定时。默认 interval。",
                },
                "schedule_daily_time": {"type": "string", "description": "daily/weekly 循环的触发时刻 HH:MM（服务器本地时区），如 \"09:30\"。"},
                "schedule_weekly_days": {
                    "type": "array",
                    "items": {"type": "integer"},
                    "description": "weekly 循环的星期列表，0=周一 ... 6=周日，如 [0,2,4]。",
                },
                "schedule_max_runs": {"type": "integer", "description": "循环总轮数上限，0 或省略 = 不限。跑满后自动停止续期。"},
                "schedule_end_at": {"type": ["number", "string"], "description": "循环截止时间（Unix 秒或带时区 ISO-8601）；下一轮超过该时刻则停止续期。"},
                "schedule_run_immediately": {"type": "boolean", "description": "mode=recurring 时是否首轮立即执行。"},
                "template_id": {"type": "string", "description": "可选模板 ID。"},
                "target_ai_config_id": {"type": "integer", "description": "assistant_admin 代理投递目标 AI 配置 ID。"},
            },
            "required": ["mode", "title", "instruction"],
        },
        handler=_task_create,
        destructive=True,
    ))
    registry.register(MCPTool(
        name="task.list",
        description=(
            "List task jobs. By default returns active queued/running/paused tasks. "
            "Set current_only=true to return the current task (running first, then queued, then paused). "
            "Set include_history=true to include completed/cancelled/stopped/error history, or history_only=true "
            "to return only historical finished tasks. assistant_admin can proxy to digital_member "
            "(auto or target_ai_config_id)."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "current_only": {"type": "boolean", "description": "Return only the current task as task and tasks[0]."},
                "current": {"type": "boolean", "description": "Alias of current_only."},
                "include_history": {"type": "boolean", "description": "Include finished historical tasks in addition to active tasks."},
                "history": {"type": "boolean", "description": "Alias of include_history."},
                "history_only": {"type": "boolean", "description": "Return only finished historical tasks."},
                "status": {
                    "description": "Optional status or comma-separated statuses to filter.",
                    "oneOf": [
                        {"type": "string"},
                        {"type": "array", "items": {"type": "string"}},
                    ],
                },
                "limit": {"type": "integer", "description": "Max rows when history/status filtering is used. 1-500, default 100."},
                "job_id": {"type": "string", "description": "Optional task job id to fetch through task.list."},
                "target_ai_config_id": {"type": "integer"},
                "target_config_id": {"type": "integer"},
            },
        },
        handler=_task_list,
    ))
    registry.register(MCPTool(
        name="task.update",
        description=(
            "Admin/manager takeover tool: update an existing task job's title, instruction, priority, status, "
            "or schedule metadata. status is limited to queued/paused; running task prompt text is not rewritten."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "job_id": {"type": "string", "description": "Task job id to update."},
                "title": {"type": "string", "description": "New task title."},
                "instruction": {"type": "string", "description": "New task instruction."},
                "priority": {"type": "integer", "description": "Priority 1-10."},
                "status": {"type": "string", "enum": ["queued", "paused"], "description": "Optional takeover state."},
                "mode": {"type": "string", "enum": ["immediate", "scheduled", "recurring"], "description": "Optional schedule mode update."},
                "schedule_at": {"type": ["number", "string"], "description": "For mode=scheduled. Unix seconds or timezone-aware ISO-8601."},
                "schedule_duration_minutes": {"type": "integer", "description": "For scheduled/recurring."},
                "schedule_run_immediately": {"type": "boolean", "description": "For mode=recurring first run."},
                "target_ai_config_id": {"type": "integer", "description": "assistant_admin/manager proxy target AI config id."},
            },
            "required": ["job_id"],
        },
        handler=_task_update,
        destructive=True,
    ))
    registry.register(MCPTool(
        name="task.delete",
        description=(
            "Admin/manager takeover tool: hard delete a task job. Active runs are stopped and related task "
            "conversation messages/sessions are removed."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "job_id": {"type": "string", "description": "Task job id to hard delete."},
                "target_ai_config_id": {"type": "integer", "description": "assistant_admin/manager proxy target AI config id."},
            },
            "required": ["job_id"],
        },
        handler=_task_delete,
        destructive=True,
    ))
    registry.register(MCPTool(
        name="task.inherit",
        description="Submit inheritance summary before rotating to next task generation.",
        input_schema={
            "type": "object",
            "properties": {
                "job_id": {"type": "string"},
                "summary": {"type": "string"},
            },
            "required": ["summary"],
        },
        handler=_task_inherit,
        destructive=True,
    ))
    registry.register(MCPTool(
        name="task.complete",
        description="Mark current task as completed.",
        input_schema={
            "type": "object",
            "properties": {
                "job_id": {"type": "string"},
                "summary": {"type": "string"},
            },
            "required": [],
        },
        handler=_task_complete,
        destructive=True,
    ))

    # 与用户通信：把底层机器人投递封装为业务语义上的"给用户发消息"。
    registry.register(MCPTool(
        name="message.send_to_user",
        description=(
            "Send a text message to the human user via the bound bot channel (Feishu or QQ). "
            "Use this for proactive notifications, status updates, or asking the user to take action "
            "asynchronously."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Message text to send to the user. Optional when sending media."},
                "channel": {
                    "type": "string",
                    "enum": ["feishu", "qq"],
                    "description": "Delivery channel. Defaults to the AI config bot channel.",
                },
                "receive_id": {"type": "string", "description": "Optional receiver id; defaults to AI config default."},
                "receive_id_type": {
                    "type": "string",
                    "enum": ["chat_id", "open_id", "user_id", "union_id", "email", "c2c", "group", "channel", "dm"],
                    "description": "Receiver id type; for QQ use c2c/group/channel/dm.",
                },
                "chat_id": {"type": "string", "description": "Alias of receive_id."},
                "open_id": {"type": "string", "description": "Alias of receive_id."},
                "target_id": {"type": "string", "description": "QQ target id alias."},
                "target_type": {"type": "string", "enum": ["c2c", "group", "channel", "dm"], "description": "QQ target type."},
                "media_url": {"type": "string", "description": "HTTP(S) URL of an image or video for the server to fetch and send."},
                "media_path": {"type": "string", "description": "Server-local image or video path to send."},
                "media_type": {"type": "string", "enum": ["image", "video"], "description": "Optional explicit media type."},
                "image_url": {"type": "string", "description": "Alias of media_url with media_type=image."},
                "video_url": {"type": "string", "description": "Alias of media_url with media_type=video."},
                "image_path": {"type": "string", "description": "Alias of media_path with media_type=image."},
                "video_path": {"type": "string", "description": "Alias of media_path with media_type=video."},
                "file_name": {"type": "string", "description": "Optional filename to use when uploading media."},
                "duration": {"type": "integer", "description": "Optional media duration in milliseconds for Feishu video upload."},
            },
            "required": [],
        },
        handler=_user_send_message,
        destructive=True,
    ))

    registry.register(MCPTool(
        name="conversation.forget_before_current",
        description=(
            "Delete only the messages before the current user message in this active conversation. "
            "Use when the user asks to forget previous context, reset prior context, or ignore everything before now. "
            "This preserves the current user request and future messages; it does not clear the whole session."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "Optional. Defaults to the active run session.",
                },
                "current_message_id": {
                    "type": "integer",
                    "description": "Optional. Defaults to the current user message in the active run.",
                },
            },
        },
        handler=_forget_before_current,
        destructive=True,
    ))

    registry.register(MCPTool(
        name="conversation.find",
        description=(
            "Find/list chat sessions for the current AI scope. Search by session name, session id, "
            "or message content. Omit query to list recent sessions."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Optional keyword to search in session name, id, and message content."},
                "keyword": {"type": "string", "description": "Alias of query."},
                "session_id": {"type": "string", "description": "Optional exact session id."},
                "ai_config_id": {"type": "integer", "description": "Optional target AI config id. Defaults to current AI."},
                "ai_kind": {"type": "string", "description": "Optional AI kind. Defaults to current run or assistant."},
                "limit": {"type": "integer", "description": "Maximum sessions to return, 1-100. Defaults to 20."},
                "include_messages": {"type": "boolean", "description": "Include full messages for matched sessions."},
            },
            "required": [],
        },
        handler=_find_conversation,
    ))

    registry.register(MCPTool(
        name="conversation.create",
        description="Create a new empty chat session for the current AI scope.",
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Session name. Defaults to 未命名会话."},
                "session_name": {"type": "string", "description": "Alias of name."},
                "session_id": {"type": "string", "description": "Optional explicit session id. Usually omit this."},
                "ai_config_id": {"type": "integer", "description": "Optional target AI config id. Defaults to current AI."},
                "ai_kind": {"type": "string", "description": "Optional AI kind. Defaults to current run or assistant."},
            },
            "required": [],
        },
        handler=_create_conversation,
        destructive=True,
    ))

    registry.register(MCPTool(
        name="conversation.delete",
        description="Delete a chat session and all messages in it for the current AI scope.",
        input_schema={
            "type": "object",
            "properties": {
                "session_id": {"type": "string", "description": "Session id to delete. Defaults to active run session when available."},
                "ai_config_id": {"type": "integer", "description": "Optional target AI config id. Defaults to current AI."},
                "ai_kind": {"type": "string", "description": "Optional AI kind. Defaults to current run or assistant."},
            },
            "required": [],
        },
        handler=_delete_conversation,
        destructive=True,
    ))

    registry.register(MCPTool(
        name="conversation.list",
        description=(
            "List all conversations in this AI's shared pool (the unified 机器人对话区), "
            "covering the web UI and every bot channel. Returns each session's id, name, "
            "source channel, last-update time, and whether it is the active one for you. "
            "Use when the user asks to see / list their conversations or wants to pick one to switch to."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "Max sessions to return, 1-200. Defaults to 50."},
                "ai_config_id": {"type": "integer", "description": "Optional target AI config id. Defaults to current AI."},
                "ai_kind": {"type": "string", "description": "Optional AI kind. Defaults to current run."},
            },
            "required": [],
        },
        handler=_list_conversations,
    ))

    registry.register(MCPTool(
        name="conversation.switch",
        description=(
            "Switch the active conversation for the current user/identity to another session "
            "in this AI's shared pool. Provide session_id, or name/query to match by title. "
            "Takes effect from the user's NEXT message; the current reply still goes to the "
            "current conversation. Use when the user says 'switch conversation / go back to that chat / "
            "换个对话 / 切回刚才那个'."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "session_id": {"type": "string", "description": "Target session id to switch to."},
                "name": {"type": "string", "description": "Match a target session by name/title when session_id is omitted."},
                "query": {"type": "string", "description": "Alias of name."},
                "ai_config_id": {"type": "integer", "description": "Optional target AI config id. Defaults to current AI."},
                "ai_kind": {"type": "string", "description": "Optional AI kind. Defaults to current run."},
            },
            "required": [],
        },
        handler=_switch_conversation,
        destructive=True,
    ))

    registry.register(MCPTool(
        name="conversation.new",
        description=(
            "Create a new conversation in this AI's shared pool and switch the current "
            "user/identity to it. Takes effect from the user's NEXT message; the current reply "
            "still goes to the current conversation. Use when the user says 'start a new chat / "
            "新开一个对话'."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Name for the new conversation. Defaults to 新对话."},
                "session_name": {"type": "string", "description": "Alias of name."},
                "ai_config_id": {"type": "integer", "description": "Optional target AI config id. Defaults to current AI."},
                "ai_kind": {"type": "string", "description": "Optional AI kind. Defaults to current run."},
            },
            "required": [],
        },
        handler=_new_conversation,
        destructive=True,
    ))

    # ---------- AI 间通信 ----------
    registry.register(MCPTool(
        name="message.send_to_ai",
        description=(
            "Send a message to another AI in the same digital society. The message is delivered "
            "as a forced system prompt. If the target AI is already running, its current run is "
            "interrupted and a new run is started with this message injected first. "
            "`message_type` is required; pick it deliberately.\n"
            "- inquiry  : 询问。你在向对方提问、请求状态或请求结果，通常期望对方答复。\n"
            "- reply    : 回复。你在答复对方先前发来的 inquiry；应带 reply_to_message_id。\n"
            "- notify   : 通知。单向状态、结果或提醒，不期待对方回复。\n"
            "- chitchat : 闲聊，可双向多轮。\n"
            "By default this call returns after queueing; set require_reply=true only when the caller must wait."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "to_ai_config_id": {"type": "integer", "description": "Target AI's ai_config_id."},
                "content": {"type": "string", "description": "Message body."},
                "message_type": {
                    "type": "string",
                    "enum": ["inquiry", "reply", "chitchat", "notify"],
                    "description": (
                        "Required. Semantic type shown in the forced prompt: inquiry=询问/需要答复, "
                        "reply=回复上一条 inquiry, notify=单向通知/不期待回复, chitchat=闲聊."
                    ),
                },
                "require_reply": {
                    "type": "boolean",
                    "description": (
                        "Default false. Controls whether this tool call waits synchronously; it does not "
                        "replace the required message_type. Keep false for normal AI-to-AI collaboration "
                        "so replies arrive as new message.send_to_ai calls."
                    ),
                },
                "timeout_seconds": {
                    "type": "integer",
                    "description": "Optional max seconds to wait when require_reply=true. Omit for the default long wait (86400 / 24h); set a larger value only when the caller intentionally wants to keep waiting longer.",
                },
                "reply_to_message_id": {
                    "type": "string",
                    "description": (
                        "Optional original AI message id (mai_...) when this send is a reply. "
                        "Pass it so the server can keep message-thread context."
                    ),
                },
                "current_session_id": {
                    "type": "string",
                    "description": "Optional current conversation/session id; the runtime supplies it automatically when omitted.",
                },
            },
            "required": ["to_ai_config_id", "content", "message_type"],
        },
        handler=_ai_send_message,
        destructive=True,
    ))

    registry.register(MCPTool(
        name="evolution.input",
        description="Submit an evolution proposal (improvement to prompts/tools/workflows) for core-manager review.",
        input_schema={
            "type": "object",
            "properties": {
                "proposal": {"type": "string"},
                "type": {
                    "type": "string",
                    "enum": ["prompt_rule", "tool_rule", "workflow_rule", "memory", "failure_case", "success_case"],
                },
                "risk": {"type": "string"},
                "target_scope": {"type": "object"},
                "evidence": {"type": "array", "items": {"type": "object"}},
            },
            "required": ["proposal"],
        },
        handler=_evolution_input,
        destructive=True,
    ))
    registry.register(MCPTool(
        name="evolution.list",
        description="List submitted evolution inputs, optionally filtered by review_status.",
        input_schema={
            "type": "object",
            "properties": {
                "review_status": {"type": "string", "enum": ["queued", "accepted", "rejected", "applied"]},
                "limit": {"type": "integer"},
            },
        },
        handler=_evolution_list,
    ))
    registry.register(MCPTool(
        name="evolution.review",
        description="Review an evolution input: accept/reject/apply (core manager). Provide applied_to when applying.",
        input_schema={
            "type": "object",
            "properties": {
                "evolution_input_id": {"type": "string"},
                "decision": {"type": "string", "enum": ["accept", "reject", "apply"]},
                "applied_to": {"type": "string"},
            },
            "required": ["evolution_input_id", "decision"],
        },
        handler=_evolution_review,
        destructive=True,
    ))

    registry.register(MCPTool(
        name="prompt.list_targets",
        description="List current AI prompt targets and global/system prompt keys. Current AI base prompts live in AI config prompt, not user.admin_prompt.",
        input_schema={"type": "object", "properties": {}},
        handler=_prompt_list_targets,
    ))
    registry.register(MCPTool(
        name="prompt.read_ai",
        description="Read the actual base prompt used by one AI config. Defaults to the current AI when target_ai_config_id is omitted.",
        input_schema={
            "type": "object",
            "properties": {
                "target_ai_config_id": {"type": "integer", "description": "Target AI config id. Defaults to current AI config."},
                "ai_config_id": {"type": "integer", "description": "Alias of target_ai_config_id."},
            },
            "required": [],
        },
        handler=_prompt_read_ai,
    ))
    registry.register(MCPTool(
        name="prompt.write_ai",
        description=(
            "Edit one AI config prompt by line. Defaults to the current AI when target_ai_config_id is omitted. "
            "Use mode replace_line/insert_before/insert_after/delete_line/append/prepend with line/text; "
            "only use mode=replace_all for explicit full overwrite."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "target_ai_config_id": {"type": "integer", "description": "Target AI config id. Defaults to current AI config."},
                "ai_config_id": {"type": "integer", "description": "Alias of target_ai_config_id."},
                "mode": {
                    "type": "string",
                    "enum": ["replace_line", "insert_before", "insert_after", "delete_line", "append", "prepend", "replace_all"],
                    "description": "Line edit mode. Full overwrite requires explicit replace_all.",
                },
                "line": {"type": "integer", "description": "1-based target line number."},
                "line_number": {"type": "integer", "description": "Alias of line."},
                "start_line": {"type": "integer", "description": "1-based range start for replace/delete."},
                "end_line": {"type": "integer", "description": "1-based range end for replace/delete."},
                "text": {"type": "string", "description": "Line edit text. May contain multiple lines."},
                "content": {"type": "string", "description": "Alias of text."},
                "prompt": {"type": "string", "description": "Alias of text; used as full prompt only with mode=replace_all."},
                "edits": {
                    "type": "array",
                    "description": "Batch line edits. Each item supports mode,line,start_line,end_line,text/content/prompt.",
                    "items": {"type": "object"},
                },
            },
            "required": [],
        },
        handler=_prompt_write_ai,
        destructive=True,
    ))
    registry.register(MCPTool(
        name="prompt.read_system",
        description="Read global/system prompt templates for current user. These are mostly runtime injection templates or legacy fallbacks; use prompt.read_ai for current AI base prompt.",
        input_schema={
            "type": "object",
            "properties": {
                "key": {
                    "type": "string",
                    "enum": [
                        "admin_prompt",
                        "mcp_call_method",
                        "mcp_namespace_hints",
                        "mcp_format_error_hint",
                        "default_start_task_prompt",
                        "default_resume_task_prompt",
                        "default_supervision_prompt",
                        "default_inheritance_notice",
                    ],
                    "description": "System prompt key. Omit to read all.",
                },
            },
            "required": [],
        },
        handler=_prompt_read_system,
    ))
    registry.register(MCPTool(
        name="prompt.write_system",
        description=(
            "Edit one global/system prompt template by line. These are mostly runtime injection templates or legacy fallbacks, "
            "not the current AI base prompt. Use mode replace_line/insert_before/insert_after/delete_line/append/prepend "
            "with line/text; only use mode=replace_all for explicit full overwrite."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "key": {
                    "type": "string",
                    "enum": [
                        "admin_prompt",
                        "mcp_call_method",
                        "mcp_namespace_hints",
                        "mcp_format_error_hint",
                        "default_start_task_prompt",
                        "default_resume_task_prompt",
                        "default_supervision_prompt",
                        "default_inheritance_notice",
                    ],
                    "description": "System prompt key to update.",
                },
                "mode": {
                    "type": "string",
                    "enum": ["replace_line", "insert_before", "insert_after", "delete_line", "append", "prepend", "replace_all"],
                    "description": "Line edit mode. Full overwrite requires explicit replace_all.",
                },
                "line": {"type": "integer", "description": "1-based target line number."},
                "line_number": {"type": "integer", "description": "Alias of line."},
                "start_line": {"type": "integer", "description": "1-based range start for replace/delete."},
                "end_line": {"type": "integer", "description": "1-based range end for replace/delete."},
                "text": {"type": "string", "description": "Line edit text. May contain multiple lines."},
                "content": {"type": "string", "description": "Alias of text."},
                "prompt": {"type": "string", "description": "Alias of text; used as full prompt only with mode=replace_all."},
                "edits": {
                    "type": "array",
                    "description": "Batch line edits. Each item supports mode,line,start_line,end_line,text/content/prompt.",
                    "items": {"type": "object"},
                },
            },
            "required": ["key"],
        },
        handler=_prompt_write_system,
        destructive=True,
    ))

    # ---------- Librarian / 图书管理员 ----------
    registry.register(MCPTool(
        name="librarian.propose",
        description=(
            "Propose a new procedure (how-to) to the Librarian's knowledge base. "
            "Status starts as 'pending' and requires user approval before becoming searchable. "
            "Use this when the user explicitly says 'remember this'/'next time do X'."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Short procedure title."},
                "scenario": {"type": "string", "description": "When this procedure applies."},
                "steps": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Ordered steps to perform.",
                },
                "gotchas": {"type": "array", "items": {"type": "string"}},
                "triggers": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Keywords used for auto-matching against future tasks.",
                },
                "scope": {"type": "string", "enum": ["global", "ai", "project"]},
                "scope_target": {"type": "string"},
                "evidence": {
                    "type": "object",
                    "description": "Provenance: {job_id, generation, message_id}",
                },
            },
            "required": ["title", "steps"],
        },
        handler=_librarian_propose,
        destructive=True,
    ))
    registry.register(MCPTool(
        name="librarian.consult",
        description=(
            "Ask the Librarian for relevant procedures by free-text query. "
            "Returns at most k results with full steps. Use this when you're unsure how to proceed."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "What you want to know how to do."},
                "k": {"type": "integer", "description": "Max number of results (default 5)."},
                "scope": {"type": "string", "enum": ["global", "ai", "project"]},
            },
            "required": ["query"],
        },
        handler=_librarian_consult,
    ))
    registry.register(MCPTool(
        name="librarian.list_topics",
        description=(
            "List procedure titles + triggers only (progressive disclosure). "
            "Use this to browse what the librarian knows before drilling in with librarian.read."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "scope": {"type": "string", "enum": ["global", "ai", "project"]},
                "status": {
                    "type": "string",
                    "enum": ["pending", "active", "archived", "rejected", "all"],
                    "description": "Default is 'active'.",
                },
            },
        },
        handler=_librarian_list_topics,
    ))
    registry.register(MCPTool(
        name="librarian.read",
        description="Read full markdown body of a procedure by memory_id.",
        input_schema={
            "type": "object",
            "properties": {"memory_id": {"type": "string"}},
            "required": ["memory_id"],
        },
        handler=_librarian_read,
    ))
    registry.register(MCPTool(
        name="librarian.archive",
        description="Archive (soft-delete) a procedure. Restricted to librarian role.",
        input_schema={
            "type": "object",
            "properties": {"memory_id": {"type": "string"}},
            "required": ["memory_id"],
        },
        handler=_librarian_archive,
        destructive=True,
    ))


registry = MCPRegistry()
_register_builtin_tools(registry)

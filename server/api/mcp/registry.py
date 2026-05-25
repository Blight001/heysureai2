from .core import MCPRegistry, MCPTool
from .tools.workspace import (
    _dispatch_flow,
    _get_overview,
    _list_agents,
    _run_command,
)
from .tools.projects import (
    _create_project,
    _delete_project,
    _list_projects,
    _update_project,
)
from .tools.tasks import (
    _task_complete,
    _task_create,
    _task_delete,
    _task_get_current,
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
from .tools.memory import (
    _evolution_input,
    _evolution_list,
    _evolution_review,
    _memory_archive,
    _memory_list,
    _memory_search,
    _memory_update,
    _memory_write,
)
from .tools.communication import (
    _ai_send_message,
    _user_send_message,
)
from .tools.conversation import _forget_before_current
from .tools.librarian import (
    _librarian_archive,
    _librarian_consult,
    _librarian_list_topics,
    _librarian_propose,
    _librarian_read,
)

registry = MCPRegistry()

registry.register(MCPTool(
    name="workspace.run_command",
    description="Run a shell command in the current user's workspace.",
    input_schema={
        "type": "object",
        "properties": {"command": {"type": "string"}},
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
    name="admin.dispatch_flow",
    description="Dispatch a flow payload to a connected agent.",
    input_schema={
        "type": "object",
        "properties": {
            "agentId": {"type": "string"},
            "flowData": {"type": "object"},
        },
        "required": ["agentId", "flowData"],
    },
    handler=_dispatch_flow,
    destructive=True,
))
registry.register(MCPTool(
    name="project.list_projects",
    description="List all evolution projects for current user.",
    input_schema={"type": "object", "properties": {}},
    handler=_list_projects,
))
registry.register(MCPTool(
    name="project.create_project",
    description="Create a project with optional status and AI member IDs.",
    input_schema={
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "description": {"type": "string"},
            "status": {"type": "string", "enum": ["running", "ended"]},
            "ai_member_ids": {"type": "array", "items": {"type": "integer"}},
        },
        "required": ["name"],
    },
    handler=_create_project,
    destructive=True,
))
registry.register(MCPTool(
    name="project.update_project",
    description="Update project fields by id/project_id.",
    input_schema={
        "type": "object",
        "properties": {
            "id": {"type": "string"},
            "project_id": {"type": "string"},
            "name": {"type": "string"},
            "description": {"type": "string"},
            "status": {"type": "string", "enum": ["running", "ended"]},
            "ai_member_ids": {"type": "array", "items": {"type": "integer"}},
        },
        "required": [],
    },
    handler=_update_project,
    destructive=True,
))
registry.register(MCPTool(
    name="project.delete_project",
    description="Delete project by id/project_id and clear linked AI configs.",
    input_schema={
        "type": "object",
        "properties": {
            "id": {"type": "string"},
            "project_id": {"type": "string"},
        },
        "required": [],
    },
    handler=_delete_project,
    destructive=True,
))
registry.register(MCPTool(
    name="task.create",
    description=(
        "Create a task with explicit mode. mode=immediate runs as soon as the scheduler picks it; "
        "mode=scheduled creates a one-time scheduled task using schedule_at or schedule_duration_minutes; "
        "mode=recurring creates a loop task using schedule_duration_minutes and optional schedule_run_immediately. "
        "schedule_at must be Unix seconds or timezone-aware ISO-8601."
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
            "schedule_duration_minutes": {"type": "integer", "description": "scheduled: now + 该分钟数；recurring: 循环间隔（分钟）。默认 30。"},
            "schedule_run_immediately": {"type": "boolean", "description": "mode=recurring 时是否首次立即执行。"},
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
    description="List queued/running/paused tasks. assistant_admin can proxy to digital_member (auto or target_ai_config_id).",
    input_schema={
        "type": "object",
        "properties": {
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
    name="task.get_current",
    description="Get task context. assistant_admin can proxy to digital_member (auto or target_ai_config_id).",
    input_schema={
        "type": "object",
        "properties": {
            "job_id": {"type": "string"},
            "target_ai_config_id": {"type": "integer"},
            "target_config_id": {"type": "integer"},
        },
        "required": [],
    },
    handler=_task_get_current,
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

# 与用户通信：把底层飞书投递封装为业务语义上的"给用户发消息"。
# 未来可扩展 socket 推送 / 邮件等。
registry.register(MCPTool(
    name="user.send_message",
    description=(
        "Send a text message to the human user (currently via the bound Feishu bot). "
        "Use this for proactive notifications, status updates, or asking the user to take action "
        "asynchronously."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "Message text to send to the user."},
            "channel": {
                "type": "string",
                "enum": ["feishu"],
                "description": "Delivery channel. Defaults to 'feishu'.",
            },
            "receive_id": {"type": "string", "description": "Optional receiver id; defaults to AI config default."},
            "receive_id_type": {
                "type": "string",
                "enum": ["chat_id", "open_id", "user_id", "union_id", "email"],
                "description": "Receiver id type; defaults to AI config default.",
            },
            "chat_id": {"type": "string", "description": "Alias of receive_id."},
            "open_id": {"type": "string", "description": "Alias of receive_id."},
        },
        "required": ["text"],
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

# ---------- AI 间通信 ----------
registry.register(MCPTool(
    name="ai.send_message",
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
                    "so replies arrive as new ai.send_message calls."
                ),
            },
            "timeout_seconds": {
                "type": "integer",
                "description": "Max seconds to wait for a reply when require_reply=true (default 120).",
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
    name="memory.write",
    description="Persist a high-value structured memory (fact/decision/lesson/todo/risk/template) for later retrieval.",
    input_schema={
        "type": "object",
        "properties": {
            "content": {"type": "string", "description": "Memory content."},
            "kind": {"type": "string", "enum": ["fact", "decision", "lesson", "todo", "risk", "template"]},
            "tags": {"type": "array", "items": {"type": "string"}},
            "project_id": {"type": "string"},
            "job_id": {"type": "string"},
            "generation": {"type": "integer"},
            "confidence": {"type": "number", "description": "0.0-1.0 confidence."},
            "source": {"type": "object", "description": "Provenance, e.g. {chat_message_id, file_path}."},
        },
        "required": ["content"],
    },
    handler=_memory_write,
    destructive=True,
))
registry.register(MCPTool(
    name="memory.search",
    description="Search stored memories by free-text query, kind, project, or tags.",
    input_schema={
        "type": "object",
        "properties": {
            "query": {"type": "string"},
            "kind": {"type": "string"},
            "project_id": {"type": "string"},
            "tags": {"type": "array", "items": {"type": "string"}},
            "limit": {"type": "integer"},
            "include_archived": {"type": "boolean"},
        },
    },
    handler=_memory_search,
))
registry.register(MCPTool(
    name="memory.list",
    description="List stored memories (optionally filtered by kind/project).",
    input_schema={
        "type": "object",
        "properties": {
            "kind": {"type": "string"},
            "project_id": {"type": "string"},
            "limit": {"type": "integer"},
            "include_archived": {"type": "boolean"},
        },
    },
    handler=_memory_list,
))
registry.register(MCPTool(
    name="memory.update",
    description="Update an existing memory's content/tags/kind/confidence.",
    input_schema={
        "type": "object",
        "properties": {
            "memory_id": {"type": "string"},
            "content": {"type": "string"},
            "tags": {"type": "array", "items": {"type": "string"}},
            "kind": {"type": "string"},
            "confidence": {"type": "number"},
        },
        "required": ["memory_id"],
    },
    handler=_memory_update,
    destructive=True,
))
registry.register(MCPTool(
    name="memory.archive",
    description="Archive (soft-delete) a memory so it no longer surfaces in default searches.",
    input_schema={
        "type": "object",
        "properties": {"memory_id": {"type": "string"}},
        "required": ["memory_id"],
    },
    handler=_memory_archive,
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


from .mcp_core import MCPRegistry, MCPTool
from .mcp_workspace_tools import (
    _dispatch_flow,
    _get_git_diff,
    _get_overview,
    _get_tree,
    _list_agents,
    _list_files,
    _read_file_by_name,
    _read_files,
    _run_command,
    _write_file,
    _edit_file,
    _delete_path,
)
from .mcp_project_tools import (
    _create_project,
    _delete_project,
    _list_projects,
    _update_project,
)
from .mcp_task_tools import (
    _task_complete,
    _task_create,
    _task_create_immediate,
    _task_create_recurring,
    _task_create_scheduled,
    _task_get_current,
    _task_inherit,
    _task_list,
    _task_wait_all,
)
from .mcp_feishu_tools import _feishu_send_message
from .mcp_prompt_tools import (
    _prompt_list_targets,
    _prompt_read_ai,
    _prompt_read_system,
    _prompt_write_ai,
    _prompt_write_system,
)
from .agent_dispatch import _dispatch_task
from .mcp_memory_tools import (
    _evolution_input,
    _evolution_list,
    _evolution_review,
    _memory_archive,
    _memory_list,
    _memory_search,
    _memory_update,
    _memory_write,
)
from .mcp_human_tools import _human_ask

registry = MCPRegistry()

registry.register(MCPTool(
    name="workspace.list_files",
    description="List files and directories in the current user's workspace.",
    input_schema={"type": "object", "properties": {}},
    handler=_list_files,
))
registry.register(MCPTool(
    name="workspace.get_file_tree",
    description="Get workspace tree. Optional: path for a specific folder, or name to locate folders by name.",
    input_schema={
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "name": {"type": "string"},
            "case_sensitive": {"type": "boolean"},
            "max_matches": {"type": "integer"},
        },
    },
    handler=_get_tree,
))
registry.register(MCPTool(
    name="workspace.read_files",
    description="Read one or more concrete files from workspace with safety limits on file count and bytes.",
    input_schema={
        "type": "object",
        "properties": {
            "paths": {"type": "array", "items": {"type": "string"}},
            "max_files": {"type": "integer"},
            "max_total_bytes": {"type": "integer"},
            "max_single_file_bytes": {"type": "integer"},
        },
        "required": ["paths"],
    },
    handler=_read_files,
))
registry.register(MCPTool(
    name="workspace.read_file_by_name",
    description="Find file(s) by name and read matched content with the same safety limits as workspace.read_files.",
    input_schema={
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "names": {"type": "array", "items": {"type": "string"}},
            "case_sensitive": {"type": "boolean"},
            "allow_partial": {"type": "boolean"},
            "max_matches": {"type": "integer"},
            "read_all_matches": {"type": "boolean"},
            "max_files": {"type": "integer"},
            "max_total_bytes": {"type": "integer"},
            "max_single_file_bytes": {"type": "integer"},
        },
        "required": [],
    },
    handler=_read_file_by_name,
))
registry.register(MCPTool(
    name="workspace.write_file",
    description="Create or overwrite a file in the current user's workspace. Supports structured mode (target/content/options) and legacy flat fields.",
    input_schema={
        "type": "object",
        "properties": {
            "target": {
                "type": "object",
                "description": "Structured target container.",
                "properties": {
                    "path": {"type": "string", "description": "Relative file path in workspace."},
                },
            },
            "content": {
                "type": ["string", "object"],
                "description": "File content. Structured mode supports {\"text\":\"...\"}.",
                "properties": {
                    "text": {"type": "string"},
                    "value": {"type": "string"},
                    "raw": {"type": "string"},
                },
            },
            "options": {
                "type": "object",
                "description": "Structured write options.",
                "properties": {
                    "create": {"type": "boolean", "description": "Allow create when file is missing. Default true."},
                    "overwrite": {"type": "boolean", "description": "Allow overwrite when file exists. Default true."},
                    "create_dirs": {"type": "boolean", "description": "Auto create parent directories. Default true."},
                    "if_exists": {"type": "string", "enum": ["overwrite", "error", "skip"], "description": "Existing-file strategy."},
                },
            },
            "path": {"type": "string", "description": "Legacy path field."},
            "create": {"type": "boolean", "description": "Legacy create flag (same as options.create)."},
            "overwrite": {"type": "boolean", "description": "Legacy overwrite flag (same as options.overwrite)."},
            "if_exists": {"type": "string", "enum": ["overwrite", "error", "skip"], "description": "Legacy existing-file strategy."},
        },
        "required": [],
    },
    handler=_write_file,
    destructive=True,
))
registry.register(MCPTool(
    name="workspace.edit_file",
    description="Edit a file with structured edit operations (replace/set/append/prepend), or create it if allowed. Legacy search/replace is still supported.",
    input_schema={
        "type": "object",
        "properties": {
            "target": {
                "type": "object",
                "description": "Structured target container.",
                "properties": {
                    "path": {"type": "string", "description": "Relative file path in workspace."},
                },
            },
            "edits": {
                "type": "array",
                "description": "Structured edit sequence, applied in order.",
                "items": {
                    "type": "object",
                    "properties": {
                        "op": {"type": "string", "enum": ["replace", "set", "append", "prepend"]},
                        "search": {"type": "string", "description": "Required for replace."},
                        "match": {"type": "string", "description": "Alias of search."},
                        "find": {"type": "string", "description": "Alias of search."},
                        "replace": {"type": "string", "description": "Replacement text for replace."},
                        "with": {"type": "string", "description": "Alias of replace."},
                        "content": {"type": "string", "description": "Content for set/append/prepend."},
                        "text": {"type": "string", "description": "Alias of content."},
                        "value": {"type": "string", "description": "Alias of content/replace."},
                        "replace_all": {"type": "boolean", "description": "Replace all matches (replace op)."},
                        "allow_missing": {"type": "boolean", "description": "Skip edit if search text is missing."},
                    },
                },
            },
            "options": {
                "type": "object",
                "description": "Structured edit options.",
                "properties": {
                    "create_if_missing": {"type": "boolean", "description": "Create file when missing. Default false."},
                    "create_content": {"type": "string", "description": "Seed content used when creating a missing file in structured mode."},
                },
            },
            "path": {"type": "string", "description": "Legacy path field."},
            "search": {"type": "string", "description": "Legacy search snippet."},
            "replace": {"type": "string", "description": "Legacy replacement snippet (or full content when search is empty)."},
            "create_if_missing": {"type": "boolean", "description": "Legacy create_if_missing flag."},
            "replace_all": {"type": "boolean", "description": "Legacy replace_all flag."},
        },
        "required": [],
    },
    handler=_edit_file,
    destructive=True,
))
registry.register(MCPTool(
    name="workspace.delete_path",
    description="Delete a file from the current user's workspace.",
    input_schema={
        "type": "object",
        "properties": {"path": {"type": "string"}},
        "required": ["path"],
    },
    handler=_delete_path,
    destructive=True,
))
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
    name="workspace.git_diff",
    description="Get the current git diff and changed files for the user's workspace.",
    input_schema={"type": "object", "properties": {}},
    handler=_get_git_diff,
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
    name="admin.dispatch_task",
    description=(
        "Dispatch a task to a connected desktop agent for local execution "
        "(filesystem, shell, git, keyboard, mouse, screen, clipboard, window, process). "
        "Provide agentId plus either a natural-language "
        "instruction or a specific tool + args. The result arrives asynchronously "
        "and is appended to this session."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "agentId": {"type": "string", "description": "Target connected agent id (from admin.list_agents)."},
            "instruction": {"type": "string", "description": "Natural-language task description."},
            "tool": {
                "type": "string",
                "description": (
                    "Optional specific local tool: fs.list / fs.read / fs.write / shell.run / git.diff / "
                    "keyboard.type / keyboard.press / mouse.click / mouse.move / screen.capture / "
                    "clipboard.get / clipboard.set / window.list / window.focus / process.list / process.kill."
                ),
            },
            "args": {"type": "object", "description": "Arguments for the chosen tool."},
            "allowedTools": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["agentId"],
    },
    handler=_dispatch_task,
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
    name="task.create_immediate",
    description="Create an immediate queued task (manual trigger). Best for tasks that should start as soon as scheduler picks it.",
    input_schema={
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "任务标题。"},
            "instruction": {"type": "string", "description": "任务执行说明/要求。"},
            "priority": {"type": "integer", "description": "优先级 1-10，默认 5。"},
            "template_id": {"type": "string", "description": "可选模板 ID。"},
            "target_ai_config_id": {"type": "integer", "description": "assistant_admin 代理投递目标 AI 配置 ID。"},
        },
        "required": ["title", "instruction"],
    },
    handler=_task_create_immediate,
    destructive=True,
))
registry.register(MCPTool(
    name="task.create_scheduled",
    description="Create a one-time scheduled task (non-loop). schedule_at OR schedule_duration_minutes (exactly one).",
    input_schema={
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "任务标题。"},
            "instruction": {"type": "string", "description": "任务执行说明/要求。"},
            "priority": {"type": "integer", "description": "优先级 1-10，默认 5。"},
            "schedule_at": {"type": ["number", "string"], "description": "一次性执行时间。支持 Unix 秒，或带时区的 ISO-8601（必须包含 +08:00 或 Z）。"},
            "schedule_duration_minutes": {"type": "integer", "description": "当未提供 schedule_at 时，使用 now + 该分钟数。默认 30。"},
            "template_id": {"type": "string", "description": "可选模板 ID。"},
            "target_ai_config_id": {"type": "integer", "description": "assistant_admin 代理投递目标 AI 配置 ID。"},
        },
        "required": ["title", "instruction"],
    },
    handler=_task_create_scheduled,
    destructive=True,
))
registry.register(MCPTool(
    name="task.create_recurring",
    description="Create a recurring scheduled task (loop). Use schedule_duration_minutes only; schedule_at is not allowed. Optional schedule_run_immediately for first run.",
    input_schema={
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "任务标题。"},
            "instruction": {"type": "string", "description": "任务执行说明/要求。"},
            "priority": {"type": "integer", "description": "优先级 1-10，默认 5。"},
            "schedule_duration_minutes": {"type": "integer", "description": "循环间隔（分钟）。默认 30。"},
            "schedule_run_immediately": {"type": "boolean", "description": "是否首次立即执行（仅首次有效）。"},
            "template_id": {"type": "string", "description": "可选模板 ID。"},
            "target_ai_config_id": {"type": "integer", "description": "assistant_admin 代理投递目标 AI 配置 ID。"},
        },
        "required": ["title", "instruction"],
    },
    handler=_task_create_recurring,
    destructive=True,
))
registry.register(MCPTool(
    name="task.create",
    description="Create a queued task (legacy mixed mode). Prefer task.create_immediate / task.create_scheduled / task.create_recurring for clearer intent. If schedule_at is used, it must be unix seconds or timezone-aware ISO-8601.",
    input_schema={
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "name": {"type": "string"},
            "task_name": {"type": "string"},
            "instruction": {"type": "string"},
            "content": {"type": "string"},
            "priority": {"type": "integer"},
            "level": {"type": "string"},
            "schedule_enabled": {"type": "boolean"},
            "schedule_at": {"type": ["number", "string"]},
            "run_at": {"type": ["number", "string"]},
            "schedule_time": {"type": ["number", "string"]},
            "schedule_duration_minutes": {"type": "integer"},
            "duration_minutes": {"type": "integer"},
            "interval_minutes": {"type": "integer"},
            "schedule_loop_enabled": {"type": "boolean"},
            "loop": {"type": "boolean"},
            "repeat": {"type": "boolean"},
            "schedule_run_immediately": {"type": "boolean"},
            "run_now": {"type": "boolean"},
            "schedule": {
                "type": "object",
                "properties": {
                    "enabled": {"type": "boolean"},
                    "schedule_at": {"type": ["number", "string"]},
                    "run_at": {"type": ["number", "string"]},
                    "schedule_time": {"type": ["number", "string"]},
                    "duration_minutes": {"type": "integer"},
                    "interval_minutes": {"type": "integer"},
                    "loop_enabled": {"type": "boolean"},
                    "loop": {"type": "boolean"},
                    "repeat": {"type": "boolean"},
                    "run_immediately": {"type": "boolean"},
                    "run_now": {"type": "boolean"},
                },
            },
            "template_id": {"type": "string"},
            "target_ai_config_id": {"type": "integer"},
            "target_config_id": {"type": "integer"},
        },
        "required": [],
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
    name="task.wait_all",
    description=(
        "Orchestrator primitive: block until all listed subtasks finish (or "
        "timeout), then return each task's final status and result summary. Use "
        "after fanning out subtasks to multiple digital_members (a manager can "
        "create subtasks for other members via target_ai_config_id), which run "
        "in parallel."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "job_ids": {"type": "array", "items": {"type": "string"}, "description": "Subtask job_ids to wait for."},
            "timeout_seconds": {"type": "integer", "description": "Max wait, 5-1800 (default 300)."},
            "poll_interval_seconds": {"type": "integer", "description": "Poll interval, 1-30 (default 3)."},
        },
        "required": ["job_ids"],
    },
    handler=_task_wait_all,
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

registry.register(MCPTool(
    name="feishu.send_message",
    description="Send a text message through the Feishu bot bound to this AI. Use chat_id/open_id or the configured default receiver.",
    input_schema={
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "Message text to send."},
            "receive_id": {"type": "string", "description": "Optional Feishu receiver id. Defaults to AI config default receiver."},
            "receive_id_type": {
                "type": "string",
                "enum": ["chat_id", "open_id", "user_id", "union_id", "email"],
                "description": "Receiver id type. Defaults to AI config default type.",
            },
            "chat_id": {"type": "string", "description": "Alias of receive_id for group/private chat id."},
            "open_id": {"type": "string", "description": "Alias of receive_id for a user open_id."},
        },
        "required": ["text"],
    },
    handler=_feishu_send_message,
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
    name="human.ask",
    description=(
        "Pause the current task and ask the human a question. "
        "Use kind='confirm' for yes/no, kind='select' for multiple-choice (provide options), "
        "kind='text' for free-form text input. Blocks until the human answers or timeout elapses."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "prompt": {"type": "string", "description": "The question or prompt to show the human."},
            "kind": {
                "type": "string",
                "enum": ["confirm", "select", "text"],
                "description": "Interaction type. Default: text.",
            },
            "options": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Choices for kind=select or custom labels for kind=confirm.",
            },
            "timeout_seconds": {"type": "integer", "description": "Max wait time in seconds (5-3600). Default 300."},
            "session_id": {"type": "string", "description": "Optional session id for context."},
            "job_id": {"type": "string", "description": "Optional job id for context."},
        },
        "required": ["prompt"],
    },
    handler=_human_ask,
    destructive=False,
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
                    "worker_prompt",
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
                    "worker_prompt",
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


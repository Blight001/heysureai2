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
)

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


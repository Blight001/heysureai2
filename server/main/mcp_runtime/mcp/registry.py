from .core import MCPRegistry, MCPTool
from .tools.introspection import (
    _mcp_describe_tool,
)
from .tools.workspace import (
    _get_overview,
    _edit_file,
    _list_agents,
    _read_file,
    _run_command,
    _write_file,
)
from .tools.tasks import (
    _task_complete,
    _task_create,
    _task_delete,
    _task_list,
    _task_update,
)
from .tools.task_plan import (
    _phase_complete,
    _plan_create,
    _plan_get,
    _task_finish,
)
from .tools.prompts import (
    SYSTEM_PROMPT_FIELDS,
    _prompt_list_targets,
    _prompt_read_ai,
    _prompt_read_system,
    _prompt_write_ai,
    _prompt_write_system,
)
from .tools.communication import (
    _ai_send_message,
    _user_send_message,
)
from .tools.conversation import (
    _compress_conversation,
    _conversation_detail,
    _create_conversation,
    _delete_conversation,
    _edit_conversation,
    _list_conversations,
    _new_conversation,
    _switch_conversation,
)
from .tools.web_search import _web_search
from .tools.device_mcp import _device_mcp_manage, DEVICE_MCP_MANAGE_SCHEMA

def _register_builtin_tools(registry: MCPRegistry) -> None:
    """Populate ``registry`` with all builtin tools.

    Extracted so ``mcp_runtime.mcp.loader`` can rebuild a fresh registry on hot
    reload without needing to ``importlib.reload`` this module (which would
    invalidate references held by callers).
    """
    registry.register(MCPTool(
        name="mcp.describe_tool",
        description=(
            "读取已允许 MCP 工具的完整说明和参数 schema，读取后即可直接调用这些工具。"
            "用 tool 查单个工具；用 tools（数组）一次查多个；用 query 按名称/描述做关键词搜索。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "tool": {"type": "string", "description": "要查看的单个 MCP 工具完整名称。"},
                "tools": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "一次查看多个工具的完整名称列表。",
                },
                "query": {"type": "string", "description": "关键词，在工具名称和描述中搜索匹配的工具。"},
            },
        },
        handler=_mcp_describe_tool,
    ))

    registry.register(MCPTool(
        name="workspace.search",
        description="联网搜索（基于 Tavily）。当需要对话和工作区里没有的实时或外部信息时使用。",
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "搜索关键词。"},
                "search_depth": {
                    "type": "string",
                    "enum": ["basic", "advanced"],
                    "description": "搜索深度：basic=快速，advanced=更深入。默认 advanced。",
                },
                "max_results": {"type": "integer", "description": "返回结果数量，1-20，默认 5。"},
                "include_answer": {"type": "boolean", "description": "是否让 Tavily 附带一段生成的概要答案。"},
                "include_raw_content": {"type": "boolean", "description": "是否在可用时附带网页原始正文。"},
                "include_images": {"type": "boolean", "description": "是否在可用时附带图片结果。"},
            },
            "required": ["query"],
        },
        handler=_web_search,
    ))

    registry.register(MCPTool(
        name="workspace.run_command",
        description=(
            "执行 shell 命令，用于开发或检查工作区。默认在当前用户的工作区目录、使用正常进程环境运行，"
            "允许绝对路径和环境变量。支持显式 shell=cmd/powershell/pwsh，或用 argv + shell=none 绕过 shell 转义。"
            "需要隔离、只在工作区内运行时，设置 strict_workspace 或 sandbox_env。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "要执行的命令字符串。默认 shell=auto；Windows 上复杂 PowerShell 请显式 shell=powershell。"},
                "argv": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "参数化执行，不经过 shell，例如 [\"python\",\"-c\",\"print(1)\"]。传 argv 时可省略 command，shell 固定为 none。",
                },
                "shell": {
                    "type": "string",
                    "enum": ["auto", "cmd", "powershell", "pwsh", "none"],
                    "description": "命令解释器。auto=系统默认 shell；cmd/powershell/pwsh=显式选择；none=仅配合 argv，避免 shell 转义问题。",
                },
                "cwd": {
                    "type": "string",
                    "description": "可选，工作目录。相对路径相对工作区解析；也允许绝对路径。",
                },
                "timeout": {
                    "type": "integer",
                    "description": "可选，超时时间（秒），上限 600，默认 120。",
                },
                "strict_workspace": {
                    "type": "boolean",
                    "description": "为 true 时，拒绝工作区之外的绝对 cwd。默认 false。",
                },
                "sandbox_env": {
                    "type": "boolean",
                    "description": "为 true 时，使用工作区内隔离的 HOME/TEMP 目录。默认 false。",
                },
                "dry_run": {
                    "type": "boolean",
                    "description": "为 true 时只返回解析后的 cwd/shell/命令，不真正执行。适合删除、覆盖、长命令执行前预检。",
                },
            },
            "required": [],
        },
        handler=_run_command,
        destructive=True,
    ))
    registry.register(MCPTool(
        name="workspace.read_file",
        description="读取当前 AI 工作区内的文本文件。用于查看 task.md、代码、文档等内容；路径必须位于工作区内。",
        input_schema={
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "要读取的文件路径。相对路径相对当前 AI 工作区；绝对路径必须位于工作区内。"},
                "target": {
                    "type": "object",
                    "description": "兼容对象写法：{\"path\":\"...\"}。",
                },
                "max_bytes": {"type": "integer", "description": "最多读取字节数，默认 1000000。"},
            },
            "required": ["path"],
        },
        handler=_read_file,
    ))
    registry.register(MCPTool(
        name="workspace.write_file",
        description="安全写入当前 AI 工作区内的文本文件。支持创建或覆盖；路径必须位于工作区内。",
        input_schema={
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "要写入的文件路径。相对路径相对当前 AI 工作区；绝对路径必须位于工作区内。"},
                "target": {"type": "object", "description": "兼容对象写法：{\"path\":\"...\"}。"},
                "text": {"type": "string", "description": "要写入的完整文本。"},
                "content": {"type": "object", "description": "兼容对象写法：{\"text\":\"...\"}。"},
                "create": {"type": "boolean", "description": "文件不存在时是否创建。"},
                "overwrite": {"type": "boolean", "description": "文件已存在时是否允许覆盖。"},
                "create_dirs": {"type": "boolean", "description": "是否自动创建父目录。"},
                "options": {"type": "object", "description": "兼容对象写法，可包含 create/overwrite/create_dirs。"},
            },
            "required": ["path", "text"],
        },
        handler=_write_file,
        destructive=True,
    ))
    registry.register(MCPTool(
        name="workspace.edit_file",
        description=(
            "安全编辑当前 AI 工作区内的文本文件。支持按文本块 replace/delete，以及 append/prepend；"
            "默认要求 search 只匹配一次，避免误改多处。适合删除 task.md 中某条失败记录。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "要编辑的文件路径。相对路径相对当前 AI 工作区；绝对路径必须位于工作区内。"},
                "target": {"type": "object", "description": "兼容对象写法：{\"path\":\"...\"}。"},
                "edits": {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": "编辑列表。每项支持 op=replace/delete/append/prepend；replace/delete 需 search；replace 可传 replace/text；多处匹配需 replace_all=true。",
                },
                "op": {"type": "string", "enum": ["replace", "delete", "append", "prepend"], "description": "单条编辑写法的操作类型。"},
                "search": {"type": "string", "description": "replace/delete 要查找的原文块。默认必须唯一匹配。"},
                "replace": {"type": "string", "description": "replace 的替换文本。"},
                "text": {"type": "string", "description": "append/prepend 文本，或 replace 的替换文本。"},
                "replace_all": {"type": "boolean", "description": "是否替换/删除所有匹配。默认 false；多处匹配时不传会报错。"},
                "create_if_missing": {"type": "boolean", "description": "文件不存在时是否先按空文件创建。"},
                "options": {"type": "object", "description": "兼容对象写法，可包含 create_if_missing。"},
            },
            "required": ["path"],
        },
        handler=_edit_file,
        destructive=True,
    ))
    registry.register(MCPTool(
        name="admin.list_agents",
        description="列出当前用户已连接的端侧 Agent，以及受管的 AI 配置。",
        input_schema={"type": "object", "properties": {}},
        handler=_list_agents,
    ))
    registry.register(MCPTool(
        name="admin.get_overview",
        description="获取系统总览：工作区状态，以及已连接的端侧 Agent 和受管的 AI 配置。",
        input_schema={"type": "object", "properties": {}},
        handler=_get_overview,
    ))
    registry.register(MCPTool(
        name="task.create",
        description=(
            "创建任务。不提供任何调度字段时 mode 默认为 immediate；为兼容旧用法，给了调度字段会自动推断为 scheduled/recurring。\n"
            "- immediate：被调度器选中后立即执行。\n"
            "- scheduled：一次性定时任务，用 schedule_at 或 schedule_duration_minutes 指定时间。\n"
            "- recurring：循环任务，循环方式由 schedule_loop_mode 决定——"
            "interval（每轮完成后隔 schedule_duration_minutes 分钟）、daily（每天 schedule_daily_time）、"
            "weekly（每周 schedule_weekly_days 的 schedule_daily_time）。\n"
            "循环可用 schedule_max_runs 和/或 schedule_end_at 限定结束。"
            "schedule_at/schedule_end_at 需为 Unix 秒或带时区的 ISO-8601。"
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
            "required": ["title", "instruction"],
        },
        handler=_task_create,
        destructive=True,
    ))
    registry.register(MCPTool(
        name="task.list",
        description=(
            "列出任务。默认返回进行中的任务（排队/运行中/暂停）。"
            "current_only=true 只返回当前任务（优先运行中，其次排队，再次暂停）；"
            "include_history=true 额外包含已完成/已取消/已停止/出错的历史任务；"
            "history_only=true 只返回已结束的历史任务。"
            "assistant_admin 可代理到数字成员（自动或用 target_ai_config_id 指定）。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "current_only": {"type": "boolean", "description": "只返回当前任务（作为 task 和 tasks[0]）。"},
                "include_history": {"type": "boolean", "description": "在进行中任务之外，附带已结束的历史任务。"},
                "history_only": {"type": "boolean", "description": "只返回已结束的历史任务。"},
                "status": {
                    "description": "可选，按状态过滤，可填单个或逗号分隔的多个状态。",
                    "oneOf": [
                        {"type": "string"},
                        {"type": "array", "items": {"type": "string"}},
                    ],
                },
                "limit": {"type": "integer", "description": "使用历史/状态过滤时的最大返回条数，1-500，默认 100。"},
                "job_id": {"type": "string", "description": "可选，只查询指定任务的 job id。"},
                "target_ai_config_id": {"type": "integer", "description": "assistant_admin/主管代理时的目标数字成员 AI 配置 id。"},
            },
        },
        handler=_task_list,
    ))
    registry.register(MCPTool(
        name="task.update",
        description=(
            "管理员/主管接管工具：更新已有任务的标题、说明、优先级、状态或调度信息。"
            "status 仅支持 queued/paused；运行中的任务正文不会被改写。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "job_id": {"type": "string", "description": "要更新的任务 job id。"},
                "title": {"type": "string", "description": "新的任务标题。"},
                "instruction": {"type": "string", "description": "新的任务说明。"},
                "priority": {"type": "integer", "description": "优先级 1-10。"},
                "status": {"type": "string", "enum": ["queued", "paused"], "description": "可选，接管后的状态。"},
                "mode": {"type": "string", "enum": ["immediate", "scheduled", "recurring"], "description": "可选，更新调度类型。"},
                "schedule_at": {"type": ["number", "string"], "description": "用于 mode=scheduled。Unix 秒或带时区的 ISO-8601。"},
                "schedule_duration_minutes": {"type": "integer", "description": "用于 scheduled/recurring。"},
                "schedule_run_immediately": {"type": "boolean", "description": "用于 mode=recurring 是否首轮立即执行。"},
                "target_ai_config_id": {"type": "integer", "description": "assistant_admin/主管代理的目标 AI 配置 id。"},
            },
            "required": ["job_id"],
        },
        handler=_task_update,
        destructive=True,
    ))
    registry.register(MCPTool(
        name="task.delete",
        description=(
            "管理员/主管接管工具：彻底删除一个任务。运行中的任务会被停止，"
            "相关的任务会话消息/会话也会一并删除。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "job_id": {"type": "string", "description": "要彻底删除的任务 job id。"},
                "target_ai_config_id": {"type": "integer", "description": "assistant_admin/主管代理的目标 AI 配置 id。"},
            },
            "required": ["job_id"],
        },
        handler=_task_delete,
        destructive=True,
    ))
    registry.register(MCPTool(
        name="task.complete",
        description=(
            "把当前任务标记为已完成，必须附带一段完成总结。"
            "成功后，当前日期和总结会追加写入该 AI 工作区的 task.md。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "job_id": {"type": "string", "description": "可选，要完成的任务 job id；省略则取当前任务。"},
                "summary": {
                    "type": "string",
                    "minLength": 1,
                    "description": "非空的完成总结。",
                },
            },
            "required": ["summary"],
        },
        handler=_task_complete,
        destructive=True,
    ))

    # ---------- 计划 / 分阶段执行（长任务） ----------
    registry.register(MCPTool(
        name="plan.create",
        description=(
            "为复杂任务制定一份完整计划，行动前先调用。把整体目标拆成有序的多个阶段，"
            "每个阶段有明确的目标(goal)与结束标志(done_signal)，并可在 actions 里列出该阶段的子行动"
            "（每个子行动也有自己的 goal 与 done_signal）。"
            "登记后从第 1 个阶段开始执行：每完成一个阶段调用 phase.complete，全部完成后调用 task.finish。"
            "同一会话只保留一份进行中的计划，重复调用会覆盖旧计划。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "goal": {"type": "string", "description": "整个任务的总体目标，一句话讲清要交付什么。"},
                "phases": {
                    "type": "array",
                    "description": "有序的阶段列表（建议 2-20 个）。阶段太少说明任务不需要计划，太多说明拆得过细。",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string", "description": "阶段名称。"},
                            "goal": {"type": "string", "description": "该阶段要达成的明确目标。"},
                            "done_signal": {"type": "string", "description": "判断该阶段已完成的明确结束标志。"},
                            "actions": {
                                "type": "array",
                                "description": "该阶段的子行动列表，每个子行动有自己的 goal 与 done_signal。",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "goal": {"type": "string", "description": "子行动的目标。"},
                                        "done_signal": {"type": "string", "description": "子行动的结束标志。"},
                                    },
                                    "required": ["goal"],
                                },
                            },
                        },
                        "required": ["goal", "done_signal"],
                    },
                },
            },
            "required": ["goal", "phases"],
        },
        handler=_plan_create,
        destructive=True,
    ))
    registry.register(MCPTool(
        name="plan.get",
        description="查看当前进行中的计划与进度：各阶段的目标、结束标志、状态，以及当前所处阶段。",
        input_schema={"type": "object", "properties": {}},
        handler=_plan_get,
    ))
    registry.register(MCPTool(
        name="phase.complete",
        description=(
            "完成当前阶段并收尾：必须附一段总结说明该阶段做了什么、关键产出与结论。"
            "调用后系统会自动隐藏上一阶段的深度思考与 MCP 详细结果、只保留调用状态，"
            "为后续阶段腾出上下文。若该阶段未达成目标，可传 status=failed 如实记录后继续。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string", "minLength": 1, "description": "该阶段的非空总结。"},
                "status": {
                    "type": "string",
                    "enum": ["completed", "failed"],
                    "description": "阶段结果，默认 completed；未达成目标用 failed。",
                },
            },
            "required": ["summary"],
        },
        handler=_phase_complete,
        destructive=True,
    ))
    registry.register(MCPTool(
        name="task.finish",
        description=(
            "收尾整个计划任务（无论成功或失败都要调用）。系统会隐藏全过程的深度思考与 MCP 详细结果，"
            "把完整行动流程写入工作区的成功/失败日志（logs/success 或 logs/failure），"
            "便于后续沉淀为可复用、稳定的知识。outcome=success 写成功日志，failure 写失败日志。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "outcome": {
                    "type": "string",
                    "enum": ["success", "failure"],
                    "description": "整个任务的最终结果：success=成功，failure=失败。",
                },
                "summary": {
                    "type": "string",
                    "minLength": 1,
                    "description": "整个任务的完整复盘总结：目标、过程、产出/失败原因、可复用经验。",
                },
            },
            "required": ["outcome", "summary"],
        },
        handler=_task_finish,
        destructive=True,
    ))

    # 与用户通信：把底层机器人投递封装为业务语义上的"给用户发消息"。
    registry.register(MCPTool(
        name="message.send_to_user",
        description=(
            "通过绑定的机器人渠道（飞书或 QQ）给真人用户发文本消息。"
            "用于主动通知、状态更新，或异步请用户去做某事。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "发给用户的文本；只发媒体时可省略。"},
                "channel": {
                    "type": "string",
                    "enum": ["feishu", "qq"],
                    "description": "发送渠道；默认用该 AI 配置的机器人渠道。",
                },
                "receive_id": {"type": "string", "description": "可选，接收者 id；默认用 AI 配置里的默认接收者。"},
                "receive_id_type": {
                    "type": "string",
                    "enum": ["chat_id", "open_id", "user_id", "union_id", "email", "c2c", "group", "channel", "dm"],
                    "description": "接收者 id 类型；QQ 用 c2c/group/channel/dm。",
                },
                "media_url": {"type": "string", "description": "图片或视频的 HTTP(S) 链接，服务端拉取后发送。"},
                "media_path": {"type": "string", "description": "服务端本地的图片或视频路径。"},
                "media_type": {"type": "string", "enum": ["image", "video"], "description": "可选，显式指定媒体类型；省略时按 url/path 推断。"},
                "file_name": {"type": "string", "description": "可选，上传媒体时使用的文件名。"},
                "duration": {"type": "integer", "description": "可选，飞书视频上传时的时长（毫秒）。"},
            },
            "required": [],
        },
        handler=_user_send_message,
        destructive=True,
    ))

    registry.register(MCPTool(
        name="conversation.create",
        description="在当前 AI 作用域内新建一个空的聊天会话。",
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "会话名称；默认「未命名会话」。"},
                "session_id": {"type": "string", "description": "可选，显式指定会话 id；一般省略。"},
                "ai_config_id": {"type": "integer", "description": "可选，目标 AI 配置 id；省略则使用当前 AI。"},
                "ai_kind": {"type": "string", "description": "可选，AI 类型；省略则使用当前运行或 assistant。"},
            },
            "required": [],
        },
        handler=_create_conversation,
        destructive=True,
    ))

    registry.register(MCPTool(
        name="conversation.delete",
        description="删除当前 AI 作用域内的一个聊天会话及其全部消息。",
        input_schema={
            "type": "object",
            "properties": {
                "session_id": {"type": "string", "description": "要删除的会话 id；有则默认当前运行所在会话。"},
                "ai_config_id": {"type": "integer", "description": "可选，目标 AI 配置 id；省略则使用当前 AI。"},
                "ai_kind": {"type": "string", "description": "可选，AI 类型；省略则使用当前运行或 assistant。"},
            },
            "required": [],
        },
        handler=_delete_conversation,
        destructive=True,
    ))

    registry.register(MCPTool(
        name="conversation.list",
        description=(
            "列出该 AI 共享对话池（统一的「机器人对话区」）里的所有会话，覆盖 Web 控制台和各机器人渠道。"
            "返回每个会话的 id、名称、来源渠道、最后更新时间，以及它是否是你当前激活的会话。"
            "当用户想查看/列出对话、或想挑一个切换时使用。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "最多返回多少个会话，1-200，默认 50。"},
                "ai_config_id": {"type": "integer", "description": "可选，目标 AI 配置 id；省略则使用当前 AI。"},
                "ai_kind": {"type": "string", "description": "可选，AI 类型；省略则跟随当前运行。"},
            },
            "required": [],
        },
        handler=_list_conversations,
    ))

    registry.register(MCPTool(
        name="conversation.detail",
        description=(
            "读取当前 AI 作用域内某个会话及其消息内容。"
            "默认读当前激活的会话，支持 offset/limit 分页。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "session_id": {"type": "string", "description": "可选，会话 id；默认当前运行所在会话。"},
                "offset": {"type": "integer", "description": "消息偏移量（从 0 开始），默认 0。"},
                "limit": {"type": "integer", "description": "返回的消息条数，1-500，默认 100。"},
                "ai_config_id": {"type": "integer", "description": "可选，目标 AI 配置 id；省略则使用当前 AI。"},
                "ai_kind": {"type": "string", "description": "可选，AI 类型；省略则跟随当前运行。"},
            },
            "required": [],
        },
        handler=_conversation_detail,
    ))

    registry.register(MCPTool(
        name="conversation.edit",
        description=(
            "在不删除会话的前提下编辑对话：action=rename 改名，action=clear 清空消息。"
            "不传参数（arguments={}）时，默认清空当前运行所在会话，并保留当前这条用户请求。"
            "清理当前上下文时不要传 session_id、ai_config_id 或 ai_kind，运行上下文会自动补齐。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["rename", "clear"],
                    "description": "可选；默认 clear。rename 用于改名，clear 用于清空消息。",
                },
                "session_id": {"type": "string", "description": "可选，会话 id；默认当前运行所在会话。"},
                "name": {"type": "string", "description": "action=rename 时必填，新的会话名。"},
                "keep_current_message": {
                    "type": "boolean",
                    "description": "action=clear 且编辑当前激活会话时，是否保留当前这条用户消息。默认 true。",
                },
                "ai_config_id": {"type": "integer", "description": "可选，目标 AI 配置 id；省略则使用当前 AI。"},
                "ai_kind": {"type": "string", "description": "可选，AI 类型；省略则跟随当前运行。"},
            },
            "required": [],
        },
        handler=_edit_conversation,
        destructive=True,
    ))

    registry.register(MCPTool(
        name="conversation.compress",
        description=(
            "压缩当前对话的上下文：把较早的对话历史总结成一条摘要，只保留最近的几条原文，"
            "用来在对话变长、接近 token 上限时主动腾出空间继续工作。"
            "在标准 AI 运行内调用会立即对本轮对话生效；摘要也会写入历史。"
            "当你发现上下文过长、或被提示接近上限时，可主动调用本工具。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "keep_recent": {
                    "type": "integer",
                    "description": "保留最近多少条原始对话不被压缩（其余折叠为摘要）。默认 4，范围 0-20。",
                },
                "session_id": {"type": "string", "description": "可选，目标会话 id。默认当前运行所在会话。"},
                "ai_config_id": {"type": "integer", "description": "可选，目标 AI 配置 id。默认当前 AI。"},
                "ai_kind": {"type": "string", "description": "可选，AI 类型。默认当前运行。"},
            },
            "required": [],
        },
        handler=_compress_conversation,
    ))

    registry.register(MCPTool(
        name="conversation.switch",
        description=(
            "把当前用户/身份的激活会话切换到该 AI 共享池里的另一个会话。"
            "可传 session_id，或用 name/query 按标题匹配。"
            "从用户的下一条消息起生效；本轮回复仍发到当前会话。"
            "当用户说「换个对话 / 切回刚才那个」时使用。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "session_id": {"type": "string", "description": "要切换到的目标会话 id。"},
                "name": {"type": "string", "description": "省略 session_id 时，按名称/标题匹配目标会话。"},
                "ai_config_id": {"type": "integer", "description": "可选，目标 AI 配置 id；省略则使用当前 AI。"},
                "ai_kind": {"type": "string", "description": "可选，AI 类型；省略则跟随当前运行。"},
            },
            "required": [],
        },
        handler=_switch_conversation,
        destructive=True,
    ))

    registry.register(MCPTool(
        name="conversation.new",
        description=(
            "在该 AI 共享池里新建一个对话，并把当前用户/身份切换过去。"
            "从用户的下一条消息起生效；本轮回复仍发到当前会话。"
            "当用户说「新开一个对话」时使用。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "新对话的名称；默认「新对话」。"},
                "ai_config_id": {"type": "integer", "description": "可选，目标 AI 配置 id；省略则使用当前 AI。"},
                "ai_kind": {"type": "string", "description": "可选，AI 类型；省略则跟随当前运行。"},
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
            "给同一数字社会中的另一个 AI 发消息。消息会作为强制系统提示送达；"
            "若目标 AI 正在运行，会中断它当前的运行，并以这条消息打头开启新一轮。"
            "必须指定 message_type，请按语义谨慎选择：\n"
            "- inquiry  ：询问。你在向对方提问、要状态或要结果，通常期望对方答复。\n"
            "- reply    ：回复。你在答复对方先前发来的 inquiry；应带 reply_to_message_id。\n"
            "- notify   ：通知。单向状态、结果或提醒，不期待对方回复。\n"
            "- chitchat ：闲聊，可双向多轮。\n"
            "默认排队后即返回；只有调用方确实需要同步等待答复时才设 require_reply=true。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "to_ai_config_id": {"type": "integer", "description": "目标 AI 的 ai_config_id。"},
                "content": {"type": "string", "description": "消息正文。"},
                "message_type": {
                    "type": "string",
                    "enum": ["inquiry", "reply", "chitchat", "notify"],
                    "description": (
                        "必填，决定送达提示里的语义：inquiry=询问/需要答复，"
                        "reply=回复上一条 inquiry，notify=单向通知/不期待回复，chitchat=闲聊。"
                    ),
                },
                "require_reply": {
                    "type": "boolean",
                    "description": (
                        "默认 false，仅控制本次调用是否同步等待，不能替代必填的 message_type。"
                        "常规 AI 协作请保持 false，对方的答复会作为新的 message.send_to_ai 调用回来。"
                    ),
                },
                "timeout_seconds": {
                    "type": "integer",
                    "description": "可选，require_reply=true 时的最长等待秒数。省略则用默认长等待（86400 秒/24 小时）；确实想等更久才调大。",
                },
                "reply_to_message_id": {
                    "type": "string",
                    "description": "可选，当本次是回复时，传入对方原消息 id（mai_...），便于服务端维持消息线程上下文。",
                },
                "current_session_id": {
                    "type": "string",
                    "description": "可选，当前对话/会话 id；省略时运行时会自动补上。",
                },
            },
            "required": ["to_ai_config_id", "content", "message_type"],
        },
        handler=_ai_send_message,
        destructive=True,
    ))

    registry.register(MCPTool(
        name="prompt.list_targets",
        description="列出可改写的 AI 人格 prompt 目标，以及全局/系统 prompt 的键。prompt 正文都存放在 KnowledgeBase 的 md 文件里。",
        input_schema={"type": "object", "properties": {}},
        handler=_prompt_list_targets,
    ))
    registry.register(MCPTool(
        name="prompt.read_ai",
        description="读取某个 AI 配置实际使用的基础人格 prompt。省略 target_ai_config_id 时读当前 AI。",
        input_schema={
            "type": "object",
            "properties": {
                "target_ai_config_id": {"type": "integer", "description": "目标 AI 配置 id；省略则使用当前 AI 配置。"},
            },
            "required": [],
        },
        handler=_prompt_read_ai,
    ))
    registry.register(MCPTool(
        name="prompt.write_ai",
        description=(
            "按行编辑某个 AI 配置的人格 prompt。省略 target_ai_config_id 时编辑当前 AI。"
            "用 mode=replace_line/insert_before/insert_after/delete_line/append/prepend 配合 line/text 做局部编辑；"
            "只有要整篇覆盖时才用 mode=replace_all。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "target_ai_config_id": {"type": "integer", "description": "目标 AI 配置 id；省略则使用当前 AI 配置。"},
                "mode": {
                    "type": "string",
                    "enum": ["replace_line", "insert_before", "insert_after", "delete_line", "append", "prepend", "replace_all"],
                    "description": "按行编辑方式；整篇覆盖必须显式用 replace_all。",
                },
                "line": {"type": "integer", "description": "目标行号（从 1 开始）。"},
                "start_line": {"type": "integer", "description": "替换/删除的起始行号（从 1 开始）。"},
                "end_line": {"type": "integer", "description": "替换/删除的结束行号（从 1 开始）。"},
                "text": {"type": "string", "description": "要写入的文本，可包含多行；mode=replace_all 时作为整篇内容。"},
                "edits": {
                    "type": "array",
                    "description": "批量按行编辑；每项支持 mode、line、start_line、end_line、text。",
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
        description="读取当前用户的全局/系统 prompt 模板。它们多为运行时注入模板或旧版兜底字段；当前 AI 的基础人格 prompt 请用 prompt.read_ai 读。",
        input_schema={
            "type": "object",
            "properties": {
                "key": {
                    "type": "string",
                    "enum": list(SYSTEM_PROMPT_FIELDS),
                    "description": "系统 prompt 的键；省略则返回全部。",
                },
            },
            "required": [],
        },
        handler=_prompt_read_system,
    ))
    registry.register(MCPTool(
        name="prompt.write_system",
        description=(
            "按行编辑某个全局/系统 prompt 模板。它们多为运行时注入模板或旧版兜底字段，不是当前 AI 的基础人格 prompt。"
            "用 mode=replace_line/insert_before/insert_after/delete_line/append/prepend 配合 line/text 做局部编辑；"
            "只有要整篇覆盖时才用 mode=replace_all。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "key": {
                    "type": "string",
                    "enum": list(SYSTEM_PROMPT_FIELDS),
                    "description": "要更新的系统 prompt 键。",
                },
                "mode": {
                    "type": "string",
                    "enum": ["replace_line", "insert_before", "insert_after", "delete_line", "append", "prepend", "replace_all"],
                    "description": "按行编辑方式；整篇覆盖必须显式用 replace_all。",
                },
                "line": {"type": "integer", "description": "目标行号（从 1 开始）。"},
                "start_line": {"type": "integer", "description": "替换/删除的起始行号（从 1 开始）。"},
                "end_line": {"type": "integer", "description": "替换/删除的结束行号（从 1 开始）。"},
                "text": {"type": "string", "description": "要写入的文本，可包含多行；mode=replace_all 时作为整篇内容。"},
                "edits": {
                    "type": "array",
                    "description": "批量按行编辑；每项支持 mode、line、start_line、end_line、text。",
                    "items": {"type": "object"},
                },
            },
            "required": ["key"],
        },
        handler=_prompt_write_system,
        destructive=True,
    ))

    registry.register(MCPTool(
        name="device_mcp.manage",
        description=(
            "自主管理设备端 MCP 工具（按设备类型 desktop/browser），可用于迭代更好用的工具实现。"
            "list/get 查看；capabilities 列出该类型设备可调用的原生能力；upsert 创建或覆盖；delete 删除。"
            "desktop 工具是在设备上运行的 JS（作用域有 args/cap/ctx，cap 是原生能力库，如 cap.call('fs.read', args)）；"
            "browser 工具用 call/set/return 指令。保存后立即下发到在线设备，下一轮即可调用。"
        ),
        input_schema=DEVICE_MCP_MANAGE_SCHEMA,
        handler=_device_mcp_manage,
        destructive=True,
    ))

registry = MCPRegistry()
_register_builtin_tools(registry)

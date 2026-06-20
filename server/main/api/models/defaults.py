"""Default prompt strings and UI defaults referenced by models and runtime.

These are kept in a dedicated module so migration code and runtime code can
import them without dragging in the full SQLModel table definitions.
"""

DEFAULT_START_TASK_PROMPT = "你将收到一个任务，请先理解目标、约束与优先级，然后开始执行。"
DEFAULT_RESUME_TASK_PROMPT = "请继续执行刚才被暂停的任务，先简要回顾当前进度，再继续推进直到可交付。"
DEFAULT_SUPERVISION_PROMPT = "系统监督提醒：请确认当前任务是否已完成。若已完成请调用 task.complete 标记；若未完成请给出剩余步骤并继续执行。"
DEFAULT_COMPRESSION_PROMPT = """你正在把一段较长的对话历史压缩成摘要，以便在不超出上下文上限的情况下继续同一段对话。请阅读下面的对话历史，输出一段简洁但信息完整的中文摘要，必须保留：用户的核心目标与约束、已完成的工作与关键产出、尚未完成的事项与已知风险、重要的事实/数据/结论，以及接下来应继续推进的下一步。请省略寒暄与重复内容，只输出摘要正文，不要添加额外说明或前后缀。

[待压缩的对话历史]
{history}"""
DEFAULT_TASK_PLAN_FLOW_PROMPT = """本任务采用「先规划，再分阶段执行，最后总结收尾」的强制流程，由系统调度推进：
1) 行动前必须先调用 plan.create 制定完整计划：把总体目标拆成有序的多个阶段，每个阶段写清目标(goal)与结束标志(done_signal)，并在 actions 里列出该阶段的子行动。计划登记前系统只接受 plan.create。
2) 计划登记后，系统会主动下发「当前阶段」让你执行，你无需自己查询计划进度。达成该阶段的结束标志后调用 plan.phase_complete 收尾本阶段（无需总结）；系统会自动隐藏上一阶段的深度思考与 MCP 详细结果、只保留调用状态，并自动下发下一个阶段，直到所有阶段完成。
3) 所有阶段完成后，系统会要求你调用 plan.finish 给出完整复盘总结（outcome=success/failure）；系统会把整个流程写入工作区的成功/失败日志，沉淀为可复用知识。不要用普通回复结束任务。"""

DEFAULT_UI_THEME_MODE = "dark"
DEFAULT_UI_FONT_SIZE = "md"
DEFAULT_UI_BRAIN_VIEW_MODE = "sections"

DEFAULT_MODEL_PRESETS = """[{"id":"deepseek-chat","name":"DeepSeek Chat","api_key":"sk-cb40bc0b0b894934919907913e337927","base_url":"https://api.deepseek.com/chat/completions","model":"deepseek-chat"}]"""

DEFAULT_MCP_NAMESPACE_HINTS = """{"mcp":"MCP 自省入口。可调用工具已在系统提示的[可用MCP工具]目录中列出；用 mcp.describe_tool（支持 tools 批量或 query 搜索）取参数 schema 后即可调用。","task":"任务系统（定时/无人值守、在独立会话中运行的后台工作）。task.manage(action=list/create/update/delete) 管理任务；完成当前任务用 task.complete。","plan":"计划/分阶段执行（普通对话与任务对话均可用）。对长动作先用 plan.create 制定分阶段计划，plan.get 查看进度，plan.phase_complete 收尾当前阶段，plan.finish 收尾整个计划（phase 是 plan 的子操作）。","file":"工作区文件。file.manage(action=read/tree/write/edit) 读取、列出、写入或编辑工作区内文件。","workspace":"工作区命令与联网搜索。需要运行程序或诊断命令用 workspace.run_command，联网查信息用 workspace.search。","admin":"系统总览。用于查看在线智能体、运行状态和系统概况。","prompt":"Prompt 管理。prompt.manage(action=list_targets/read_ai/write_ai/read_system/write_system) 读取或按权限修改 prompt。","conversation":"会话管理。conversation.manage(action=list/detail/create/delete/rename/clear/compress/switch/new) 操作会话。","knowledge":"知识库。knowledge.manage(action=...) 操作知识工坊的传承思想与内置知识类目（需绑定工坊）。","ai":"AI 间通信。用于向其他 AI 发送询问、回复、通知或协作消息。","user":"用户通知。用于向用户发送异步消息。","web":"联网搜索。用于查询外部或实时信息。","memory":"长期记忆。用于写入、检索、更新和归档结构化记忆。","project":"项目管理。用于查看或维护项目记录。"}"""

DEFAULT_MCP_DYNAMIC_RULE = """系统提示的[可用MCP工具]目录会一次性列出全部可调用工具的名称与简介，模型据此直接定位。需要参数时用 mcp.describe_tool（支持 tool 单个、tools 批量或 query 关键词搜索）取 schema；被加载的目标工具会在随后轮次直接可调用。

浏览器标签页 MCP 规则：调用 browser_tab / 浏览器导航类工具前，必须优先确认是否已经存在目标网页或可复用的已打开标签页；若存在，只切换到该标签页，不要重复跳转。若需要打开新网页，优先打开新标签页，避免随意覆盖用户当前已经打开的网页或当前工作上下文。"""

DEFAULT_MCP_CALL_METHOD = """When you want to call a tool, output one or more blocks using EXACTLY this format and do not wrap them in markdown code fences:
<mcp-call>
{"tool":"workspace.run_command","arguments":{"command":"dir"}}
</mcp-call>

可用的 MCP namespace：
{MCP}

Rules:
- Explain your intent in normal text first when helpful, then emit the MCP call block.
- Do not assume tool arguments. The [可用MCP工具] catalog already lists every callable tool; use mcp.describe_tool (tool / tools / query) to load the schema for the ones you need, then call them.
- Use workspace.read_file / workspace.write_file / workspace.edit_file for file reads, writes, block replacement, deletion, append, and prepend. Use workspace.run_command only for command execution or diagnostics.
- Use admin.* tools when managing connected agents.
- Only fall back to legacy File/Create File/Delete File/Run Command formats if MCP is unavailable."""

DEFAULT_AI_MESSAGE_REPLY_SUCCESS = """[系统提示] 你对消息 {message_id} 的回复已送达。
现在请继续你刚才被打断的任务。"""

DEFAULT_AI_MESSAGE_INQUIRY_REMINDER = """[系统提示 · AI 间询问待回复]
你仍有一条来自 {from_ai_name} 的询问尚未回复，系统正在等待这个闭环。

- 原消息编号: {message_id}
- 当前会话: {current_session_id}
- 已等待秒数: {elapsed_seconds}
- 询问内容:
{content}

请立即先答复这条询问。回复方式：调用 MCP 工具 `message.send_to_ai`，参数必须包含：
{{"to_ai_config_id": {from_ai_config_id}, "content": "<你的答复>", "message_type": "reply", "require_reply": false, "reply_to_message_id": "{message_id}", "current_session_id": "{current_session_id}"}}"""

DEFAULT_AI_MESSAGE_NOTIFY_TEMPLATE = """[系统通知 · AI 间通信 · 单向]
你收到一条单向通知消息。系统已为你自动签收，**无需调用任何工具回应**，请继续你原本的工作。

- 收件方（你）: {target_ai_name}（ai_config_id={target_ai_config_id}）
- 发送方: {from_ai_name}（ai_config_id={from_ai_config_id}）
- 消息编号: {message_id}
- 通知内容:
{content}

仅当你判断该信息需要沟通时，才考虑主动发起一条新的 inquiry 或 chitchat；否则保持沉默。"""


# AI ↔ AI 询问 / 回复 / 闲聊：按 message_type 分流的入站模板。
# 这三个模板取代旧版"什么消息都要求回信"的兜底逻辑。
DEFAULT_AI_MESSAGE_INQUIRY_TEMPLATE = """[AI 间通信 · 询问]
{from_ai_name} 向你提出了一个询问，需要你给出明确答复**一次**。

- 收件方（你）: {target_ai_name}（ai_config_id={target_ai_config_id}）
- 发送方: {from_ai_name}（ai_config_id={from_ai_config_id}）
- 消息编号: {message_id}
- 询问内容:
{content}

回复方式：调用 MCP 工具 `message.send_to_ai`，参数如下：
  {{"to_ai_config_id": {from_ai_config_id}, "content": "<你的答复>", "message_type": "reply", "require_reply": false, "reply_to_message_id": "{message_id}", "current_session_id": "{current_session_id}"}}

回复后如仍需沟通，可以继续使用 `message.send_to_ai`。"""

DEFAULT_AI_MESSAGE_REPLY_TEMPLATE = """[AI 间通信 · 收到答复]
这是对你之前发出的 AI 间消息的答复。

- 收件方（你）: {target_ai_name}（ai_config_id={target_ai_config_id}）
- 答复方: {from_ai_name}（ai_config_id={from_ai_config_id}）
- 本次答复消息编号: {message_id}
- 答复上下文与内容:
{content}"""

DEFAULT_AI_MESSAGE_CHITCHAT_TEMPLATE = """[AI 间通信 · 闲聊]
{from_ai_name} 给你发了一条闲聊消息。

- 收件方（你）: {target_ai_name}（ai_config_id={target_ai_config_id}）
- 发送方: {from_ai_name}（ai_config_id={from_ai_config_id}）
- 消息编号: {message_id}
- 内容:
{content}"""

# 兼容旧配置字段；当前工具层不再用它限制 AI 间消息轮次。
CHITCHAT_MAX_DEPTH = 5

DEFAULT_USER_MESSAGE_NOTICE = """[系统提示] 你已向用户发出一条消息（{channel}）。
用户的回复（如有）会通过正常对话渠道返回，请不要重复发送。"""

DEFAULT_MCP_FORMAT_ERROR_HINT = """[系统提示] 检测到你正在尝试调用 MCP，但调用格式未通过校验，因此本次没有执行任何工具。

请改用以下标准格式（任选其一）：
1) JSON 方式（推荐）
<mcp-call>
{"tool":"workspace.run_command","arguments":{"command":"dir"}}
</mcp-call>

2) XML-like 方式
<mcp-call>
<tool>workspace.run_command</tool>
<arguments>{"command":"dir"}</arguments>
</mcp-call>

注意：
- <arguments> 标签内必须是 JSON 对象字符串。
- 不要写成 <arguments><paths>...</paths></arguments> 这种嵌套标签格式。
- 一次只调用一个工具，等待 MCP 返回后再继续。
{details}"""

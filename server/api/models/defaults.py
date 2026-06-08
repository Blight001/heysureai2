"""Default prompt strings and UI defaults referenced by models and runtime.

These are kept in a dedicated module so migration code and runtime code can
import them without dragging in the full SQLModel table definitions.
"""

DEFAULT_START_TASK_PROMPT = "你将收到一个任务，请先理解目标、约束与优先级，然后开始执行。"
DEFAULT_RESUME_TASK_PROMPT = "请继续执行刚才被暂停的任务，先简要回顾当前进度，再继续推进直到可交付。"
DEFAULT_SUPERVISION_PROMPT = "系统监督提醒：请确认当前任务是否已完成。若已完成请调用 task.complete 标记；若未完成请给出剩余步骤并继续执行。"
DEFAULT_INHERITANCE_NOTICE = "当前思考量已达到阈值（{session_tokens}/{threshold}），建议立即开启传承流程，沉淀本轮结论与关键上下文。"
DEFAULT_UI_THEME_MODE = "dark"
DEFAULT_UI_FONT_SIZE = "md"
DEFAULT_UI_BRAIN_VIEW_MODE = "sections"
DEFAULT_UI_THINKING_ICON = "🤔"
DEFAULT_UI_MCP_ICON = "🧰"
DEFAULT_UI_MCP_SUCCESS_ICON = "🧰"
DEFAULT_UI_MCP_ERROR_ICON = "❌"

DEFAULT_MODEL_PRESETS = """[{"id":"deepseek-chat","name":"DeepSeek Chat","api_key":"sk-cb40bc0b0b894934919907913e337927","base_url":"https://api.deepseek.com/chat/completions","model":"deepseek-chat"}]"""

DEFAULT_MCP_NAMESPACE_HINTS = """{"mcp":"MCP 自省入口。可调用工具已在系统提示的[可用MCP工具]目录中列出；用 mcp.describe_tool（支持 tools 批量或 query 搜索）取参数 schema 后即可调用。","task":"任务系统。用于查看、创建、更新、删除、传承和完成任务。","workspace":"工作区与命令执行。用于检查文件、运行只读诊断命令或执行用户明确要求的工作区操作。","admin":"系统总览。用于查看在线智能体、运行状态和系统概况。","prompt":"Prompt 管理。用于读取或按权限修改 AI / 系统 prompt。","conversation":"会话管理。用于查找、新建、删除会话或按请求清理上下文。","ai":"AI 间通信。用于向其他 AI 发送询问、回复、通知或协作消息。","user":"用户通知。用于向用户发送异步消息。","web":"联网搜索。用于查询外部或实时信息。","memory":"长期记忆。用于写入、检索、更新和归档结构化记忆。","librarian":"知识流程库。用于咨询、提交、读取和归档可复用流程。","evolution":"系统进化建议。用于提交、列出和评审改进建议。","project":"项目管理。用于查看或维护项目记录。"}"""

DEFAULT_MCP_DYNAMIC_RULE = "系统提示的[可用MCP工具]目录会一次性列出全部可调用工具的名称与简介，模型据此直接定位。需要参数时用 mcp.describe_tool（支持 tool 单个、tools 批量或 query 关键词搜索）取 schema；被加载的目标工具会在随后轮次直接可调用。"

DEFAULT_MCP_CALL_METHOD = """When you want to call a tool, output one or more blocks using EXACTLY this format and do not wrap them in markdown code fences:
<mcp-call>
{"tool":"workspace.run_command","arguments":{"command":"dir"}}
</mcp-call>

可用的 MCP namespace：
{MCP}

Rules:
- Explain your intent in normal text first when helpful, then emit the MCP call block.
- Do not assume tool arguments. The [可用MCP工具] catalog already lists every callable tool; use mcp.describe_tool (tool / tools / query) to load the schema for the ones you need, then call them.
- Use workspace.run_command for workspace inspection, file reads, file writes, edits, deletion, and command execution.
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

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

DEFAULT_MCP_CALL_METHOD = """When you want to call a tool, output one or more blocks using EXACTLY this format and do not wrap them in markdown code fences:
<mcp-call>
{"tool":"workspace.run_command","arguments":{"command":"dir"}}
</mcp-call>

Available MCP tools include:
{MCP}

Rules:
- Explain your intent in normal text first when helpful, then emit the MCP call block.
- Use workspace.run_command for workspace inspection, file reads, file writes, edits, deletion, and command execution.
- Use admin.* tools when managing connected agents.
- Call exactly one tool per <mcp-call> block; never join two tool names into one name.
- Only fall back to legacy File/Create File/Delete File/Run Command formats if MCP is unavailable."""

DEFAULT_AI_MESSAGE_INBOUND_TEMPLATE = """[系统中断 · AI 间通信]
你刚才的工作被一条来自其它 AI 的消息打断了。请优先处理此消息。

- 发送方: {from_ai_name}（ai_config_id={from_ai_config_id}）
- 消息编号: {message_id}
- 消息内容:
{content}

阅读后，请立即调用 MCP 工具 `ai.reply_message` 回复：
  arguments: {{"message_id": "{message_id}", "content": "<你的回复>"}}
回复成功后，系统会让你继续刚才的工作。在你回复之前，不要执行任何其它 MCP 工具。"""

DEFAULT_AI_MESSAGE_REPLY_SUCCESS = """[系统提示] 你对消息 {message_id} 的回复已送达。
现在请继续你刚才被打断的任务。"""

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

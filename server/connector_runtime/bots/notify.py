"""Bot-agnostic outbound delivery for newly persisted assistant messages.

``notify_saved_assistant_message`` is the single entry point called from
``services.chat_persistence`` after a saved assistant message has been
committed. We:

1. Strip MCP-call blocks so private tool traffic never leaks to chat UI.
2. Identify which bot owns the message by checking the registered routes.
3. Glue any per-bot thinking/tool icons onto the rendered content.
4. Hand the message to the matching adapter for delivery.

Adding a new bot does not require touching this file — the registry
iteration picks up any new ``BotAdapter`` automatically.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Optional

from sqlmodel import select

from api.chat_runtime.mcp_parser import MCP_CALL_BLOCK_RE
from .registry import iter_bots

if TYPE_CHECKING:
    from sqlmodel import Session

    from api.models import ChatMessage


def _visible_content(message: "ChatMessage") -> str:
    """Return the assistant content with MCP-call blocks stripped."""
    content = str(message.content or "")
    if not content:
        return ""
    content = MCP_CALL_BLOCK_RE.sub("", content)
    content = re.sub(r"<mcp[-_]call\b[\s\S]*$", "", content, flags=re.IGNORECASE)
    content = re.sub(r"\n{3,}", "\n\n", content)
    return content.strip()


def _is_visible_assistant_message(message: "ChatMessage") -> bool:
    if message.role != "assistant":
        return False
    return bool(_visible_content(message))


def _user_ui_icons(session: "Session", user_id: int) -> dict[str, str]:
    """Resolve the per-user thinking/MCP icons used as assistant prefixes."""
    from api.models import User

    user = session.get(User, int(user_id))

    def enabled(name: str) -> bool:
        value = getattr(user, name, True)
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        text = str(value).strip().lower()
        if text in {"0", "false", "off", "no"}:
            return False
        if text in {"1", "true", "on", "yes"}:
            return True
        return bool(value)

    return {
        "thinking": str(getattr(user, "ui_thinking_icon", "") or "🤔") if enabled("ui_thinking_icon_enabled") else "",
        "mcp_success": str(getattr(user, "ui_mcp_success_icon", "") or getattr(user, "ui_mcp_icon", "") or "🧰") if enabled("ui_mcp_success_icon_enabled") else "",
        "mcp_error": str(getattr(user, "ui_mcp_error_icon", "") or "❌") if enabled("ui_mcp_error_icon_enabled") else "",
    }


def _plain_text_output_enabled(session: "Session", user_id: int) -> bool:
    from api.models import User

    user = session.get(User, int(user_id))
    value = getattr(user, "ui_plain_text_output_enabled", False)
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"0", "false", "off", "no"}:
        return False
    if text in {"1", "true", "on", "yes"}:
        return True
    return bool(value)


def _mcp_tool_icon_for_message(row: "ChatMessage", icons: dict[str, str]) -> str:
    text = str(row.content or "")
    status_match = re.search(r"^状态[：:]\s*(.+)$", text, flags=re.MULTILINE)
    status = str(status_match.group(1) if status_match else "").strip()
    if status == "失败":
        return icons["mcp_error"]
    return icons["mcp_success"]


def _assistant_prefix(session: "Session", message: "ChatMessage") -> str:
    """Compose the per-message UI prefix (thinking + MCP-tool icons).

    Returns the concatenation of every icon that should appear before the
    visible assistant text. Behavior matches the legacy implementation —
    only the bot-channel dispatch has been factored out.
    """
    from api.models import ChatMessage

    icons = _user_ui_icons(session, int(message.user_id))
    message_id = int(message.id or 0)
    if not message_id:
        return icons["thinking"] if str(message.think or "").strip() else ""

    previous_assistants = session.exec(
        select(ChatMessage).where(
            ChatMessage.user_id == int(message.user_id),
            ChatMessage.ai_config_id == message.ai_config_id,
            ChatMessage.ai_kind == str(message.ai_kind or "core"),
            ChatMessage.session_id == str(message.session_id or ""),
            ChatMessage.role == "assistant",
            ChatMessage.id < message_id,
        ).order_by(ChatMessage.id.desc())
    ).all()
    previous_visible_assistant = next(
        (row for row in previous_assistants if _is_visible_assistant_message(row)),
        None,
    )

    lower_bound = int(previous_visible_assistant.id or 0) if previous_visible_assistant else 0
    rows = session.exec(
        select(ChatMessage).where(
            ChatMessage.user_id == int(message.user_id),
            ChatMessage.ai_config_id == message.ai_config_id,
            ChatMessage.ai_kind == str(message.ai_kind or "core"),
            ChatMessage.session_id == str(message.session_id or ""),
            ChatMessage.id > lower_bound,
            ChatMessage.id <= message_id,
        ).order_by(ChatMessage.id.asc())
    ).all()

    parts = []
    for row in rows:
        if row.tags == "mcp_tool_call":
            parts.append(_mcp_tool_icon_for_message(row, icons))
        if row.role == "assistant" and str(row.think or "").strip():
            parts.append(icons["thinking"])
    return "".join(parts)


def _format_content(session: "Session", message: "ChatMessage", content: str, bot) -> str:
    raw = str(content or "")
    if not raw:
        return ""
    if not _plain_text_output_enabled(session, int(message.user_id)):
        return raw.strip()
    return bot.normalize_text(raw, strip_markdown=True)


def notify_saved_assistant_message(session: "Session", message: "ChatMessage") -> None:
    """Deliver a saved assistant message to whichever bot owns its session.

    No-op when the message is empty, not from the assistant, or its
    ``session_id`` has no registered bot route.
    """
    if not _is_visible_assistant_message(message):
        return
    content = _visible_content(message)

    bot = None
    route = None
    for candidate in iter_bots():
        route = candidate.load_session_route(session, message)
        if route:
            bot = candidate
            break
    if bot is None or route is None:
        return

    prefix = _assistant_prefix(session, message)
    content = f"{prefix}{content}" if prefix else content
    content = content.lstrip("\n")
    content = _format_content(session, message, content, bot)

    bot.notify_assistant_message(
        session,
        message,
        rendered_content=content,
        route=route,
    )

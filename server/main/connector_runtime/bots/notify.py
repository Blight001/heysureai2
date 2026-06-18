"""Bot-agnostic outbound delivery for newly persisted assistant messages.

``notify_saved_assistant_message`` is the single entry point called from
``services.chat_persistence`` after a saved assistant message has been
committed. We:

1. Strip MCP-call blocks so private tool traffic never leaks to chat UI.
2. Identify which bot owns the message by checking the registered routes.
3. Hand the message to the matching adapter for delivery.

Adding a new bot does not require touching this file — the registry
iteration picks up any new ``BotAdapter`` automatically.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

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


def _is_ai_error_notice(message: "ChatMessage") -> bool:
    return message.role == "system" and "system_notice_ai_error" in str(message.tags or "")


def _bot_ai_error_notice(message: "ChatMessage") -> str:
    text = str(message.content or "")
    match = re.search(r"\bHTTP\s+(\d{3})\b", text, flags=re.IGNORECASE)
    if not match:
        match = re.search(r"\bstatus\s*[:=]?\s*(\d{3})\b", text, flags=re.IGNORECASE)
    status = match.group(1) if match else "unknown"
    return "\n".join([
        "[AI 对话出错]",
        f"status {status}",
    ])


def _is_visible_assistant_message(message: "ChatMessage") -> bool:
    if message.role != "assistant":
        return False
    return bool(_visible_content(message))


def _is_bot_deliverable_message(message: "ChatMessage") -> bool:
    return _is_visible_assistant_message(message) or _is_ai_error_notice(message)


def _format_content(content: str) -> str:
    raw = str(content or "")
    if not raw:
        return ""
    return raw.strip()


def notify_saved_assistant_message(session: "Session", message: "ChatMessage") -> None:
    """Deliver a saved assistant message to whichever bot owns its session.

    No-op when the message is empty, not from the assistant, or its
    ``session_id`` has no registered bot route.
    """
    if not _is_bot_deliverable_message(message):
        return
    content = _bot_ai_error_notice(message) if _is_ai_error_notice(message) else _visible_content(message)

    bot = None
    route = None
    for candidate in iter_bots():
        route = candidate.load_session_route(session, message)
        if route:
            bot = candidate
            break
    if bot is None or route is None:
        return

    content = content.lstrip("\n")
    content = _format_content(content)

    bot.notify_assistant_message(
        session,
        message,
        rendered_content=content,
        route=route,
    )

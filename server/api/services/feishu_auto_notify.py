import re
import time
from typing import Optional

from sqlmodel import Session, select

from ..integrations.feishu.service import send_feishu_text_message
from ..models import ChatMessage, FeishuSessionRoute


FEISHU_TEXT_MAX_CHARS = 1800
MCP_CALL_RE = re.compile(
    r"<mcp[-_]call>\s*[\s\S]*?\s*</\s*(?:mcp[-_]call|[｜|]*\s*DSML\s*[｜|]*\s*invoke)\s*>",
    re.IGNORECASE,
)


def register_feishu_session_route(
    session: Session,
    *,
    user_id: int,
    ai_config_id: int,
    ai_kind: str,
    session_id: str,
    receive_id: str,
    receive_id_type: str,
) -> None:
    session_id = str(session_id or "").strip()
    receive_id = str(receive_id or "").strip()
    receive_id_type = str(receive_id_type or "chat_id").strip() or "chat_id"
    if not session_id or not receive_id:
        return
    row = session.exec(
        select(FeishuSessionRoute).where(
            FeishuSessionRoute.user_id == int(user_id),
            FeishuSessionRoute.ai_config_id == int(ai_config_id),
            FeishuSessionRoute.ai_kind == str(ai_kind or "core"),
            FeishuSessionRoute.session_id == session_id,
        )
    ).first()
    now = time.time()
    if row is None:
        row = FeishuSessionRoute(
            user_id=int(user_id),
            ai_config_id=int(ai_config_id),
            ai_kind=str(ai_kind or "core"),
            session_id=session_id,
            receive_id=receive_id,
            receive_id_type=receive_id_type,
        )
    else:
        row.receive_id = receive_id
        row.receive_id_type = receive_id_type
        row.updated_at = now
    session.add(row)
    session.commit()


def _route_from_session_id(message: ChatMessage) -> Optional[FeishuSessionRoute]:
    session_id = str(message.session_id or "")
    ai_config_id = int(message.ai_config_id or 0)
    prefix = f"feishu_{ai_config_id}_"
    if not session_id.startswith(prefix):
        return None
    receive_id = session_id[len(prefix):].strip()
    if not receive_id:
        return None
    return FeishuSessionRoute(
        user_id=int(message.user_id),
        ai_config_id=ai_config_id,
        ai_kind=str(message.ai_kind or "core"),
        session_id=session_id,
        receive_id=receive_id,
        receive_id_type="chat_id",
    )


def _load_route(session: Session, message: ChatMessage) -> Optional[FeishuSessionRoute]:
    if not message.ai_config_id:
        return None
    row = session.exec(
        select(FeishuSessionRoute).where(
            FeishuSessionRoute.user_id == int(message.user_id),
            FeishuSessionRoute.ai_config_id == int(message.ai_config_id),
            FeishuSessionRoute.ai_kind == str(message.ai_kind or "core"),
            FeishuSessionRoute.session_id == str(message.session_id or ""),
        )
    ).first()
    return row or _route_from_session_id(message)


def _feishu_visible_content(message: ChatMessage) -> str:
    content = str(message.content or "")
    if not content:
        return ""
    content = MCP_CALL_RE.sub("", content)
    content = re.sub(r"<mcp[-_]call\b[\s\S]*$", "", content, flags=re.IGNORECASE)
    content = re.sub(r"\n{3,}", "\n\n", content)
    return content.strip()


def _is_feishu_visible_assistant_message(message: ChatMessage) -> bool:
    if message.role != "assistant":
        return False
    return bool(_feishu_visible_content(message))


def _feishu_assistant_prefix(session: Session, message: ChatMessage) -> str:
    message_id = int(message.id or 0)
    if not message_id:
        return "🤔" if str(message.think or "").strip() else ""

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
        (row for row in previous_assistants if _is_feishu_visible_assistant_message(row)),
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
            parts.append("🧰")
        if row.role == "assistant" and str(row.think or "").strip():
            parts.append("🤔")
    return "".join(parts)


def notify_saved_assistant_message(session: Session, message: ChatMessage) -> None:
    if not _is_feishu_visible_assistant_message(message):
        return
    content = _feishu_visible_content(message)
    if not str(message.session_id or "").startswith("feishu_"):
        return
    route = _load_route(session, message)
    if not route:
        return
    prefix = _feishu_assistant_prefix(session, message)
    content = f"{prefix}{content}" if prefix else content
    for start in range(0, len(content), FEISHU_TEXT_MAX_CHARS):
        chunk = content[start:start + FEISHU_TEXT_MAX_CHARS].strip()
        if not chunk:
            continue
        try:
            send_feishu_text_message(
                int(message.user_id),
                int(message.ai_config_id or 0),
                text=chunk,
                receive_id=str(route.receive_id or ""),
                receive_id_type=str(route.receive_id_type or "chat_id"),
            )
        except Exception as exc:
            print(f"[feishu_auto_notify] send failed message_id={message.id}: {exc}")
            return

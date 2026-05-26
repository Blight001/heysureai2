import re
import time
from typing import Optional

from sqlmodel import Session, select

from ..chat_runtime.mcp_parser import MCP_CALL_BLOCK_RE
from ..integrations.feishu.service import send_feishu_text_message
from ..integrations.qq.service import send_qq_text_message
from ..models import ChatMessage, FeishuSessionRoute, QQSessionRoute, User


FEISHU_TEXT_MAX_CHARS = 1800


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


def register_qq_session_route(
    session: Session,
    *,
    user_id: int,
    ai_config_id: int,
    ai_kind: str,
    session_id: str,
    target_id: str,
    target_type: str,
    source_message_id: str = "",
    source_event_id: str = "",
    next_msg_seq: int = 1,
) -> None:
    session_id = str(session_id or "").strip()
    target_id = str(target_id or "").strip()
    target_type = str(target_type or "c2c").strip() or "c2c"
    if not session_id or not target_id:
        return
    row = session.exec(
        select(QQSessionRoute).where(
            QQSessionRoute.user_id == int(user_id),
            QQSessionRoute.ai_config_id == int(ai_config_id),
            QQSessionRoute.ai_kind == str(ai_kind or "core"),
            QQSessionRoute.session_id == session_id,
        )
    ).first()
    now = time.time()
    if row is None:
        row = QQSessionRoute(
            user_id=int(user_id),
            ai_config_id=int(ai_config_id),
            ai_kind=str(ai_kind or "core"),
            session_id=session_id,
            target_id=target_id,
            target_type=target_type,
            source_message_id=str(source_message_id or ""),
            source_event_id=str(source_event_id or ""),
            next_msg_seq=max(1, int(next_msg_seq or 1)),
        )
    else:
        row.target_id = target_id
        row.target_type = target_type
        row.source_message_id = str(source_message_id or row.source_message_id or "")
        row.source_event_id = str(source_event_id or row.source_event_id or "")
        row.next_msg_seq = max(int(row.next_msg_seq or 1), int(next_msg_seq or 1))
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


def _load_qq_route(session: Session, message: ChatMessage) -> Optional[QQSessionRoute]:
    if not message.ai_config_id:
        return None
    return session.exec(
        select(QQSessionRoute).where(
            QQSessionRoute.user_id == int(message.user_id),
            QQSessionRoute.ai_config_id == int(message.ai_config_id),
            QQSessionRoute.ai_kind == str(message.ai_kind or "core"),
            QQSessionRoute.session_id == str(message.session_id or ""),
        )
    ).first()


def _feishu_visible_content(message: ChatMessage) -> str:
    content = str(message.content or "")
    if not content:
        return ""
    content = MCP_CALL_BLOCK_RE.sub("", content)
    content = re.sub(r"<mcp[-_]call\b[\s\S]*$", "", content, flags=re.IGNORECASE)
    content = re.sub(r"\n{3,}", "\n\n", content)
    return content.strip()


def _is_feishu_visible_assistant_message(message: ChatMessage) -> bool:
    if message.role != "assistant":
        return False
    return bool(_feishu_visible_content(message))


def _user_ui_icons(session: Session, user_id: int) -> dict[str, str]:
    user = session.get(User, int(user_id))
    return {
        "thinking": str(getattr(user, "ui_thinking_icon", "") or "🤔"),
        "mcp_success": str(getattr(user, "ui_mcp_success_icon", "") or getattr(user, "ui_mcp_icon", "") or "🧰"),
        "mcp_error": str(getattr(user, "ui_mcp_error_icon", "") or getattr(user, "ui_mcp_icon", "") or "🧰"),
    }


def _mcp_tool_icon_for_message(row: ChatMessage, icons: dict[str, str]) -> str:
    text = str(row.content or "")
    status_match = re.search(r"^状态[：:]\s*(.+)$", text, flags=re.MULTILINE)
    status = str(status_match.group(1) if status_match else "").strip()
    if status == "失败":
        return icons["mcp_error"]
    if status == "成功":
        return icons["mcp_success"]
    return icons["mcp_success"]


def _feishu_assistant_prefix(session: Session, message: ChatMessage) -> str:
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
            parts.append(_mcp_tool_icon_for_message(row, icons))
        if row.role == "assistant" and str(row.think or "").strip():
            parts.append(icons["thinking"])
    return "".join(parts)


def notify_saved_assistant_message(session: Session, message: ChatMessage) -> None:
    if not _is_feishu_visible_assistant_message(message):
        return
    content = _feishu_visible_content(message)
    session_id = str(message.session_id or "")
    if session_id.startswith("qq_"):
        route = _load_qq_route(session, message)
        if not route:
            return
        prefix = _feishu_assistant_prefix(session, message)
        content = f"{prefix}{content}" if prefix else content
        msg_seq = max(1, int(route.next_msg_seq or 1))
        try:
            send_qq_text_message(
                int(message.user_id),
                int(message.ai_config_id or 0),
                text=content,
                target_id=str(route.target_id or ""),
                target_type=str(route.target_type or "c2c"),
                msg_id=str(route.source_message_id or ""),
                event_id=str(route.source_event_id or ""),
                msg_seq=msg_seq if route.source_message_id else None,
            )
            route.next_msg_seq = msg_seq + 1
            route.updated_at = time.time()
            session.add(route)
            session.commit()
        except Exception as exc:
            print(f"[qq_auto_notify] send failed message_id={message.id}: {exc}")
        return

    if not session_id.startswith("feishu_"):
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

"""Conversation-level MCP tools."""

from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from ...database import engine
from ...models import ChatMessage
from ...services.chat_persistence import _rebuild_usage_snapshots
from ...services.agent_dispatch import get_run_session_context


def _coerce_int(value: Any) -> Optional[int]:
    try:
        if value is None or value == "":
            return None
        return int(value)
    except Exception:
        return None


def _conversation_scope(args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    run_ctx = get_run_session_context() or {}
    session_id = str(args.get("session_id") or run_ctx.get("session_id") or "").strip()
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")
    ai_kind = str(args.get("ai_kind") or run_ctx.get("ai_kind") or "assistant").strip() or "assistant"
    scoped_ai_config_id = _coerce_int(args.get("ai_config_id"))
    if scoped_ai_config_id is None:
        scoped_ai_config_id = _coerce_int(run_ctx.get("ai_config_id"))
    if scoped_ai_config_id is None:
        scoped_ai_config_id = ai_config_id
    return {
        "session_id": session_id,
        "ai_kind": ai_kind,
        "ai_config_id": scoped_ai_config_id,
        "current_message_id": _coerce_int(
            args.get("current_message_id")
            or args.get("keep_from_message_id")
            or run_ctx.get("current_user_message_id")
        ),
    }


def _forget_before_current(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    """Delete messages before the current user message in the active conversation."""
    scope = _conversation_scope(args, ai_config_id)
    session_id = scope["session_id"]
    ai_kind = scope["ai_kind"]
    scoped_ai_config_id = scope["ai_config_id"]
    current_message_id = scope["current_message_id"]

    with Session(engine) as session:
        cutoff_msg = None
        if current_message_id is not None:
            cutoff_msg = session.get(ChatMessage, current_message_id)
            if (
                not cutoff_msg
                or cutoff_msg.user_id != user_id
                or cutoff_msg.session_id != session_id
                or cutoff_msg.ai_kind != ai_kind
                or cutoff_msg.ai_config_id != scoped_ai_config_id
            ):
                raise HTTPException(status_code=404, detail="Current message not found in this conversation")
        else:
            stmt = select(ChatMessage).where(
                ChatMessage.user_id == user_id,
                ChatMessage.session_id == session_id,
                ChatMessage.ai_kind == ai_kind,
                ChatMessage.role == "user",
            )
            if scoped_ai_config_id is not None:
                stmt = stmt.where(ChatMessage.ai_config_id == scoped_ai_config_id)
            cutoff_msg = session.exec(stmt.order_by(ChatMessage.id.desc())).first()
            if not cutoff_msg:
                raise HTTPException(status_code=404, detail="No user message found in this conversation")
            current_message_id = int(cutoff_msg.id or 0)

        delete_stmt = select(ChatMessage).where(
            ChatMessage.user_id == user_id,
            ChatMessage.session_id == session_id,
            ChatMessage.ai_kind == ai_kind,
            ChatMessage.id < int(current_message_id or 0),
        )
        if scoped_ai_config_id is not None:
            delete_stmt = delete_stmt.where(ChatMessage.ai_config_id == scoped_ai_config_id)

        rows = session.exec(delete_stmt).all()
        for row in rows:
            session.delete(row)
        session.commit()
        _rebuild_usage_snapshots(session, user_id, ai_kind, scoped_ai_config_id)

    return {
        "success": True,
        "deleted_count": len(rows),
        "session_id": session_id,
        "ai_kind": ai_kind,
        "ai_config_id": scoped_ai_config_id,
        "kept_from_message_id": current_message_id,
        "note": "已删除当前消息之前的对话内容；当前消息及之后的内容已保留。",
    }

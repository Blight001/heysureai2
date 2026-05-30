"""Conversation-level MCP tools."""

import time
import uuid
from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from api.database import engine
from api.models import ChatMessage, ChatSession
from api.services.chat_persistence import _rebuild_usage_snapshots
from connector_runtime.dispatch.agent_dispatch import get_run_session_context


def _coerce_int(value: Any) -> Optional[int]:
    try:
        if value is None or value == "":
            return None
        return int(value)
    except Exception:
        return None


def _conversation_scope(args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    scope = _conversation_base_scope(args, ai_config_id)
    session_id = str(args.get("session_id") or scope.get("session_id") or "").strip()
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")
    scope["session_id"] = session_id
    scope["current_message_id"] = _coerce_int(
        args.get("current_message_id")
        or args.get("keep_from_message_id")
        or (get_run_session_context() or {}).get("current_user_message_id")
    )
    return scope


def _conversation_base_scope(args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    run_ctx = get_run_session_context() or {}
    ai_kind = str(args.get("ai_kind") or run_ctx.get("ai_kind") or "assistant").strip() or "assistant"
    scoped_ai_config_id = _coerce_int(args.get("ai_config_id"))
    if scoped_ai_config_id is None:
        scoped_ai_config_id = _coerce_int(run_ctx.get("ai_config_id"))
    if scoped_ai_config_id is None:
        scoped_ai_config_id = ai_config_id
    return {
        "session_id": str(args.get("session_id") or run_ctx.get("session_id") or "").strip(),
        "ai_kind": ai_kind,
        "ai_config_id": scoped_ai_config_id,
    }


def _session_filter(stmt, user_id: int, ai_kind: str, ai_config_id: Optional[int]):
    stmt = stmt.where(ChatSession.user_id == user_id, ChatSession.ai_kind == ai_kind)
    if ai_config_id is not None:
        stmt = stmt.where(ChatSession.ai_config_id == ai_config_id)
    else:
        stmt = stmt.where(ChatSession.ai_config_id.is_(None))
    return stmt


def _message_filter(stmt, user_id: int, ai_kind: str, ai_config_id: Optional[int]):
    stmt = stmt.where(ChatMessage.user_id == user_id, ChatMessage.ai_kind == ai_kind)
    if ai_config_id is not None:
        stmt = stmt.where(ChatMessage.ai_config_id == ai_config_id)
    else:
        stmt = stmt.where(ChatMessage.ai_config_id.is_(None))
    return stmt


def _session_summary(row: ChatSession, messages: list[ChatMessage]) -> Dict[str, Any]:
    last_message = max(messages, key=lambda msg: msg.created_at, default=None)
    return {
        "id": row.session_id,
        "session_id": row.session_id,
        "name": row.session_name,
        "session_name": row.session_name,
        "ai_kind": row.ai_kind,
        "ai_config_id": row.ai_config_id,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "message_count": len(messages),
        "total_tokens": sum(int(msg.total_tokens or 0) for msg in messages),
        "last_message": (
            {
                "id": last_message.id,
                "role": last_message.role,
                "content": (last_message.content or "")[:500],
                "created_at": last_message.created_at,
            }
            if last_message
            else None
        ),
    }


def _find_conversation(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    """Find chat sessions by name, session id, or message content."""
    scope = _conversation_base_scope(args, ai_config_id)
    query = str(args.get("query") or args.get("keyword") or "").strip().lower()
    session_id = str(args.get("session_id") or "").strip()
    limit = _coerce_int(args.get("limit")) or 20
    limit = max(1, min(limit, 100))
    include_messages = bool(args.get("include_messages") or args.get("with_messages"))

    with Session(engine) as session:
        session_stmt = _session_filter(select(ChatSession), user_id, scope["ai_kind"], scope["ai_config_id"])
        if session_id:
            session_stmt = session_stmt.where(ChatSession.session_id == session_id)
        session_rows = session.exec(session_stmt.order_by(ChatSession.updated_at.desc())).all()

        message_stmt = _message_filter(select(ChatMessage), user_id, scope["ai_kind"], scope["ai_config_id"])
        if session_id:
            message_stmt = message_stmt.where(ChatMessage.session_id == session_id)
        all_messages = session.exec(message_stmt.order_by(ChatMessage.created_at.asc())).all()

    messages_by_session: Dict[str, list[ChatMessage]] = {}
    for msg in all_messages:
        messages_by_session.setdefault(msg.session_id or "default", []).append(msg)

    results = []
    for row in session_rows:
        row_messages = messages_by_session.get(row.session_id, [])
        if query:
            haystacks = [row.session_id or "", row.session_name or ""]
            haystacks.extend(msg.content or "" for msg in row_messages)
            if not any(query in item.lower() for item in haystacks):
                continue
        item = _session_summary(row, row_messages)
        if include_messages:
            item["messages"] = [
                {
                    "id": msg.id,
                    "role": msg.role,
                    "content": msg.content,
                    "think": msg.think,
                    "tags": msg.tags,
                    "created_at": msg.created_at,
                }
                for msg in row_messages
            ]
        results.append(item)
        if len(results) >= limit:
            break

    return {
        "success": True,
        "query": query,
        "count": len(results),
        "sessions": results,
        "ai_kind": scope["ai_kind"],
        "ai_config_id": scope["ai_config_id"],
    }


def _create_conversation(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    """Create a new empty chat session."""
    scope = _conversation_base_scope(args, ai_config_id)
    session_name = str(args.get("name") or args.get("session_name") or "").strip() or "未命名会话"
    requested_session_id = str(args.get("session_id") or "").strip()
    sid = requested_session_id or f"session_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"

    with Session(engine) as session:
        existing = session.exec(
            _session_filter(select(ChatSession), user_id, scope["ai_kind"], scope["ai_config_id"]).where(
                ChatSession.session_id == sid
            )
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail="Session already exists")
        now = time.time()
        row = ChatSession(
            user_id=user_id,
            ai_config_id=scope["ai_config_id"],
            ai_kind=scope["ai_kind"],
            session_id=sid,
            session_name=session_name,
            created_at=now,
            updated_at=now,
        )
        session.add(row)
        session.commit()
        session.refresh(row)

    return {
        "success": True,
        "id": row.session_id,
        "session_id": row.session_id,
        "name": row.session_name,
        "session_name": row.session_name,
        "ai_kind": row.ai_kind,
        "ai_config_id": row.ai_config_id,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "note": "已新建空白对话。",
    }


def _delete_conversation(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    """Delete a chat session and all messages in it."""
    scope = _conversation_scope(args, ai_config_id)
    session_id = scope["session_id"]

    with Session(engine) as session:
        message_stmt = _message_filter(
            select(ChatMessage).where(ChatMessage.session_id == session_id),
            user_id,
            scope["ai_kind"],
            scope["ai_config_id"],
        )
        messages = session.exec(message_stmt).all()
        session_stmt = _session_filter(
            select(ChatSession).where(ChatSession.session_id == session_id),
            user_id,
            scope["ai_kind"],
            scope["ai_config_id"],
        )
        sessions = session.exec(session_stmt).all()
        if not messages and not sessions:
            raise HTTPException(status_code=404, detail="Session not found")

        for row in messages:
            session.delete(row)
        for row in sessions:
            session.delete(row)
        session.commit()
        _rebuild_usage_snapshots(session, user_id, scope["ai_kind"], scope["ai_config_id"])

    return {
        "success": True,
        "session_id": session_id,
        "ai_kind": scope["ai_kind"],
        "ai_config_id": scope["ai_config_id"],
        "deleted_messages": len(messages),
        "deleted_sessions": len(sessions),
        "note": "已删除该对话及其消息。",
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


# ---------------------------------------------------------------------------
# Unified "机器人对话区" — shared conversation pool + multi-session switching.
#
# One AI exposes a single shared pool spanning the web UI and all bot channels.
# These tools operate on that whole pool with NO channel/identity isolation:
# any caller may list and switch to any session belonging to the AI. A
# per-identity cursor (BotUserCursor) only decides where the asking identity's
# *next* inbound message lands, so concurrent external users don't clobber each
# other's "current session".
# ---------------------------------------------------------------------------


def _current_identity(session, user_id: int, scope: Dict[str, Any]):
    """Resolve the asking bot identity ``(channel, identity_key)`` from the run.

    Returns ``None`` for web-only runs (no bot route on the current session) —
    such callers can list/switch but there is no per-identity cursor to move.
    """
    from connector_runtime.bots.session_cursor import resolve_identity_for_session

    run_ctx = get_run_session_context() or {}
    current_session_id = str(run_ctx.get("session_id") or "").strip()
    if not current_session_id:
        return None, ""
    ident = resolve_identity_for_session(
        session,
        user_id=user_id,
        ai_config_id=scope["ai_config_id"],
        ai_kind=scope["ai_kind"],
        session_id=current_session_id,
    )
    return ident, current_session_id


def _list_conversations(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    """List every conversation in this AI's shared pool (web + all bot channels)."""
    from connector_runtime.bots.session_cursor import get_active_session_id, list_ai_sessions

    scope = _conversation_base_scope(args, ai_config_id)
    limit = _coerce_int(args.get("limit")) or 50

    with Session(engine) as session:
        ident, current_session_id = _current_identity(session, user_id, scope)
        active = current_session_id
        if ident:
            channel, identity_key = ident
            active = get_active_session_id(
                session,
                channel=channel,
                user_id=user_id,
                ai_config_id=scope["ai_config_id"],
                ai_kind=scope["ai_kind"],
                identity_key=identity_key,
                default=current_session_id,
            )
        rows = list_ai_sessions(
            session,
            user_id=user_id,
            ai_config_id=scope["ai_config_id"],
            ai_kind=scope["ai_kind"],
            active_session_id=active,
            limit=limit,
        )

    return {
        "success": True,
        "count": len(rows),
        "active_session_id": active,
        "sessions": rows,
        "ai_kind": scope["ai_kind"],
        "ai_config_id": scope["ai_config_id"],
        "note": "这是该 AI 的全部对话（网页 + 各机器人渠道，共享同一对话区）。",
    }


def _resolve_target_session(session, user_id: int, scope: Dict[str, Any], args: Dict[str, Any]) -> Optional[ChatSession]:
    """Find the session to switch to by explicit id, else by name/query match."""
    target_id = str(args.get("session_id") or "").strip()
    base_stmt = _session_filter(select(ChatSession), user_id, scope["ai_kind"], scope["ai_config_id"])
    if target_id:
        return session.exec(base_stmt.where(ChatSession.session_id == target_id)).first()
    query = str(args.get("name") or args.get("query") or "").strip().lower()
    if not query:
        return None
    candidates = session.exec(base_stmt.order_by(ChatSession.updated_at.desc())).all()
    for row in candidates:
        if query in str(row.session_name or "").lower() or query in str(row.session_id or "").lower():
            return row
    return None


def _switch_conversation(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    """Point this identity's cursor at another conversation in the shared pool.

    Takes effect from the user's NEXT message; the current reply still lands in
    the current conversation (delivery follows the inbound identity).
    """
    from connector_runtime.bots.session_cursor import set_active_session_id

    scope = _conversation_base_scope(args, ai_config_id)
    with Session(engine) as session:
        target = _resolve_target_session(session, user_id, scope, args)
        if not target:
            raise HTTPException(status_code=404, detail="Target conversation not found in this AI")
        ident, _current = _current_identity(session, user_id, scope)
        if not ident:
            raise HTTPException(
                status_code=400,
                detail="conversation.switch is only available from a bot conversation",
            )
        channel, identity_key = ident
        set_active_session_id(
            session,
            channel=channel,
            user_id=user_id,
            ai_config_id=scope["ai_config_id"],
            ai_kind=scope["ai_kind"],
            identity_key=identity_key,
            session_id=target.session_id,
        )

    return {
        "success": True,
        "session_id": target.session_id,
        "name": target.session_name,
        "ai_kind": scope["ai_kind"],
        "ai_config_id": scope["ai_config_id"],
        "note": "已切换；将在你的下一条消息生效，本条回复仍发回当前对话。",
    }


def _new_conversation(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    """Create a new conversation in the pool and point this identity's cursor at it."""
    from connector_runtime.bots.session_cursor import set_active_session_id

    scope = _conversation_base_scope(args, ai_config_id)
    session_name = str(args.get("name") or args.get("session_name") or "").strip() or "新对话"
    sid = f"session_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"

    with Session(engine) as session:
        now = time.time()
        row = ChatSession(
            user_id=user_id,
            ai_config_id=scope["ai_config_id"],
            ai_kind=scope["ai_kind"],
            session_id=sid,
            session_name=session_name,
            created_at=now,
            updated_at=now,
        )
        session.add(row)
        session.commit()
        session.refresh(row)

        ident, _current = _current_identity(session, user_id, scope)
        switched = False
        if ident:
            channel, identity_key = ident
            set_active_session_id(
                session,
                channel=channel,
                user_id=user_id,
                ai_config_id=scope["ai_config_id"],
                ai_kind=scope["ai_kind"],
                identity_key=identity_key,
                session_id=sid,
            )
            switched = True

    return {
        "success": True,
        "session_id": row.session_id,
        "name": row.session_name,
        "switched": switched,
        "ai_kind": scope["ai_kind"],
        "ai_config_id": scope["ai_config_id"],
        "note": (
            "已新建对话并切换；将在你的下一条消息生效，本条回复仍发回当前对话。"
            if switched
            else "已新建空白对话。"
        ),
    }

"""Conversation-level MCP tools."""

import time
import uuid
from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlmodel import Session, select

from api.database import engine
from api.models import BotSessionRoute, ChatMessage, ChatSession
from api.services.chat_media import delete_message_media
from api.services.chat_persistence import _rebuild_usage_snapshots
from connector_runtime.dispatch.device_dispatch import get_run_session_context


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


def _message_detail(row: ChatMessage) -> Dict[str, Any]:
    return {
        "id": row.id,
        "role": row.role,
        "content": row.content,
        "think": row.think,
        "tags": row.tags,
        "model": row.model,
        "prompt_tokens": row.prompt_tokens,
        "completion_tokens": row.completion_tokens,
        "total_tokens": row.total_tokens,
        "finish_reason": row.finish_reason,
        "latency": row.latency,
        "created_at": row.created_at,
    }


def _conversation_detail(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    """Read one conversation and a page of its messages."""
    scope = _conversation_scope(args, ai_config_id)
    session_id = scope["session_id"]
    offset = max(0, _coerce_int(args.get("offset")) or 0)
    limit = max(1, min(_coerce_int(args.get("limit")) or 100, 500))

    with Session(engine) as session:
        session_row = session.exec(
            _session_filter(
                select(ChatSession).where(ChatSession.session_id == session_id),
                user_id,
                scope["ai_kind"],
                scope["ai_config_id"],
            )
        ).first()
        if not session_row:
            raise HTTPException(status_code=404, detail="Session not found")

        base_message_stmt = _message_filter(
            select(ChatMessage).where(ChatMessage.session_id == session_id),
            user_id,
            scope["ai_kind"],
            scope["ai_config_id"],
        )
        messages = session.exec(
            base_message_stmt.order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc()).offset(offset).limit(limit)
        ).all()
        stats_stmt = _message_filter(
            select(
                func.count(ChatMessage.id),
                func.coalesce(func.sum(ChatMessage.total_tokens), 0),
            ).where(ChatMessage.session_id == session_id),
            user_id,
            scope["ai_kind"],
            scope["ai_config_id"],
        )
        message_count, total_tokens = session.exec(stats_stmt).one()
        message_count = int(message_count or 0)
        latest_message = session.exec(
            base_message_stmt.order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc()).limit(1)
        ).first()

    session_summary = _session_summary(session_row, [latest_message] if latest_message else [])
    session_summary["message_count"] = message_count
    session_summary["total_tokens"] = int(total_tokens or 0)

    return {
        "success": True,
        "session": session_summary,
        "messages": [_message_detail(message) for message in messages],
        "offset": offset,
        "limit": limit,
        "message_count": message_count,
        "has_more": offset + len(messages) < message_count,
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

        delete_message_media(session, messages)
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


def _edit_conversation(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    """Rename a conversation or clear its messages while keeping the session."""
    scope = _conversation_scope(args, ai_config_id)
    session_id = scope["session_id"]
    action = str(args.get("action") or args.get("operation") or "").strip().lower()
    if action not in {"rename", "clear"}:
        raise HTTPException(status_code=400, detail="action must be rename or clear")

    with Session(engine) as session:
        session_row = session.exec(
            _session_filter(
                select(ChatSession).where(ChatSession.session_id == session_id),
                user_id,
                scope["ai_kind"],
                scope["ai_config_id"],
            )
        ).first()
        if not session_row:
            raise HTTPException(status_code=404, detail="Session not found")

        message_stmt = _message_filter(
            select(ChatMessage).where(ChatMessage.session_id == session_id),
            user_id,
            scope["ai_kind"],
            scope["ai_config_id"],
        )

        if action == "rename":
            session_name = str(args.get("name") or args.get("session_name") or "").strip()
            if not session_name:
                raise HTTPException(status_code=400, detail="name is required for rename")
            messages = session.exec(message_stmt).all()
            session_row.session_name = session_name
            session_row.updated_at = time.time()
            session.add(session_row)
            for message in messages:
                message.session_name = session_name
                session.add(message)
            session.commit()
            return {
                "success": True,
                "action": "rename",
                "session_id": session_id,
                "name": session_name,
                "updated_messages": len(messages),
                "ai_kind": scope["ai_kind"],
                "ai_config_id": scope["ai_config_id"],
                "note": "已重命名对话。",
            }

        keep_current = args.get("keep_current_message") is not False
        current_message_id = scope["current_message_id"] if keep_current else None
        current_message = session.get(ChatMessage, current_message_id) if current_message_id else None
        preserves_current = bool(
            current_message
            and current_message.user_id == user_id
            and current_message.session_id == session_id
            and current_message.ai_kind == scope["ai_kind"]
            and current_message.ai_config_id == scope["ai_config_id"]
        )
        run_session_id = str((get_run_session_context() or {}).get("session_id") or "").strip()
        if keep_current and current_message_id and run_session_id == session_id and not preserves_current:
            raise HTTPException(status_code=404, detail="Current message not found in this conversation")
        if preserves_current:
            message_stmt = message_stmt.where(ChatMessage.id < int(current_message_id or 0))
        messages = session.exec(message_stmt).all()
        delete_message_media(session, messages)
        for message in messages:
            session.delete(message)
        session_row.updated_at = time.time()
        session.add(session_row)
        session.commit()
        _rebuild_usage_snapshots(session, user_id, scope["ai_kind"], scope["ai_config_id"])

    return {
        "success": True,
        "action": "clear",
        "session_id": session_id,
        "deleted_messages": len(messages),
        "kept_from_message_id": current_message_id if preserves_current else None,
        "ai_kind": scope["ai_kind"],
        "ai_config_id": scope["ai_config_id"],
        "note": "已清空此前对话内容并保留当前消息。" if preserves_current else "已清空对话内容并保留会话。",
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
        stats_stmt = _message_filter(
            select(
                ChatMessage.session_id,
                func.count(ChatMessage.id),
                func.coalesce(func.sum(ChatMessage.total_tokens), 0),
            ),
            user_id,
            scope["ai_kind"],
            scope["ai_config_id"],
        ).group_by(ChatMessage.session_id)
        stats = {
            str(session_id): {
                "message_count": int(message_count or 0),
                "total_tokens": int(total_tokens or 0),
            }
            for session_id, message_count, total_tokens in session.exec(stats_stmt).all()
        }
        for row in rows:
            row.update(stats.get(str(row.get("session_id") or ""), {"message_count": 0, "total_tokens": 0}))

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
    target_snapshot = None
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
        current_session_id = str((get_run_session_context() or {}).get("session_id") or "").strip()
        set_active_session_id(
            session,
            channel=channel,
            user_id=user_id,
            ai_config_id=scope["ai_config_id"],
            ai_kind=scope["ai_kind"],
            identity_key=identity_key,
            session_id=target.session_id,
        )
        if current_session_id:
            _clone_bot_route(
                session,
                user_id=user_id,
                ai_kind=scope["ai_kind"],
                ai_config_id=scope["ai_config_id"],
                channel=channel,
                from_session_id=current_session_id,
                to_session_id=target.session_id,
            )
        target_snapshot = {
            "session_id": target.session_id,
            "name": target.session_name,
        }

    return {
        "success": True,
        "session_id": target_snapshot["session_id"],
        "name": target_snapshot["name"],
        "ai_kind": scope["ai_kind"],
        "ai_config_id": scope["ai_config_id"],
        "note": "已切换；将在你的下一条消息生效，本条回复仍发回当前对话。",
    }


def _clone_bot_route(
    session: Session,
    *,
    user_id: int,
    ai_kind: str,
    ai_config_id: Optional[int],
    channel: str,
    from_session_id: str,
    to_session_id: str,
) -> None:
    from_session_id = str(from_session_id or "").strip()
    to_session_id = str(to_session_id or "").strip()
    if not from_session_id or not to_session_id or from_session_id == to_session_id:
        return

    source_stmt = select(BotSessionRoute).where(
        BotSessionRoute.channel == str(channel),
        BotSessionRoute.user_id == int(user_id),
        BotSessionRoute.ai_kind == str(ai_kind or "core"),
        BotSessionRoute.session_id == from_session_id,
    )
    if ai_config_id is not None:
        source_stmt = source_stmt.where(BotSessionRoute.ai_config_id == int(ai_config_id))
    else:
        source_stmt = source_stmt.where(BotSessionRoute.ai_config_id.is_(None))
    source = session.exec(source_stmt).first()
    if not source:
        return

    target_stmt = select(BotSessionRoute).where(
        BotSessionRoute.channel == str(channel),
        BotSessionRoute.user_id == int(user_id),
        BotSessionRoute.ai_kind == str(ai_kind or "core"),
        BotSessionRoute.session_id == to_session_id,
    )
    if ai_config_id is not None:
        target_stmt = target_stmt.where(BotSessionRoute.ai_config_id == int(ai_config_id))
    else:
        target_stmt = target_stmt.where(BotSessionRoute.ai_config_id.is_(None))
    target = session.exec(target_stmt).first()

    now = time.time()
    if target is None:
        target = BotSessionRoute(
            channel=str(channel),
            user_id=int(user_id),
            ai_config_id=int(ai_config_id) if ai_config_id is not None else None,
            ai_kind=str(ai_kind or "core"),
            session_id=to_session_id,
            target_json=str(source.target_json or ""),
            source_message_id="",
            source_event_id="",
            next_msg_seq=1,
            created_at=now,
            updated_at=now,
        )
        session.add(target)
        session.commit()


def _new_conversation(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    """Create a new conversation in the pool and point this identity's cursor at it."""
    from connector_runtime.bots.session_cursor import set_active_session_id

    scope = _conversation_base_scope(args, ai_config_id)
    session_name = str(args.get("name") or args.get("session_name") or "").strip() or "新对话"
    sid = f"session_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
    row_snapshot = None

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
        row_snapshot = {
            "session_id": row.session_id,
            "session_name": row.session_name,
        }

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
            current_session_id = str((_current or "")).strip()
            if current_session_id:
                _clone_bot_route(
                    session,
                    user_id=user_id,
                    ai_kind=scope["ai_kind"],
                    ai_config_id=scope["ai_config_id"],
                    channel=channel,
                    from_session_id=current_session_id,
                    to_session_id=sid,
                )
            switched = True

    return {
        "success": True,
        "session_id": row_snapshot["session_id"],
        "name": row_snapshot["session_name"],
        "switched": switched,
        "ai_kind": scope["ai_kind"],
        "ai_config_id": scope["ai_config_id"],
        "note": (
            "已新建对话并切换；将在你的下一条消息生效，本条回复仍发回当前对话。"
            if switched
            else "已新建空白对话。"
        ),
    }

"""AI ↔ AI 消息服务（事件驱动 + 严格 session 匹配）。

设计要点
========

* 每条 AIMessage 在入库时就绑定 ``target_session_id``——目标 AI 必须在
  匹配的 session 里才能把它 pop 出来。这样同一个 AI 在多个并行会话里
  不会串话。
* 发送方阻塞等待回复时走 ``_PendingReplyRegistry``：一个进程内的
  ``concurrent.futures.Future`` 表。对方从同一通信 session 里发回的
  ``ai.send_message`` 会立即 resolve 对应 Future。
* worker 线程跑 MCP 工具时是临时 asyncio loop，跨线程用
  ``asyncio.wrap_future`` 把 ``concurrent.futures.Future`` 转成可 await
  的对象，``set_result`` 的回调会通过 ``call_soon_threadsafe`` 安全派
  发到等待方的 loop。
* 当 wait 期间整个工具调用全程都在 ``ChatRun.status='running'``，
  ``chat_scheduler`` 的 supervision_idle 计时不会触发——天然解决"AI
  等回复时被系统判定为僵死"的问题。
"""

from __future__ import annotations

import asyncio
import hashlib
import re
import threading
import time
import uuid
from concurrent.futures import Future
from typing import Any, Dict, List, Optional

from sqlmodel import Session, select

from ..database import engine
from ..models import AIMessage, AssistantAIConfig, ChatRun, ChatSession


# ---------------------------------------------------------------------------
# Pending-reply registry (跨线程的事件驱动通知)
# ---------------------------------------------------------------------------


class _PendingReplyRegistry:
    """进程内的 message_id → Future 注册表。

    发送方调用 ``register`` 拿到一个 Future，目标 AI 调用 ``reply``
    成功后 ``resolve`` 会立即唤醒。等待方在 timeout/cancel 时主动调用
    ``discard`` 清理。所有方法均为线程安全。
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._waiters: Dict[str, Future] = {}

    def register(self, message_id: str) -> Future:
        fut: Future = Future()
        with self._lock:
            old = self._waiters.pop(message_id, None)
            self._waiters[message_id] = fut
        if old is not None and not old.done():
            # 旧 waiter 异常残留——给个明确状态，不让对方永远挂着。
            old.set_result({"status": "failed", "failure_reason": "superseded by new waiter"})
        return fut

    def resolve(self, message_id: str, payload: Dict[str, Any]) -> bool:
        with self._lock:
            fut = self._waiters.pop(message_id, None)
        if fut is None:
            return False
        if not fut.done():
            fut.set_result(payload)
        return True

    def discard(self, message_id: str) -> None:
        with self._lock:
            self._waiters.pop(message_id, None)


_pending_replies = _PendingReplyRegistry()
_WAKE_LOCK = threading.Lock()


def _new_message_id() -> str:
    return f"mai_{uuid.uuid4().hex[:14]}"


def _content_requests_response(content: str) -> bool:
    text = (content or "").strip().lower()
    if not text:
        return False
    return bool(re.search(r"(回复|回信|回话|回应|答复|确认|收到|回我|回传|reply|respond|response|ack)", text))


def stable_peer_session_id(
    *,
    user_id: int,
    from_ai_config_id: int,
    to_ai_config_id: int,
    from_session_id: str,
) -> str:
    """Deterministic target-side session for one sender conversation."""
    from_session_id = (from_session_id or "").strip()
    seed = f"{int(user_id)}:{int(from_ai_config_id)}:{int(to_ai_config_id)}:{from_session_id}"
    digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()[:16]
    return f"ai_mail_{int(from_ai_config_id)}_{int(to_ai_config_id)}_{digest}"


# ---------------------------------------------------------------------------
# Send / fetch / reply
# ---------------------------------------------------------------------------


_ALLOWED_MESSAGE_TYPES = {"inquiry", "reply", "chitchat", "notify"}


def _normalize_message_type(value: Optional[str], *, require_reply: bool) -> str:
    text = str(value or "").strip().lower()
    if text in _ALLOWED_MESSAGE_TYPES:
        return text
    # 兜底：require_reply=True 默认 inquiry，否则 notify。保持旧调用者无须显式指定。
    return "inquiry" if require_reply else "notify"


def send(
    *,
    user_id: int,
    from_ai_config_id: int,
    to_ai_config_id: int,
    content: str,
    target_session_id: str,
    from_session_id: str = "",
    require_reply: bool = True,
    timeout_seconds: int = 120,
    message_type: Optional[str] = None,
    cascade_depth: int = 0,
) -> AIMessage:
    """落库一条消息。``target_session_id`` 是消费方在哪个 session 里
    处理它，不能为空。"""
    content = (content or "").strip()
    if not content:
        raise ValueError("content is required")
    if int(from_ai_config_id) == int(to_ai_config_id):
        raise ValueError("cannot send message to self")
    target_session_id = (target_session_id or "").strip()
    if not target_session_id:
        raise ValueError("target_session_id is required")
    normalized_type = _normalize_message_type(message_type, require_reply=require_reply)
    safe_depth = max(0, int(cascade_depth or 0))
    with Session(engine) as session:
        from_cfg = session.exec(
            select(AssistantAIConfig).where(
                AssistantAIConfig.user_id == user_id,
                AssistantAIConfig.id == from_ai_config_id,
            )
        ).first()
        to_cfg = session.exec(
            select(AssistantAIConfig).where(
                AssistantAIConfig.user_id == user_id,
                AssistantAIConfig.id == to_ai_config_id,
            )
        ).first()
        if not from_cfg or not to_cfg:
            raise ValueError("source or target AI config not found")
        row = AIMessage(
            message_id=_new_message_id(),
            user_id=user_id,
            from_ai_config_id=from_ai_config_id,
            to_ai_config_id=to_ai_config_id,
            target_session_id=target_session_id,
            from_session_id=(from_session_id or "").strip(),
            content=content,
            require_reply=bool(require_reply),
            timeout_seconds=max(5, int(timeout_seconds or 120)),
            status="pending",
            message_type=normalized_type,
            cascade_depth=safe_depth,
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return row


def fetch_cascade_parent(*, user_id: int, message_id: str) -> Optional[AIMessage]:
    """读取链路父消息（用于从 reply_to_message_id 推导 cascade_depth）。"""
    message_id = (message_id or "").strip()
    if not message_id:
        return None
    with Session(engine) as session:
        return session.exec(
            select(AIMessage).where(
                AIMessage.user_id == user_id,
                AIMessage.message_id == message_id,
            )
        ).first()


def fetch(message_id: str, user_id: int) -> Optional[AIMessage]:
    with Session(engine) as session:
        return session.exec(
            select(AIMessage).where(
                AIMessage.user_id == user_id,
                AIMessage.message_id == message_id,
            )
        ).first()


def complete_inbound_with_assistant_reply(
    *,
    message_id: str,
    user_id: int,
    replier_ai_config_id: int,
    content: str,
) -> Optional[Dict[str, Any]]:
    """Use the receiver's final assistant text as the reply for an AI message.

    Models sometimes answer the injected AI-to-AI message as normal assistant
    text instead of calling ``ai.send_message``. This keeps the mail semantics
    reliable: a final answer in the bound receiver session still wakes the
    original sender.
    """
    message_id = (message_id or "").strip()
    content = (content or "").strip()
    if not message_id or not content:
        return None
    with Session(engine) as session:
        row = session.exec(
            select(AIMessage).where(
                AIMessage.user_id == user_id,
                AIMessage.message_id == message_id,
            )
        ).first()
        if not row:
            return None
        if int(row.to_ai_config_id) != int(replier_ai_config_id):
            return None
        waited_reply = bool(row.require_reply)
        requires_reply = waited_reply or str(getattr(row, "message_type", "") or "").lower() == "inquiry"
        if not requires_reply and not _content_requests_response(row.content):
            return None
        if row.status in {"replied", "failed"}:
            payload = _row_to_dict(row)
            payload["already_resolved"] = True
            return payload
        previous_status = str(row.status or "")
        row.reply_content = content
        row.status = "replied"
        row.replied_at = time.time()
        session.add(row)
        session.commit()
        session.refresh(row)
        payload = _row_to_dict(row)

    resolved_waiter = _pending_replies.resolve(message_id, payload)
    payload["waiter_resolved"] = resolved_waiter
    payload["auto_completed"] = True
    if not resolved_waiter and not waited_reply:
        payload["auto_forwarded"] = True
        _enqueue_unwaited_reply(payload)
    elif not resolved_waiter and previous_status == "timeout":
        _enqueue_unwaited_reply(payload)
    return payload


def _enqueue_unwaited_reply(original: Dict[str, Any]) -> None:
    """Route late/fire-and-forget replies back to the original sender.

    If the sender is still synchronously waiting, ``reply`` resolves its Future
    and this path is skipped. Otherwise the reply would only sit on the
    AIMessage row and the original AI would not get a fresh runtime interrupt.
    """
    user_id = int(original.get("user_id") or 0)
    from_ai_config_id = int(original.get("from_ai_config_id") or 0)
    to_ai_config_id = int(original.get("to_ai_config_id") or 0)
    if not user_id or not from_ai_config_id or not to_ai_config_id:
        return

    reply_content = str(original.get("reply_content") or "").strip()
    if not reply_content:
        return

    target_session_id = str(original.get("from_session_id") or "").strip()
    if not target_session_id:
        target_session_id = get_active_session_id(user_id, from_ai_config_id) or f"ai_message_reply_{uuid.uuid4().hex[:14]}"

    parent_depth = int(original.get("cascade_depth") or 0)
    try:
        followup = send(
            user_id=user_id,
            from_ai_config_id=to_ai_config_id,
            to_ai_config_id=from_ai_config_id,
            content=reply_content,
            target_session_id=target_session_id,
            from_session_id=str(original.get("target_session_id") or "").strip(),
            require_reply=False,
            timeout_seconds=5,
            message_type="reply",
            cascade_depth=parent_depth + 1,
        )
    except Exception as exc:
        print(f"[ai_message_service] enqueue unwaited reply failed: {exc}")
        return

    try:
        wake_idle_target_for_message(message_id=followup.message_id, user_id=user_id)
    except Exception as exc:
        print(f"[ai_message_service] wake sender for unwaited reply failed: {exc}")


def pop_pending_for(
    user_id: int,
    ai_config_id: int,
    session_id: str,
) -> Optional[AIMessage]:
    """目标 AI worker 每轮顶部调用：取出该 (用户, AI, session) 下最早的
    pending 消息，原子地标记 delivered 并返回。

    严格按 ``target_session_id`` 匹配——这是会话隔离的关键。一个 AI
    在 session A 里跑 worker 时，绝对不会把发给它 session B 的消息抓
    走，因此不再出现 "对话对不上" 的情况。
    """
    session_id = (session_id or "").strip()
    if not session_id:
        return None
    with Session(engine) as session:
        row = session.exec(
            select(AIMessage).where(
                AIMessage.user_id == user_id,
                AIMessage.to_ai_config_id == ai_config_id,
                AIMessage.target_session_id == session_id,
                AIMessage.status == "pending",
            ).order_by(AIMessage.created_at.asc())
        ).first()
        if not row:
            return None
        row.status = "delivered"
        row.delivered_at = time.time()
        session.add(row)
        session.commit()
        session.refresh(row)
        return row


def _row_to_dict(row: AIMessage) -> Dict[str, Any]:
    return {
        "message_id": row.message_id,
        "user_id": row.user_id,
        "from_ai_config_id": row.from_ai_config_id,
        "to_ai_config_id": row.to_ai_config_id,
        "target_session_id": row.target_session_id,
        "from_session_id": row.from_session_id,
        "content": row.content,
        "status": row.status,
        "reply_content": row.reply_content,
        "require_reply": row.require_reply,
        "timeout_seconds": row.timeout_seconds,
        "message_type": getattr(row, "message_type", "notify") or "notify",
        "cascade_depth": int(getattr(row, "cascade_depth", 0) or 0),
        "delivered_at": row.delivered_at,
        "replied_at": row.replied_at,
        "failure_reason": row.failure_reason,
        "created_at": row.created_at,
    }


# ---------------------------------------------------------------------------
# 事件驱动的等待
# ---------------------------------------------------------------------------


async def wait_for_reply(
    *,
    message_id: str,
    user_id: int,
    timeout_seconds: int,
) -> Dict[str, Any]:
    """阻塞当前 async 上下文直到回复到达或超时。

    实现：先抢注 Future（防丢事件），再回看一遍 DB（防 register 之前
    回复就已写入），最后 ``await asyncio.wrap_future`` 等待跨线程
    set_result。
    """
    timeout = max(1, int(timeout_seconds or 120))
    fut = _pending_replies.register(message_id)
    try:
        # Race guard: 回复可能在 register 之前就完成了。
        early = fetch(message_id, user_id)
        if early and early.status in {"replied", "timeout", "failed"}:
            _pending_replies.discard(message_id)
            return _row_to_dict(early)
        try:
            result = await asyncio.wait_for(asyncio.wrap_future(fut), timeout=timeout)
            return result
        except asyncio.TimeoutError:
            _pending_replies.discard(message_id)
            with Session(engine) as session:
                latest = session.exec(
                    select(AIMessage).where(AIMessage.message_id == message_id)
                ).first()
                if latest and latest.status not in {"replied", "failed"}:
                    latest.status = "timeout"
                    latest.failure_reason = "wait_for_reply timeout"
                    session.add(latest)
                    session.commit()
                    session.refresh(latest)
                return _row_to_dict(latest) if latest else {"status": "timeout"}
    finally:
        # 兜底，确保不留 dangling waiter。
        _pending_replies.discard(message_id)


# ---------------------------------------------------------------------------
# 目标 AI 的状态查询 / 唤醒
# ---------------------------------------------------------------------------


def get_active_session_id(user_id: int, to_ai_config_id: int) -> Optional[str]:
    """返回目标 AI 当前最新活跃 run 的 session_id；无则 None。"""
    with Session(engine) as session:
        row = _get_live_active_run(session, user_id, to_ai_config_id)
        return row.session_id if row else None


def find_corresponding_target_session_id(
    *,
    user_id: int,
    from_ai_config_id: int,
    to_ai_config_id: int,
    from_session_id: str,
) -> str:
    """Return the target-side session bound to this sender conversation."""
    from_session_id = (from_session_id or "").strip()
    if not from_session_id:
        return ""
    with Session(engine) as session:
        row = session.exec(
            select(AIMessage).where(
                AIMessage.user_id == user_id,
                AIMessage.from_ai_config_id == from_ai_config_id,
                AIMessage.to_ai_config_id == to_ai_config_id,
                AIMessage.from_session_id == from_session_id,
                AIMessage.target_session_id != "",
                AIMessage.status != "failed",
            ).order_by(AIMessage.created_at.desc())
        ).first()
        if row:
            target_session_id = str(row.target_session_id or "").strip()
            if target_session_id:
                return target_session_id
    return stable_peer_session_id(
        user_id=user_id,
        from_ai_config_id=from_ai_config_id,
        to_ai_config_id=to_ai_config_id,
        from_session_id=from_session_id,
    )


def find_return_route(
    *,
    user_id: int,
    current_ai_config_id: int,
    target_ai_config_id: int,
    current_session_id: str,
) -> Dict[str, Any]:
    """Find the original sender session when replying with ai.send_message.

    If AI B is currently processing a message from AI A in session S2, the
    original AIMessage stores A's session as ``from_session_id``. A later
    ``ai.send_message(to_ai_config_id=A)`` from S2 should route back there.
    """
    current_session_id = (current_session_id or "").strip()
    if not current_session_id:
        return {}
    with Session(engine) as session:
        row = session.exec(
            select(AIMessage).where(
                AIMessage.user_id == user_id,
                AIMessage.from_ai_config_id == target_ai_config_id,
                AIMessage.to_ai_config_id == current_ai_config_id,
                AIMessage.target_session_id == current_session_id,
                AIMessage.from_session_id != "",
                AIMessage.status.in_(["delivered", "replied", "timeout"]),
            ).order_by(AIMessage.delivered_at.desc(), AIMessage.created_at.desc())
        ).first()
        return _row_to_dict(row) if row else {}


def find_return_route_by_message_id(
    *,
    user_id: int,
    current_ai_config_id: int,
    target_ai_config_id: int,
    message_id: str,
) -> Dict[str, Any]:
    """Find the original route for an explicit AI message id."""
    message_id = (message_id or "").strip()
    if not message_id:
        return {}
    with Session(engine) as session:
        row = session.exec(
            select(AIMessage).where(
                AIMessage.user_id == user_id,
                AIMessage.message_id == message_id,
                AIMessage.from_ai_config_id == target_ai_config_id,
                AIMessage.to_ai_config_id == current_ai_config_id,
                AIMessage.from_session_id != "",
                AIMessage.status != "failed",
            )
        ).first()
        return _row_to_dict(row) if row else {}


def resolve_waiting_reply_to_message_id_from_send_message(
    *,
    user_id: int,
    current_ai_config_id: int,
    target_ai_config_id: int,
    message_id: str,
    content: str,
) -> Optional[Dict[str, Any]]:
    """Treat ``ai.send_message`` as a reply to an explicit AI message id."""
    message_id = (message_id or "").strip()
    content = (content or "").strip()
    if not message_id or not content:
        return None
    with Session(engine) as session:
        row = session.exec(
            select(AIMessage).where(
                AIMessage.user_id == user_id,
                AIMessage.message_id == message_id,
                AIMessage.from_ai_config_id == target_ai_config_id,
                AIMessage.to_ai_config_id == current_ai_config_id,
                AIMessage.status.in_(["pending", "delivered", "timeout"]),
            )
        ).first()
        if not row:
            return None
        row.reply_content = content
        row.status = "replied"
        row.replied_at = time.time()
        session.add(row)
        session.commit()
        session.refresh(row)
        payload = _row_to_dict(row)
    resolved_waiter = _pending_replies.resolve(message_id, payload)
    payload["waiter_resolved"] = resolved_waiter
    payload["reply_to_message_id"] = message_id
    if not resolved_waiter:
        _enqueue_unwaited_reply(payload)
    return payload


def resolve_waiting_reply_from_send_message(
    *,
    user_id: int,
    current_ai_config_id: int,
    target_ai_config_id: int,
    current_session_id: str,
    content: str,
) -> Optional[Dict[str, Any]]:
    """Treat a return ``ai.send_message`` as the reply for a waiting sender.

    Prompts now tell AIs to use ``ai.send_message`` in both directions. This
    bridges that behavior with the older synchronous ``require_reply=true``
    wait path so the sender does not block until timeout.
    """
    content = (content or "").strip()
    current_session_id = (current_session_id or "").strip()
    if not content or not current_session_id:
        return None
    with Session(engine) as session:
        row = session.exec(
            select(AIMessage).where(
                AIMessage.user_id == user_id,
                AIMessage.from_ai_config_id == target_ai_config_id,
                AIMessage.to_ai_config_id == current_ai_config_id,
                AIMessage.target_session_id == current_session_id,
                AIMessage.from_session_id != "",
                AIMessage.status.in_(["pending", "delivered", "timeout"]),
            ).order_by(AIMessage.delivered_at.desc(), AIMessage.created_at.desc())
        ).first()
        if not row:
            return None
        row.reply_content = content
        row.status = "replied"
        row.replied_at = time.time()
        session.add(row)
        session.commit()
        session.refresh(row)
        payload = _row_to_dict(row)
    resolved_waiter = _pending_replies.resolve(str(payload.get("message_id") or ""), payload)
    payload["waiter_resolved"] = resolved_waiter
    payload["reply_to_message_id"] = payload.get("message_id")
    if not resolved_waiter:
        _enqueue_unwaited_reply(payload)
    return payload


def _get_live_active_run(
    session: Session,
    user_id: int,
    ai_config_id: int,
    *,
    session_id: str = "",
) -> Optional[ChatRun]:
    stmt = select(ChatRun).where(
        ChatRun.user_id == user_id,
        ChatRun.ai_config_id == ai_config_id,
        ChatRun.status.in_(["queued", "running"]),
    )
    if session_id:
        stmt = stmt.where(ChatRun.session_id == session_id)
    rows = session.exec(stmt.order_by(ChatRun.updated_at.desc())).all()
    now = time.time()
    for row in rows:
        if _run_thread_is_alive(str(row.run_id or "")):
            return row
        if row.status == "queued" and now - float(row.created_at or now) < 5:
            return row
        row.status = "failed"
        row.error_message = "stale active run without live worker thread"
        row.finished_at = now
        row.updated_at = now
        session.add(row)
    if rows:
        session.commit()
    return None


def _run_thread_is_alive(run_id: str) -> bool:
    if not run_id:
        return False
    try:
        from api.routers.chat_base import _RUN_THREADS
        worker = _RUN_THREADS.get(run_id)
        return bool(worker and worker.is_alive())
    except Exception:
        return False


def _clear_live_run_state(run_id: str) -> None:
    if not run_id:
        return
    try:
        from api.routers.chat_base import _RUN_LIVE_STATE, _RUN_STATE_LOCK
        with _RUN_STATE_LOCK:
            _RUN_LIVE_STATE.pop(run_id, None)
    except Exception:
        return


def _mark_run_interrupted(session: Session, row: ChatRun, message_id: str) -> Dict[str, Any]:
    now = time.time()
    row.stop_requested = True
    row.status = "stopped"
    row.error_message = f"interrupted by AI message {message_id}"
    row.finished_at = row.finished_at or now
    row.updated_at = now
    session.add(row)
    _clear_live_run_state(str(row.run_id or ""))
    return {
        "run_id": row.run_id,
        "session_id": row.session_id,
        "ai_kind": row.ai_kind,
        "session_name": row.session_name,
    }


def wake_idle_target_for_message(
    *,
    message_id: str,
    user_id: int,
    max_steps: Optional[int] = None,
) -> Dict[str, Any]:
    with _WAKE_LOCK:
        return _wake_idle_target_for_message_locked(
            message_id=message_id,
            user_id=user_id,
            max_steps=max_steps,
        )


def _wake_idle_target_for_message_locked(
    *,
    message_id: str,
    user_id: int,
    max_steps: Optional[int] = None,
) -> Dict[str, Any]:
    """Start a fresh target-AI conversation when an AI message would otherwise
    sit in the inbox with no worker polling it."""
    with Session(engine) as session:
        msg = session.exec(
            select(AIMessage).where(
                AIMessage.user_id == user_id,
                AIMessage.message_id == message_id,
            )
        ).first()
        if not msg:
            raise ValueError("message not found")

        target_id = int(msg.to_ai_config_id)
        target_session_id = str(msg.target_session_id or "").strip()
        active = (
            _get_live_active_run(session, user_id, target_id, session_id=target_session_id)
            or _get_live_active_run(session, user_id, target_id)
        )
        interrupted = None
        if active:
            interrupted = _mark_run_interrupted(session, active, message_id)
            active_session_id = str(active.session_id or "").strip()
            if active_session_id:
                msg.target_session_id = active_session_id
                session.add(msg)
                target_session_id = active_session_id

        target_cfg = session.exec(
            select(AssistantAIConfig).where(
                AssistantAIConfig.user_id == user_id,
                AssistantAIConfig.id == target_id,
            )
        ).first()
        from_cfg = session.exec(
            select(AssistantAIConfig).where(
                AssistantAIConfig.user_id == user_id,
                AssistantAIConfig.id == int(msg.from_ai_config_id),
            )
        ).first()
        if not target_cfg:
            raise ValueError("target AI config not found")

        ai_kind = "assistant" if target_cfg.ai_role == "assistant_admin" else "core"
        from_name = str(from_cfg.name or "").strip() if from_cfg else f"AI-{msg.from_ai_config_id}"
        target_name = str(target_cfg.name or "").strip() or f"AI-{target_id}"
        # ``send()`` 已经写好了 target_session_id；这里直接复用，
        # 确保消息和 session 在同一标识下。
        session_id = target_session_id or msg.target_session_id or f"ai_message_{message_id}"
        if not msg.target_session_id:
            msg.target_session_id = session_id
            session.add(msg)
        existing_chat_session = session.exec(
            select(ChatSession).where(
                ChatSession.user_id == user_id,
                ChatSession.ai_config_id == target_id,
                ChatSession.ai_kind == ai_kind,
                ChatSession.session_id == session_id,
            ).order_by(ChatSession.updated_at.desc())
        ).first()
        interrupted_session_name = str((interrupted or {}).get("session_name") or "").strip()
        if interrupted and str(interrupted.get("session_id") or "").strip() == session_id and interrupted_session_name:
            session_name = interrupted_session_name
        elif existing_chat_session:
            session_name = str(existing_chat_session.session_name or "").strip()
        else:
            session_name = f"AI通信：来自 {from_name}"
        if existing_chat_session is None:
            chat_session = ChatSession(
                user_id=user_id,
                ai_config_id=target_id,
                ai_kind=ai_kind,
                session_id=session_id,
                session_name=session_name,
            )
            session.add(chat_session)

        run_id = f"run_{uuid.uuid4().hex}"
        row = ChatRun(
            run_id=run_id,
            user_id=user_id,
            ai_config_id=target_id,
            ai_kind=ai_kind,
            session_id=session_id,
            session_name=session_name,
            status="queued",
            stop_requested=False,
        )
        session.add(row)
        session.commit()

    from api.routers.chat_base import _RUN_THREADS
    from api.routers.chat_worker import _run_worker

    worker = threading.Thread(
        target=_run_worker,
        kwargs={
            "run_id": run_id,
            "user_id": user_id,
            "ai_config_id": target_id,
            "ai_kind": ai_kind,
            "session_id": session_id,
            "session_name": session_name,
            "model_user_content": None,
            "merged_system_prompt": None,
            "max_steps": max_steps,
        },
        daemon=True,
    )
    _RUN_THREADS[run_id] = worker
    worker.start()
    return {
        "started": True,
        "run_id": run_id,
        "session_id": session_id,
        "session_name": session_name,
        "ai_kind": ai_kind,
        "to_ai_config_id": target_id,
        "to_ai_name": target_name,
        "interrupted": bool(interrupted),
        "interrupted_run": interrupted,
    }

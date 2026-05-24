"""AI ↔ AI 消息服务（事件驱动 + 严格 session 匹配）。

设计要点
========

* 每条 AIMessage 在入库时就绑定 ``target_session_id``——目标 AI 必须在
  匹配的 session 里才能把它 pop 出来。这样同一个 AI 在多个并行会话里
  不会串话。
* 发送方阻塞等待回复时走 ``_PendingReplyRegistry``：一个进程内的
  ``concurrent.futures.Future`` 表，``ai.reply_message`` 落库后会立即
  resolve 对应 Future，比 1 秒一次的 DB 轮询响应快两个数量级。
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


def _new_message_id() -> str:
    return f"mai_{uuid.uuid4().hex[:14]}"


# ---------------------------------------------------------------------------
# Send / fetch / reply
# ---------------------------------------------------------------------------


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
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return row


def fetch(message_id: str, user_id: int) -> Optional[AIMessage]:
    with Session(engine) as session:
        return session.exec(
            select(AIMessage).where(
                AIMessage.user_id == user_id,
                AIMessage.message_id == message_id,
            )
        ).first()


def mark_delivered(message_id: str) -> Optional[AIMessage]:
    with Session(engine) as session:
        row = session.exec(
            select(AIMessage).where(AIMessage.message_id == message_id)
        ).first()
        if not row:
            return None
        if row.status == "pending":
            row.status = "delivered"
            row.delivered_at = time.time()
            session.add(row)
            session.commit()
            session.refresh(row)
        return row


def reply(
    *,
    message_id: str,
    user_id: int,
    replier_ai_config_id: int,
    content: str,
) -> AIMessage:
    """目标 AI 调用 ai.reply_message 时落库 + 唤醒等待方。"""
    content = (content or "").strip()
    if not content:
        raise ValueError("reply content is required")
    with Session(engine) as session:
        row = session.exec(
            select(AIMessage).where(
                AIMessage.user_id == user_id,
                AIMessage.message_id == message_id,
            )
        ).first()
        if not row:
            raise ValueError("message not found")
        if int(row.to_ai_config_id) != int(replier_ai_config_id):
            raise ValueError("only the receiver of this message may reply")
        if row.status in {"replied", "timeout", "failed"}:
            raise ValueError(f"message already in terminal state: {row.status}")
        row.reply_content = content
        row.status = "replied"
        row.replied_at = time.time()
        session.add(row)
        session.commit()
        session.refresh(row)
        payload = _row_to_dict(row)
    # 落库成功后再唤醒，确保等待方读到 DB 也是最新状态。
    _pending_replies.resolve(message_id, payload)
    return row


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


def list_inbox(*, user_id: int, ai_config_id: int, include_resolved: bool = False) -> List[Dict[str, Any]]:
    with Session(engine) as session:
        stmt = select(AIMessage).where(
            AIMessage.user_id == user_id,
            AIMessage.to_ai_config_id == ai_config_id,
        )
        if not include_resolved:
            stmt = stmt.where(AIMessage.status.in_(["pending", "delivered"]))
        rows = session.exec(stmt.order_by(AIMessage.created_at.desc()).limit(50)).all()
        return [_row_to_dict(r) for r in rows]


def _row_to_dict(row: AIMessage) -> Dict[str, Any]:
    return {
        "message_id": row.message_id,
        "from_ai_config_id": row.from_ai_config_id,
        "to_ai_config_id": row.to_ai_config_id,
        "target_session_id": row.target_session_id,
        "from_session_id": row.from_session_id,
        "content": row.content,
        "status": row.status,
        "reply_content": row.reply_content,
        "require_reply": row.require_reply,
        "timeout_seconds": row.timeout_seconds,
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


def target_has_active_run(user_id: int, to_ai_config_id: int) -> bool:
    """判断目标 AI 是否有正在进行的 run（用于 send 前的提示，非强制）。"""
    with Session(engine) as session:
        row = session.exec(
            select(ChatRun).where(
                ChatRun.user_id == user_id,
                ChatRun.ai_config_id == to_ai_config_id,
                ChatRun.status.in_(["queued", "running"]),
            )
        ).first()
        return row is not None


def get_active_session_id(user_id: int, to_ai_config_id: int) -> Optional[str]:
    """返回目标 AI 当前最新活跃 run 的 session_id；无则 None。"""
    with Session(engine) as session:
        row = session.exec(
            select(ChatRun).where(
                ChatRun.user_id == user_id,
                ChatRun.ai_config_id == to_ai_config_id,
                ChatRun.status.in_(["queued", "running"]),
            ).order_by(ChatRun.updated_at.desc())
        ).first()
        return row.session_id if row else None


def reserve_idle_session_id(message_id: str) -> str:
    """对于目标 AI 当前空闲的情况，预先生成它即将启动的 session_id。
    这样 send() 时就能把 target_session_id 写入消息，pop 时严格匹配。"""
    return f"ai_message_{message_id}"


def wake_idle_target_for_message(
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
        active = session.exec(
            select(ChatRun).where(
                ChatRun.user_id == user_id,
                ChatRun.ai_config_id == target_id,
                ChatRun.status.in_(["queued", "running"]),
            ).order_by(ChatRun.updated_at.desc())
        ).first()
        if active:
            return {
                "started": False,
                "reason": "target already has an active run",
                "run_id": active.run_id,
                "session_id": active.session_id,
                "ai_kind": active.ai_kind,
            }

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
        # ``send()`` 已经写好了 target_session_id（来自 reserve_idle_session_id），
        # 这里直接复用，确保消息和 session 在同一标识下。
        session_id = msg.target_session_id or f"ai_message_{message_id}"
        if not msg.target_session_id:
            msg.target_session_id = session_id
            session.add(msg)
        session_name = f"AI通信：来自 {from_name}"

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
    worker.start()
    _RUN_THREADS[run_id] = worker
    return {
        "started": True,
        "run_id": run_id,
        "session_id": session_id,
        "session_name": session_name,
        "ai_kind": ai_kind,
        "to_ai_config_id": target_id,
        "to_ai_name": target_name,
    }

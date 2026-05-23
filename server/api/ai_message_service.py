"""AI ↔ AI 同步消息服务（带回复语义与发送方阻塞等待）。

设计要点：
- 真正的"中断"靠目标 AI worker 在主循环顶部检查收件箱实现，详见
  chat_worker._poll_inbound_ai_message 钩子。
- 发送方走 async handler + asyncio.sleep 轮询 DB，等到 status=replied
  或超时；这样不阻塞别的 worker 线程（每个 MCP 调用都有自己的
  asyncio.run() 创建的临时 loop）。
"""

from __future__ import annotations

import asyncio
import threading
import time
import uuid
from typing import Any, Dict, List, Optional

from sqlmodel import Session, select

from .database import engine
from .models import AIMessage, AssistantAIConfig, ChatRun, ChatSession


def _new_message_id() -> str:
    return f"mai_{uuid.uuid4().hex[:14]}"


def send(
    *,
    user_id: int,
    from_ai_config_id: int,
    to_ai_config_id: int,
    content: str,
    require_reply: bool = True,
    timeout_seconds: int = 120,
) -> AIMessage:
    """同步写入一条消息（不等待回复）。返回 AIMessage。"""
    content = (content or "").strip()
    if not content:
        raise ValueError("content is required")
    if int(from_ai_config_id) == int(to_ai_config_id):
        raise ValueError("cannot send message to self")
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
    """目标 AI 调用 ai.reply_message 时落库。"""
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
        return row


def pop_pending_for(user_id: int, ai_config_id: int) -> Optional[AIMessage]:
    """目标 AI worker 每轮顶部调用：取最早一条 pending 消息，原子地标记
    delivered 并返回；无则 None。"""
    with Session(engine) as session:
        row = session.exec(
            select(AIMessage).where(
                AIMessage.user_id == user_id,
                AIMessage.to_ai_config_id == ai_config_id,
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


async def wait_for_reply(
    *,
    message_id: str,
    user_id: int,
    timeout_seconds: int,
    poll_interval: float = 1.0,
) -> Dict[str, Any]:
    """async 轮询消息状态。返回最终的 dict（含 status 与 reply_content）。

    用在 ai.send_message 的发送方 handler 中：发送后阻塞最多 timeout_seconds，
    一旦目标 AI 回复就立即返回。
    """
    deadline = time.time() + max(1, int(timeout_seconds or 120))
    while True:
        row = fetch(message_id, user_id)
        if not row:
            return {"status": "failed", "failure_reason": "message vanished"}
        if row.status in {"replied", "timeout", "failed"}:
            return _row_to_dict(row)
        if time.time() >= deadline:
            # 标记超时
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
        await asyncio.sleep(poll_interval)


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


def wake_idle_target_for_message(
    *,
    message_id: str,
    user_id: int,
    max_steps: Optional[int] = None,
) -> Dict[str, Any]:
    """Start a fresh target-AI conversation when an AI message would otherwise
    sit in the inbox with no worker polling it.
    """
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
        session_id = f"ai_message_{message_id}"
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

import threading
import time
import uuid
from typing import Any, Dict, Optional

from sqlmodel import Session, select

from ..database import engine
from ..models import AITaskJob, AssistantAIConfig, ChatMessageCreate, ChatRun, ChatSession
from ..services import ai_message_service
from ..services.chat_persistence import _save_message

TASK_COMPLETION_RECEIPT = "【任务完成回执】"
_TASK_NOTICE_WAKE_LOCK = threading.Lock()
_TASK_NOTICE_WAKE_SESSIONS: set[str] = set()


def _ai_name(session: Session, user_id: int, ai_config_id: Optional[int]) -> str:
    if not ai_config_id:
        return ""
    row = session.exec(
        select(AssistantAIConfig).where(
            AssistantAIConfig.user_id == user_id,
            AssistantAIConfig.id == int(ai_config_id),
        )
    ).first()
    return str(row.name or "").strip() if row else f"AI-{ai_config_id}"


def _completion_notice(
    *,
    job: AITaskJob,
    executor_name: str,
    summary: str,
) -> str:
    return TASK_COMPLETION_RECEIPT


def _ai_kind_for_config(session: Session, user_id: int, ai_config_id: int) -> str:
    row = session.exec(
        select(AssistantAIConfig).where(
            AssistantAIConfig.user_id == user_id,
            AssistantAIConfig.id == int(ai_config_id),
        )
    ).first()
    if row and row.ai_role == "assistant_admin":
        return "assistant"
    return "core"


def _start_creator_notice_run(
    *,
    user_id: int,
    ai_config_id: int,
    ai_kind: str,
    session_id: str,
    session_name: str,
) -> Dict[str, Any]:
    run_id = f"run_{uuid.uuid4().hex}"
    with Session(engine) as session:
        active = ai_message_service._get_live_active_run(
            session,
            user_id,
            ai_config_id,
            session_id=session_id,
        )
        if active:
            return {"started": False, "reason": "target_active", "run_id": active.run_id}
        row = ChatRun(
            run_id=run_id,
            user_id=user_id,
            ai_config_id=ai_config_id,
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
            "ai_config_id": ai_config_id,
            "ai_kind": ai_kind,
            "session_id": session_id,
            "session_name": session_name,
            "model_user_content": None,
            "merged_system_prompt": None,
            "max_steps": 6,
        },
        daemon=True,
    )
    _RUN_THREADS[run_id] = worker
    worker.start()
    return {"started": True, "run_id": run_id}


def _wait_idle_then_start_creator_notice_run(
    *,
    wake_key: str,
    user_id: int,
    ai_config_id: int,
    ai_kind: str,
    session_id: str,
    session_name: str,
) -> None:
    try:
        deadline = time.time() + 24 * 60 * 60
        while time.time() < deadline:
            with Session(engine) as session:
                active = ai_message_service._get_live_active_run(
                    session,
                    user_id,
                    ai_config_id,
                    session_id=session_id,
                )
            if not active:
                _start_creator_notice_run(
                    user_id=user_id,
                    ai_config_id=ai_config_id,
                    ai_kind=ai_kind,
                    session_id=session_id,
                    session_name=session_name,
                )
                return
            time.sleep(0.5)
    finally:
        with _TASK_NOTICE_WAKE_LOCK:
            _TASK_NOTICE_WAKE_SESSIONS.discard(wake_key)


def notify_task_completion(
    *,
    user_id: int,
    job_id: str,
    summary: str = "",
) -> Dict[str, Any]:
    """Return task completion to the AI/session that scheduled the job.

    The notification is idempotent per job. Cross-AI notifications use the
    existing AI-message inbox so the scheduler AI is woken in its original
    session. Self-scheduled tasks are appended directly to the original session.
    """
    job_id = str(job_id or "").strip()
    summary = str(summary or "").strip()
    if not job_id:
        return {"notified": False, "reason": "missing_job_id"}

    with Session(engine) as session:
        job = session.exec(
            select(AITaskJob).where(
                AITaskJob.user_id == user_id,
                AITaskJob.job_id == job_id,
            )
        ).first()
        if not job:
            return {"notified": False, "reason": "job_not_found"}
        if job.completion_notified_at:
            return {"notified": False, "reason": "already_notified", "notified_at": job.completion_notified_at}

        creator_id = int(job.created_by_ai_config_id or 0)
        creator_session_id = str(job.created_by_session_id or "").strip()
        if not creator_id:
            return {"notified": False, "reason": "missing_creator_ai"}
        if not creator_session_id:
            return {"notified": False, "reason": "missing_creator_session"}

        creator_ai_kind = _ai_kind_for_config(session, user_id, creator_id)
        content = _completion_notice(job=job, executor_name="", summary=summary)
        now = time.time()

        chat_session = session.exec(
            select(ChatSession).where(
                ChatSession.user_id == user_id,
                ChatSession.ai_config_id == creator_id,
                ChatSession.ai_kind == creator_ai_kind,
                ChatSession.session_id == creator_session_id,
            ).order_by(ChatSession.updated_at.desc())
        ).first()
        session_name = str(chat_session.session_name or "").strip() if chat_session else ""
        if not session_name:
            session_name = f"任务完成回执：{job.title}"
        if chat_session is None:
            session.add(ChatSession(
                user_id=user_id,
                ai_config_id=creator_id,
                ai_kind=creator_ai_kind,
                session_id=creator_session_id,
                session_name=session_name,
            ))

        _save_message(
            session,
            user_id,
            ChatMessageCreate(
                role="user",
                content=content,
                tags=f"task_completion_notice:{job.job_id}",
                ai_config_id=creator_id,
                ai_kind=creator_ai_kind,
                session_id=creator_session_id,
                session_name=session_name,
                total_tokens=0,
            ),
        )
        job.completion_notified_at = now
        session.add(job)
        session.commit()

    wake_key = f"{user_id}:{creator_id}:{creator_ai_kind}:{creator_session_id}"
    wakeup: Dict[str, Any]
    with Session(engine) as session:
        active = ai_message_service._get_live_active_run(
            session,
            user_id,
            creator_id,
            session_id=creator_session_id,
        )
    if active:
        with _TASK_NOTICE_WAKE_LOCK:
            should_wait = wake_key not in _TASK_NOTICE_WAKE_SESSIONS
            if should_wait:
                _TASK_NOTICE_WAKE_SESSIONS.add(wake_key)
        if should_wait:
            threading.Thread(
                target=_wait_idle_then_start_creator_notice_run,
                kwargs={
                    "wake_key": wake_key,
                    "user_id": user_id,
                    "ai_config_id": creator_id,
                    "ai_kind": creator_ai_kind,
                    "session_id": creator_session_id,
                    "session_name": session_name,
                },
                daemon=True,
            ).start()
        wakeup = {"started": False, "reason": "target_active", "run_id": active.run_id, "queued_after_active": True}
    else:
        wakeup = _start_creator_notice_run(
            user_id=user_id,
            ai_config_id=creator_id,
            ai_kind=creator_ai_kind,
            session_id=creator_session_id,
            session_name=session_name,
        )

    return {
        "notified": True,
        "mode": "session_message",
        "content": TASK_COMPLETION_RECEIPT,
        "to_ai_config_id": creator_id,
        "target_session_id": creator_session_id,
        "wakeup": wakeup,
    }
            select(AITaskJob).where(
                AITaskJob.user_id == user_id,
                AITaskJob.job_id == job_id,
            )
        ).first()
        if row and not row.completion_notified_at:
            row.completion_notified_at = now
            session.add(row)
            session.commit()
    return {
        "notified": True,
        "mode": "ai_message",
        "message_id": message.message_id,
        "to_ai_config_id": creator_id,
        "target_session_id": creator_session_id,
        "wakeup": wakeup,
    }

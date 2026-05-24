"""human.ask MCP tool (Phase 4: Human-in-the-loop).

An AI can pause and ask the human a question. The tool creates a pending
HumanRequest, notifies the user's UI over Socket.IO, then blocks (polling)
until the user answers via POST /api/human/answer or the timeout elapses.
"""

import asyncio
import json
import time
import uuid
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from .database import engine
from .models import HumanRequest
from .sio import sio

_KINDS = {"confirm", "select", "text"}


def _normalize_options(value: Any) -> List[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [piece.strip() for piece in value.split(",") if piece.strip()]
    return []


async def _human_ask(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    prompt = str(args.get("prompt") or args.get("question") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt/question is required for human.ask")
    kind = str(args.get("kind") or "text").strip().lower()
    if kind not in _KINDS:
        raise HTTPException(status_code=400, detail=f"kind must be one of {sorted(_KINDS)}")
    options = _normalize_options(args.get("options"))
    if kind == "confirm" and not options:
        options = ["确认", "取消"]

    try:
        timeout_seconds = int(args.get("timeout_seconds") or 300)
    except Exception:
        timeout_seconds = 300
    timeout_seconds = max(5, min(3600, timeout_seconds))
    try:
        poll_interval = int(args.get("poll_interval_seconds") or 2)
    except Exception:
        poll_interval = 2
    poll_interval = max(1, min(15, poll_interval))

    request_id = f"human_{uuid.uuid4().hex[:12]}"
    session_id = str(args.get("session_id") or "").strip() or None
    job_id = str(args.get("job_id") or "").strip() or None

    with Session(engine) as session:
        row = HumanRequest(
            request_id=request_id,
            user_id=user_id,
            ai_config_id=ai_config_id,
            session_id=session_id,
            job_id=job_id,
            kind=kind,
            prompt=prompt,
            options=json.dumps(options, ensure_ascii=False),
            status="pending",
        )
        session.add(row)
        session.commit()

    await sio.emit(
        "human:ask",
        {
            "requestId": request_id,
            "userId": user_id,
            "aiConfigId": ai_config_id,
            "sessionId": session_id,
            "jobId": job_id,
            "kind": kind,
            "prompt": prompt,
            "options": options,
            "createdAt": time.time(),
        },
        room=f"user_{user_id}",
    )

    deadline = time.time() + timeout_seconds
    while True:
        with Session(engine) as session:
            current = session.exec(
                select(HumanRequest).where(HumanRequest.request_id == request_id)
            ).first()
            if current and current.status == "answered":
                return {
                    "answered": True,
                    "timed_out": False,
                    "request_id": request_id,
                    "kind": kind,
                    "prompt": prompt,
                    "answer": current.answer or "",
                }
            if current and current.status == "cancelled":
                return {
                    "answered": False,
                    "cancelled": True,
                    "timed_out": False,
                    "request_id": request_id,
                    "answer": "",
                }
        if time.time() >= deadline:
            with Session(engine) as session:
                current = session.exec(
                    select(HumanRequest).where(HumanRequest.request_id == request_id)
                ).first()
                if current and current.status == "pending":
                    current.status = "timeout"
                    current.answered_at = time.time()
                    session.add(current)
                    session.commit()
            await sio.emit(
                "human:resolved",
                {"requestId": request_id, "userId": user_id, "status": "timeout"},
                room=f"user_{user_id}",
            )
            return {
                "answered": False,
                "timed_out": True,
                "request_id": request_id,
                "prompt": prompt,
                "answer": "",
            }
        await asyncio.sleep(poll_interval)

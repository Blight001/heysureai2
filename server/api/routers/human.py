"""REST endpoints for Human-in-the-loop (Phase 4).

POST /api/human/answer  – submit a human answer for a pending HumanRequest
GET  /api/human/pending – list pending requests for the current user
"""

import json
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from api.database import get_session, engine
from api.models import HumanRequest
from api.routers.auth import get_current_user
from api.sio import sio

router = APIRouter()
PREFIX = "/api/human"


class AnswerPayload(BaseModel):
    request_id: str
    answer: str


def _human_request_to_dict(row: HumanRequest) -> Dict[str, Any]:
    try:
        options = json.loads(row.options or "[]")
    except Exception:
        options = []
    return {
        "request_id": row.request_id,
        "ai_config_id": row.ai_config_id,
        "session_id": row.session_id,
        "job_id": row.job_id,
        "kind": row.kind,
        "prompt": row.prompt,
        "options": options,
        "status": row.status,
        "answer": row.answer,
        "created_at": row.created_at,
        "answered_at": row.answered_at,
    }


@router.post("/answer")
async def submit_answer(
    payload: AnswerPayload,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    row = session.exec(
        select(HumanRequest).where(
            HumanRequest.user_id == user.id,
            HumanRequest.request_id == payload.request_id,
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="HumanRequest not found")
    if row.status != "pending":
        raise HTTPException(status_code=409, detail=f"Request already resolved: {row.status}")

    row.answer = payload.answer
    row.status = "answered"
    row.answered_at = time.time()
    session.add(row)
    session.commit()

    await sio.emit(
        "human:resolved",
        {
            "requestId": row.request_id,
            "userId": user.id,
            "status": "answered",
            "answer": payload.answer,
        },
        room=f"user_{user.id}",
    )

    return {"answered": True, "request_id": row.request_id}


@router.post("/cancel")
async def cancel_request(
    payload: AnswerPayload,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    row = session.exec(
        select(HumanRequest).where(
            HumanRequest.user_id == user.id,
            HumanRequest.request_id == payload.request_id,
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="HumanRequest not found")
    if row.status != "pending":
        raise HTTPException(status_code=409, detail=f"Request already resolved: {row.status}")

    row.status = "cancelled"
    row.answered_at = time.time()
    session.add(row)
    session.commit()

    await sio.emit(
        "human:resolved",
        {
            "requestId": row.request_id,
            "userId": user.id,
            "status": "cancelled",
        },
        room=f"user_{user.id}",
    )

    return {"cancelled": True, "request_id": row.request_id}


@router.get("/pending")
def list_pending(
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    rows = session.exec(
        select(HumanRequest)
        .where(HumanRequest.user_id == user.id, HumanRequest.status == "pending")
        .order_by(HumanRequest.created_at.asc())
    ).all()
    return {
        "count": len(rows),
        "requests": [_human_request_to_dict(r) for r in rows],
    }

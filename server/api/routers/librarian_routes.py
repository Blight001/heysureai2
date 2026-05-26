"""图书管理员 / 知识库的用户侧接口。

- GET  /api/librarian/proposals      → 列出待审批条目
- POST /api/librarian/proposals/{memory_id}/approve  → 用户确认（可携带 edited_content）
- POST /api/librarian/proposals/{memory_id}/reject   → 用户驳回
- GET  /api/librarian/entries        → 列出 active 条目（按 status 过滤）
- GET  /api/librarian/entries/{memory_id}  → 读全文
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlmodel import Session

from api.services import librarian_service
from api.database import get_session
from api.routers.auth import get_current_user


PREFIX = "/api/librarian"
router = APIRouter()


class ApproveBody(BaseModel):
    edited_content: Optional[str] = None


class RejectBody(BaseModel):
    reason: Optional[str] = None


class IntrinsicPropertyToolBody(BaseModel):
    name: str
    description: Optional[str] = ""
    parameters: Optional[List[Dict[str, Any]]] = None


class IntrinsicPropertiesBody(BaseModel):
    tools: List[IntrinsicPropertyToolBody] = []


@router.get("/proposals")
async def list_proposals(
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    items = librarian_service.list_pending_for_review(user_id=user.id)
    return {"items": items, "total": len(items)}


@router.post("/proposals/{memory_id}/approve")
async def approve_proposal(
    memory_id: str,
    body: ApproveBody = ApproveBody(),
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    try:
        entry = librarian_service.approve(
            user_id=user.id,
            memory_id=memory_id,
            edited_content=body.edited_content,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"approved": True, "entry": entry}


@router.post("/proposals/{memory_id}/reject")
async def reject_proposal(
    memory_id: str,
    body: RejectBody = RejectBody(),
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    try:
        entry = librarian_service.reject(
            user_id=user.id,
            memory_id=memory_id,
            reason=body.reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"rejected": True, "entry": entry}


@router.get("/entries")
async def list_entries(
    scope: Optional[str] = None,
    status: Optional[str] = "active",
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    try:
        items = librarian_service.list_topics(user_id=user.id, scope=scope, status=status)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"items": items, "total": len(items)}


@router.get("/entries/{memory_id}")
async def read_entry(
    memory_id: str,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    try:
        return librarian_service.read(user_id=user.id, memory_id=memory_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/intrinsic-properties")
async def save_intrinsic_properties(
    body: IntrinsicPropertiesBody,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    try:
        tools = [item.model_dump() for item in body.tools]
        return librarian_service.save_intrinsic_properties_overrides(user_id=user.id, tools=tools)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/entries/{memory_id}/archive")
async def archive_entry(
    memory_id: str,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    try:
        entry = librarian_service.archive(user_id=user.id, memory_id=memory_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"archived": True, "entry": entry}

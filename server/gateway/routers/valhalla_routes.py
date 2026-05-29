"""英灵殿（Valhalla）浏览接口。

设计意图：
- 前端 ValhallaPanel 改为读这里的数据，而不再依赖永远为空的
  `lifecycle_status='dead'` 过滤。
- 写入由 chat_worker / chat_scheduler 的副作用钩子自动完成。
"""

from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlmodel import Session

from api.services import valhalla_service
from api.database import get_session
from .auth import get_current_user


PREFIX = "/api/valhalla"
router = APIRouter()


@router.get("/entries")
async def list_valhalla_entries(
    ai_config_id: Optional[int] = None,
    job_id: Optional[str] = None,
    limit: int = 200,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    items = valhalla_service.list_entries(
        user_id=user.id,
        ai_config_id=ai_config_id,
        job_id=job_id,
        limit=limit,
    )
    return {"items": items, "total": len(items)}


@router.get("/entries/{entry_id}")
async def read_valhalla_entry(
    entry_id: int,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    try:
        return valhalla_service.read_entry_file(user_id=user.id, entry_id=entry_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Valhalla entry not found")


@router.delete("/entries")
async def delete_valhalla_entries(
    entry_ids: str,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    ids = []
    for raw in str(entry_ids or "").split(","):
        raw = raw.strip()
        if not raw:
            continue
        try:
            ids.append(int(raw))
        except ValueError:
            raise HTTPException(status_code=400, detail="entry_ids must be comma-separated integers")
    if not ids:
        raise HTTPException(status_code=400, detail="entry_ids is required")
    return valhalla_service.delete_entries(user_id=user.id, entry_ids=ids)

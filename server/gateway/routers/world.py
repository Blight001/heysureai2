"""游戏世界（Agent 进化与实战区域）接口。

只承载**表现层元数据**（皮肤等）；一切业务操作（启停 / 派任务 / 绑定设备 /
知识审批）仍走各自现有路由，世界页只是调用方（设计方案 §0 设计原则①）。
"""

import json
import time

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from api.database import get_session
from api.models import AssistantAIConfig, WorldActorMeta
from .auth import get_current_user


PREFIX = "/api/world"
router = APIRouter()


class ActorMetaUpdate(BaseModel):
    skin: str = ""


@router.get("/actors/meta")
async def list_actor_meta(
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    rows = session.exec(
        select(WorldActorMeta).where(WorldActorMeta.user_id == user.id)
    ).all()
    items = []
    for row in rows:
        try:
            skin = str(json.loads(row.skin_json or "{}").get("skin") or "")
        except (ValueError, TypeError):
            skin = ""
        items.append({"ai_config_id": row.ai_config_id, "skin": skin})
    return {"items": items}


@router.put("/actors/{ai_config_id}/meta")
async def update_actor_meta(
    ai_config_id: int,
    body: ActorMetaUpdate,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    cfg = session.exec(
        select(AssistantAIConfig).where(
            AssistantAIConfig.id == ai_config_id,
            AssistantAIConfig.user_id == user.id,
        )
    ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="AI 成员不存在")
    skin = str(body.skin or "").strip()
    # 皮肤 key 是前端资产文件名；只做基本防注入校验，不维护白名单
    # （资产由前端 manifest 管理，后端不感知具体皮肤列表）。
    if len(skin) > 64 or any(c in skin for c in "/\\<>\"'"):
        raise HTTPException(status_code=400, detail="非法皮肤标识")
    row = session.exec(
        select(WorldActorMeta).where(
            WorldActorMeta.user_id == user.id,
            WorldActorMeta.ai_config_id == ai_config_id,
        )
    ).first()
    if not row:
        row = WorldActorMeta(user_id=user.id, ai_config_id=ai_config_id)
    row.skin_json = json.dumps({"skin": skin}, ensure_ascii=False)
    row.updated_at = time.time()
    session.add(row)
    session.commit()
    return {"ok": True, "ai_config_id": ai_config_id, "skin": skin}

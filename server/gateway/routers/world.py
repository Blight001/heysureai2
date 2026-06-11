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


@router.get("/snapshot")
async def world_snapshot(
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    """世界页首屏聚合：一次请求替代 6 个并行请求。

    复用各域现有 handler / service（不复制投影逻辑）；任何子项失败都
    降级为空值，不让单个域拖垮整个世界页。
    """
    user = get_current_user(authorization, session)

    from api.services import librarian_service, valhalla_service
    from .ai_misc_routes import list_ai_cards
    from .agents import list_connected_agents

    try:
        cards = await list_ai_cards(session=session, authorization=authorization)
    except Exception:
        cards = []
    try:
        connected = await list_connected_agents(session=session, authorization=authorization)
        agents = connected.get("agents", [])
    except Exception:
        agents = []
    try:
        valhalla_items = valhalla_service.list_entries(user_id=user.id, limit=200)
    except Exception:
        valhalla_items = []
    try:
        knowledge_active = len(librarian_service.list_topics(user_id=user.id, status="active"))
    except Exception:
        knowledge_active = 0
    try:
        proposals = librarian_service.list_pending_for_review(user_id=user.id)
    except Exception:
        proposals = []
    meta_rows = session.exec(
        select(WorldActorMeta).where(WorldActorMeta.user_id == user.id)
    ).all()
    actor_meta = []
    for row in meta_rows:
        try:
            skin = str(json.loads(row.skin_json or "{}").get("skin") or "")
        except (ValueError, TypeError):
            skin = ""
        actor_meta.append({"ai_config_id": row.ai_config_id, "skin": skin})

    return {
        "cards": cards,
        "agents": agents,
        "valhalla_items": valhalla_items,
        "knowledge_active": knowledge_active,
        "proposals": proposals,
        "actor_meta": actor_meta,
    }


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

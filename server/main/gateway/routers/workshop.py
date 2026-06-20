"""``/api/workshop`` — 服务端内置图书馆 Agent 的绑定接口。

工坊按账号自动上线（无需用户运行独立程序），本路由只管"哪个 AI 绑定了
工坊"：当前提供传承思想列表、带行号详情、安装、按行编辑和删除 MCP。
工坊与 AI 是 **1:1 绑定**——同一时间只能绑定一个 AI 数字成员，
绑定新成员会替换旧绑定（存 ``WorkshopAiBinding``）。

工具执行不走 REST：调度层（device_dispatch 的 workshop 分支）直接进程内
调用 ``workshop.engine.execute_tool``，其中完成白名单/归属/绑定/角色复核。
"""

from typing import Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from api.database import get_session
from api.models import AssistantAIConfig
from api.workshop_bindings import (
    bound_config_id_for_agent,
    set_workshop_binding,
    workshop_device_ids_for_config,
)
from .auth import get_current_user

# 自动挂载默认前缀 /api → 实际路径 /api/workshop/*
router = APIRouter(prefix="/workshop", tags=["workshop"])


class WorkshopBindRequest(BaseModel):
    ai_config_id: int
    device_id: str
    bound: bool = True


def _load_owned_config(session: Session, user_id: int, ai_config_id) -> AssistantAIConfig:
    if not ai_config_id:
        raise HTTPException(status_code=400, detail="ai_config_id is required")
    cfg = session.exec(
        select(AssistantAIConfig).where(
            AssistantAIConfig.id == int(ai_config_id),
            AssistantAIConfig.user_id == user_id,
        )
    ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="AI config not found")
    return cfg


def _config_name(session: Session, user_id: int, ai_config_id: Optional[int]) -> str:
    if not ai_config_id:
        return ""
    cfg = session.exec(
        select(AssistantAIConfig).where(
            AssistantAIConfig.id == int(ai_config_id),
            AssistantAIConfig.user_id == user_id,
        )
    ).first()
    return str(cfg.name or "").strip() if cfg else f"AI-{ai_config_id}"


@router.get("/bindings")
async def list_workshop_bindings(
    ai_config_id: int,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    """列出该用户的工坊（在线状态 + 当前绑定的成员 + 是否绑定到指定 AI）。

    内置工坊自动上线，所以列表至少包含一条常在线条目。"""
    user = get_current_user(authorization, session)
    cfg = _load_owned_config(session, user.id, ai_config_id)

    from api.device_presence import online_workshop_agents_for_user
    from workshop import engine as workshop_engine

    workshop_engine.ensure_presence_for_user(user.id)
    bound_ids = set(workshop_device_ids_for_config(user.id, cfg.id))
    online = {device_id: caps for device_id, caps in online_workshop_agents_for_user(user.id)}

    names: Dict[str, str] = {
        workshop_engine.device_id_for_user(user.id): workshop_engine.WORKSHOP_DISPLAY_NAME,
    }

    items = []
    for device_id in sorted(set(online) | bound_ids):
        bound_cfg_id = bound_config_id_for_agent(user.id, device_id)
        items.append({
            "device_id": device_id,
            "name": names.get(device_id) or device_id,
            "online": device_id in online,
            "tools": sorted(online.get(device_id) or []),
            "bound": device_id in bound_ids,
            "bound_ai_config_id": bound_cfg_id,
            "bound_ai_name": _config_name(session, user.id, bound_cfg_id),
        })
    return {"ai_config_id": cfg.id, "agents": items}


@router.post("/bindings")
async def update_workshop_binding(
    payload: WorkshopBindRequest,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    cfg = _load_owned_config(session, user.id, payload.ai_config_id)
    device_id = str(payload.device_id or "").strip()
    if not device_id:
        raise HTTPException(status_code=400, detail="device_id is required")
    if bool(payload.bound) and str(cfg.ai_role or "") != "digital_member":
        raise HTTPException(status_code=400, detail="图书馆只能绑定 AI 数字成员")
    # 1:1：绑定会替换该工坊原有的绑定，把被替换的成员返回给前端提示。
    replaced_id = bound_config_id_for_agent(user.id, device_id)
    if replaced_id == int(cfg.id):
        replaced_id = None
    stored = set_workshop_binding(user.id, device_id, cfg.id, bound=bool(payload.bound))
    return {
        "ai_config_id": cfg.id,
        "device_id": device_id,
        "bound": stored,
        "replaced_ai_config_id": replaced_id if bool(payload.bound) else None,
        "replaced_ai_name": _config_name(session, user.id, replaced_id) if bool(payload.bound) else "",
    }

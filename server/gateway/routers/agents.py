from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from api.agent_bindings import set_binding
from api.database import get_session
from api.models import AssistantAIConfig
from .auth import get_current_user
from api.sio import sio, agents, agent_token_required

router = APIRouter()
PREFIX = "/api/agents"


@router.get("/connected")
async def list_connected_agents(
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    # Auth-gate the view; the agent registry itself is process-global.
    get_current_user(authorization, session)
    return {
        "agents": list(agents.values()),
        "count": len(agents),
        "token_required": agent_token_required(),
    }


class AgentBindRequest(BaseModel):
    agentId: str
    # None / 0 unbinds the device (sets it back to "未分配").
    aiConfigId: Optional[int] = None


@router.post("/bind")
async def bind_agent_ai(
    payload: AgentBindRequest,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    """Assign (or clear) the server-side AI for a connected device.

    Devices register without choosing an AI; the operator picks one here. The
    binding is persisted (keyed by agent id) so it survives reconnects, and any
    currently-connected socket for that agent is updated immediately.
    """
    user = get_current_user(authorization, session)
    agent_id = (payload.agentId or "").strip()
    if not agent_id:
        raise HTTPException(status_code=400, detail="agentId required")

    cfg_id = payload.aiConfigId
    if cfg_id:
        cfg = session.exec(
            select(AssistantAIConfig).where(AssistantAIConfig.id == int(cfg_id))
        ).first()
        if not cfg or cfg.user_id != user.id:
            raise HTTPException(status_code=404, detail="AI 配置不存在或不属于当前用户")

    stored = set_binding(user.id, agent_id, cfg_id)

    # Reflect the assignment on any live socket(s) for this agent right away so
    # the next dispatch routes correctly without waiting for a reconnect.
    for agent in agents.values():
        if str(agent.get("id")) == agent_id and agent.get("userId") == user.id:
            agent["aiConfigId"] = stored

    await sio.emit("agent:list", list(agents.values()))
    return {"ok": True, "agentId": agent_id, "aiConfigId": stored}

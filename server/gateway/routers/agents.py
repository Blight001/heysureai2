from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from api.agent_bindings import set_binding
from api.agent_mcp_permissions import get_scope, set_scope
from api.database import get_session
from api.models import AssistantAIConfig
from .auth import get_current_user
from api.sio import sio, agents, agent_token_required
from connector_runtime.dispatch.desktop_agent_tools import agent_endpoint_tools, agent_type_of

router = APIRouter()
PREFIX = "/api/agents"


def _find_connected_agent(agent_id: str, user_id: int) -> Optional[dict]:
    """The live agent record for this (agent_id, user), or None when the device
    is not currently connected. Scope is only visible while connected — a
    disconnected agent is simply not shown."""
    aid = str(agent_id or "").strip()
    for agent in agents.values():
        if str(agent.get("id") or "") == aid and agent.get("userId") == user_id:
            return agent
    return None


def _scope_view(agent: dict, user_id: int) -> dict:
    """Capabilities + effective allow-list for a connected agent. With no saved
    record every reported tool is allowed (default-open)."""
    agent_type = agent_type_of(agent)
    capabilities = sorted(agent_endpoint_tools(agent))
    ai_config_id = agent.get("aiConfigId") or agent.get("ai_config_id")
    try:
        ai_config_id = int(ai_config_id) if ai_config_id else None
    except (TypeError, ValueError):
        ai_config_id = None
    scope = get_scope(user_id, ai_config_id, agent_type) if ai_config_id else None
    allowed = capabilities if scope is None else sorted(set(capabilities) & scope)
    return {
        "agentId": str(agent.get("id") or ""),
        "agentName": str(agent.get("name") or agent.get("id") or ""),
        "agentType": agent_type,
        "platform": str(agent.get("platform") or ""),
        "aiConfigId": ai_config_id,
        "capabilities": capabilities,
        "allowed": allowed,
        "hasRecord": scope is not None,
    }


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

    # Keep the shared DB presence snapshot in sync so off-gateway processes
    # resolve endpoint tools against the new assignment immediately.
    try:
        from api.agent_presence import update_binding
        update_binding(agent_id, stored)
    except Exception:
        pass

    await sio.emit("agent:list", list(agents.values()))
    return {"ok": True, "agentId": agent_id, "aiConfigId": stored}


@router.get("/{agent_id}/mcp-scope")
async def get_agent_mcp_scope(
    agent_id: str,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    """Endpoint MCP permission scope for one connected agent.

    Returns the tools it advertises plus the currently-allowed subset. 404 when
    the device is offline (an unbound agent still resolves, with aiConfigId
    null and every tool allowed — it just can't be persisted until assigned)."""
    user = get_current_user(authorization, session)
    agent = _find_connected_agent(agent_id, user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="设备未连接")
    if not agent_type_of(agent):
        raise HTTPException(status_code=400, detail="该设备不是软件端 / 浏览器端 Agent")
    return _scope_view(agent, user.id)


class AgentMcpScopeRequest(BaseModel):
    tools: List[str] = []


@router.put("/{agent_id}/mcp-scope")
async def set_agent_mcp_scope(
    agent_id: str,
    payload: AgentMcpScopeRequest,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    """Persist the endpoint MCP permission scope for a connected agent, keyed by
    (user, assigned AI, agent type). Unknown tool names are dropped; the scope
    is restored automatically when an agent of the same type reconnects."""
    user = get_current_user(authorization, session)
    agent = _find_connected_agent(agent_id, user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="设备未连接")
    agent_type = agent_type_of(agent)
    if not agent_type:
        raise HTTPException(status_code=400, detail="该设备不是软件端 / 浏览器端 Agent")

    ai_config_id = agent.get("aiConfigId") or agent.get("ai_config_id")
    try:
        ai_config_id = int(ai_config_id) if ai_config_id else None
    except (TypeError, ValueError):
        ai_config_id = None
    if not ai_config_id:
        raise HTTPException(status_code=400, detail="请先在作坊为该设备分配 AI，再配置 MCP 权限")

    cfg = session.exec(
        select(AssistantAIConfig).where(AssistantAIConfig.id == ai_config_id)
    ).first()
    if not cfg or cfg.user_id != user.id:
        raise HTTPException(status_code=404, detail="AI 配置不存在或不属于当前用户")

    # Only persist tools the agent actually reports — never let stale UI state
    # widen the scope beyond the live capability set.
    capabilities = agent_endpoint_tools(agent)
    requested = {str(t).strip() for t in (payload.tools or []) if str(t).strip()}
    set_scope(user.id, ai_config_id, agent_type, requested & capabilities)

    await sio.emit("agent:list", list(agents.values()))
    return _scope_view(agent, user.id)

"""``/api/agents`` routes: list connected endpoint agents, bind an agent to an AI
config, and get/set an agent's per-device MCP tool scope."""

from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from api.agent_bindings import set_binding
from api.agent_mcp_permissions import get_scope, set_scope
from api.database import get_session
from api.models import AgentAiBinding, AssistantAIConfig, EndpointAgentPresence
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


def _presence_agent_type(session: Session, user_id: int, agent_id: str) -> Optional[str]:
    aid = str(agent_id or "").strip()
    if not aid:
        return None
    row = session.exec(
        select(EndpointAgentPresence)
        .where(
            EndpointAgentPresence.agent_id == aid,
            EndpointAgentPresence.user_id == user_id,
        )
        .order_by(EndpointAgentPresence.updated_at.desc(), EndpointAgentPresence.id.desc())
    ).first()
    agent_type = str(row.agent_type or "").strip() if row else ""
    return agent_type if agent_type in {"desktop", "browser"} else None


def _agent_type_for_binding(session: Session, user_id: int, agent_id: str) -> Optional[str]:
    connected = _find_connected_agent(agent_id, user_id)
    live_type = agent_type_of(connected)
    if live_type:
        return live_type
    return _presence_agent_type(session, user_id, agent_id)


def _existing_same_type_binding(
    session: Session,
    *,
    user_id: int,
    ai_config_id: int,
    agent_id: str,
    agent_type: str,
) -> Optional[str]:
    """Return another bound agent id for this AI/type, if one exists."""
    target_id = str(agent_id or "").strip()
    rows = session.exec(
        select(AgentAiBinding).where(
            AgentAiBinding.user_id == user_id,
            AgentAiBinding.ai_config_id == ai_config_id,
        )
    ).all()
    for row in rows:
        existing_id = str(row.agent_id or "").strip()
        if not existing_id or existing_id == target_id:
            continue
        if _agent_type_for_binding(session, user_id, existing_id) == agent_type:
            return existing_id
    return None


def _scope_view(agent: dict, user_id: int) -> dict:
    """Capabilities + effective allow-list for a connected agent. Scope is keyed
    per individual agent; with no saved record no endpoint tool is allowed
    (default-closed)."""
    agent_type = agent_type_of(agent)
    agent_id = str(agent.get("id") or "")
    capabilities = sorted(agent_endpoint_tools(agent))
    ai_config_id = agent.get("aiConfigId") or agent.get("ai_config_id")
    try:
        ai_config_id = int(ai_config_id) if ai_config_id else None
    except (TypeError, ValueError):
        ai_config_id = None
    scope = get_scope(user_id, agent_id) if agent_id else None
    allowed = [] if scope is None else sorted(set(capabilities) & scope)
    return {
        "agentId": agent_id,
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
    previous_same_type_agent_id = None
    if cfg_id:
        cfg_id = int(cfg_id)
        cfg = session.exec(
            select(AssistantAIConfig).where(AssistantAIConfig.id == cfg_id)
        ).first()
        if not cfg or cfg.user_id != user.id:
            raise HTTPException(status_code=404, detail="AI 配置不存在或不属于当前用户")
        agent_type = _agent_type_for_binding(session, user.id, agent_id)
        if agent_type:
            existing_agent_id = _existing_same_type_binding(
                session,
                user_id=user.id,
                ai_config_id=cfg_id,
                agent_id=agent_id,
                agent_type=agent_type,
            )
            if existing_agent_id:
                previous_same_type_agent_id = existing_agent_id

    stored = set_binding(user.id, agent_id, cfg_id)
    if previous_same_type_agent_id:
        set_binding(user.id, previous_same_type_agent_id, None)

    # Reflect the assignment on any live socket(s) for this agent right away so
    # the next dispatch routes correctly without waiting for a reconnect.
    for agent in agents.values():
        if str(agent.get("id")) == agent_id and agent.get("userId") == user.id:
            agent["aiConfigId"] = stored
        elif (
            previous_same_type_agent_id
            and str(agent.get("id")) == previous_same_type_agent_id
            and agent.get("userId") == user.id
        ):
            agent["aiConfigId"] = None

    # Keep the shared DB presence snapshot in sync so off-gateway processes
    # resolve endpoint tools against the new assignment immediately.
    try:
        from api.agent_presence import update_binding
        update_binding(agent_id, stored)
        if previous_same_type_agent_id:
            update_binding(previous_same_type_agent_id, None)
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
    """Persist the endpoint MCP permission scope for a connected agent, keyed per
    individual agent (user, agent_id). Unknown tool names are dropped; the scope
    follows the physical device across reconnects and AI reassignment."""
    user = get_current_user(authorization, session)
    agent = _find_connected_agent(agent_id, user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="设备未连接")
    agent_type = agent_type_of(agent)
    if not agent_type:
        raise HTTPException(status_code=400, detail="该设备不是端点 Agent")

    ai_config_id = agent.get("aiConfigId") or agent.get("ai_config_id")
    try:
        ai_config_id = int(ai_config_id) if ai_config_id else None
    except (TypeError, ValueError):
        ai_config_id = None
    # The bound AI is recorded for reference only; scope is keyed by the agent.
    if ai_config_id:
        cfg = session.exec(
            select(AssistantAIConfig).where(AssistantAIConfig.id == ai_config_id)
        ).first()
        if not cfg or cfg.user_id != user.id:
            raise HTTPException(status_code=404, detail="AI 配置不存在或不属于当前用户")

    # Only persist tools the agent actually reports — never let stale UI state
    # widen the scope beyond the live capability set.
    capabilities = agent_endpoint_tools(agent)
    requested = {str(t).strip() for t in (payload.tools or []) if str(t).strip()}
    set_scope(user.id, agent_id, requested & capabilities, ai_config_id=ai_config_id, agent_type=agent_type)

    await sio.emit("agent:list", list(agents.values()))
    return _scope_view(agent, user.id)

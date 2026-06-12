"""``/api/workshop`` — 知识与进化工坊（agent/workshop/）的服务端配套接口。

两组端点：
- ``POST /api/workshop/execute``   工坊 agent 收到 task:dispatch 后回调执行。
  知识/进化的数据真相源（DB / KnowledgeBase 文件）始终留在服务端，工坊
  agent 只是"门面"：负责注册工具、注入方向策略，然后回调这里落库。
- ``GET/POST /api/workshop/bindings``  前端为某个 AI 绑定/解绑工坊 agent。
  绑定是 AI 调用 librarian.* / evolution.* 的唯一门槛。

安全边界：工坊 agent 持用户 token 连接，但服务端不信任其声明——这里会
重新校验 ai_config 归属、工具白名单、角色最低权限与绑定关系。
"""

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from api.database import get_session
from api.models import AssistantAIConfig
from api.workshop_bindings import (
    bound_config_ids_for_agent,
    set_workshop_binding,
    workshop_agent_ids_for_config,
)
from .auth import get_current_user

# 自动挂载默认前缀 /api → 实际路径 /api/workshop/*
router = APIRouter(prefix="/workshop", tags=["workshop"])

# 工坊可执行的工具白名单：与 agent/workshop/tools.py 的注册清单对应。
# handler 实现仍在 mcp_runtime（服务端真相源），此处只做受控转发。
_WORKSHOP_TOOL_HANDLERS = {
    "librarian.propose": ("mcp_runtime.mcp.tools.librarian", "_librarian_propose"),
    "librarian.consult": ("mcp_runtime.mcp.tools.librarian", "_librarian_consult"),
    "librarian.list_topics": ("mcp_runtime.mcp.tools.librarian", "_librarian_list_topics"),
    "librarian.read": ("mcp_runtime.mcp.tools.librarian", "_librarian_read"),
    "librarian.archive": ("mcp_runtime.mcp.tools.librarian", "_librarian_archive"),
    "evolution.input": ("mcp_runtime.mcp.tools.evolution", "_evolution_input"),
    "evolution.list": ("mcp_runtime.mcp.tools.evolution", "_evolution_list"),
    "evolution.review": ("mcp_runtime.mcp.tools.evolution", "_evolution_review"),
}


class WorkshopExecuteRequest(BaseModel):
    tool: str
    args: Dict[str, Any] = {}
    ai_config_id: Optional[int] = None


class WorkshopBindRequest(BaseModel):
    ai_config_id: int
    agent_id: str
    bound: bool = True


def _load_owned_config(session: Session, user_id: int, ai_config_id: Optional[int]) -> AssistantAIConfig:
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


@router.post("/execute")
async def workshop_execute(
    payload: WorkshopExecuteRequest,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    tool = str(payload.tool or "").strip()
    spec = _WORKSHOP_TOOL_HANDLERS.get(tool)
    if spec is None:
        raise HTTPException(status_code=400, detail=f"'{tool}' is not a workshop tool")

    cfg = _load_owned_config(session, user.id, payload.ai_config_id)

    # 绑定是工坊工具的唯一门槛：未绑定任何工坊 agent 的 AI 一律拒绝，
    # 即使请求方持有合法用户 token（防止绕过工坊通道直接调用）。
    if not workshop_agent_ids_for_config(user.id, cfg.id):
        raise HTTPException(
            status_code=403,
            detail=f"AI config {cfg.id} 未绑定知识工坊 agent，无法调用 {tool}",
        )

    # 角色最低权限复核（服务端为准，不信任 agent 侧声明）。
    from mcp_runtime.mcp.permissions import ROLE_RANK, config_role_tier, tool_min_role

    tier = config_role_tier(cfg)
    if ROLE_RANK.get(tier, 0) < ROLE_RANK.get(tool_min_role(tool), 0):
        raise HTTPException(status_code=403, detail=f"角色 {tier} 无权调用 {tool}")

    import importlib

    module_name, func_name = spec
    handler = getattr(importlib.import_module(module_name), func_name)
    result = handler(user.id, dict(payload.args or {}), int(cfg.id))
    return {"tool": tool, "result": result}


@router.get("/bindings")
async def list_workshop_bindings(
    ai_config_id: int,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    """列出该用户的工坊 agent（在线状态 + 是否已绑定到指定 AI）。"""
    user = get_current_user(authorization, session)
    cfg = _load_owned_config(session, user.id, ai_config_id)

    from api.agent_presence import online_workshop_agents_for_user
    from api.sio import agents as live_agents

    bound_ids = set(workshop_agent_ids_for_config(user.id, cfg.id))
    online = {agent_id: caps for agent_id, caps in online_workshop_agents_for_user(user.id)}

    # 名称只在持有 socket 的进程内存里有；拿不到时回退 agent_id。
    names: Dict[str, str] = {}
    for agent in live_agents.values():
        if isinstance(agent, dict) and str(agent.get("platform") or "").lower().find("workshop") >= 0:
            names[str(agent.get("id") or "")] = str(agent.get("name") or "")

    items = []
    for agent_id in sorted(set(online) | bound_ids):
        items.append({
            "agent_id": agent_id,
            "name": names.get(agent_id) or agent_id,
            "online": agent_id in online,
            "tools": sorted(online.get(agent_id) or []),
            "bound": agent_id in bound_ids,
            "bound_ai_count": len(bound_config_ids_for_agent(user.id, agent_id)),
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
    agent_id = str(payload.agent_id or "").strip()
    if not agent_id:
        raise HTTPException(status_code=400, detail="agent_id is required")
    stored = set_workshop_binding(user.id, agent_id, cfg.id, bound=bool(payload.bound))
    return {"ai_config_id": cfg.id, "agent_id": agent_id, "bound": stored}

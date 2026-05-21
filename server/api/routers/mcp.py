import json
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from api.database import get_session
from api.mcp import registry
from api.models import AssistantAIConfig
from api.routers.auth import get_current_user
from api.task_system import with_task_create_compat, with_workspace_read_by_name_compat

router = APIRouter()
PREFIX = "/api/mcp"


class MCPCallRequest(BaseModel):
    tool: str = Field(..., description="Fully qualified MCP tool name")
    arguments: Optional[Dict[str, Any]] = Field(default_factory=dict)
    ai_config_id: Optional[int] = None


@router.get("/tools")
async def list_mcp_tools(
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    return {"tools": registry.list_tools(), "userId": user.id}


@router.post("/call")
async def call_mcp_tool(
    req: MCPCallRequest,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    if req.ai_config_id is not None:
        cfg = session.exec(
            select(AssistantAIConfig).where(
                AssistantAIConfig.id == req.ai_config_id,
                AssistantAIConfig.user_id == user.id,
            )
        ).first()
        if not cfg:
            raise HTTPException(status_code=404, detail="AI config not found")
        if not cfg.enabled:
            raise HTTPException(status_code=400, detail="AI is stopped")
        if not cfg.mcp_enabled:
            raise HTTPException(status_code=400, detail="MCP is disabled for this AI")
        try:
            parsed_allowed = json.loads(cfg.mcp_tools or "[]")
            if not isinstance(parsed_allowed, list):
                raise ValueError("mcp_tools must be a JSON array")
            allowed_tools = {str(item).strip() for item in parsed_allowed if isinstance(item, str) and str(item).strip()}
            allowed_tools = with_task_create_compat(allowed_tools)
            allowed_tools = with_workspace_read_by_name_compat(allowed_tools)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid AI MCP tool config")
        if req.tool not in allowed_tools:
            raise HTTPException(status_code=403, detail=f"Tool not allowed for this AI: {req.tool}")

    return await registry.call(req.tool, user.id, req.arguments, req.ai_config_id)

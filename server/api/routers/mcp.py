import json
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from api.database import get_session
from api.mcp import registry
from api.mcp.core import MCP_INTROSPECTION_TOOLS
from api.mcp.permissions import (
    CONFIGURABLE_ROLES,
    ROLE_LABELS_ZH,
    config_role_tier,
    default_role_permissions,
    effective_allowed_for_config,
    parse_role_permissions,
    role_tool_options,
    tool_min_role,
)
from api.models import AssistantAIConfig
from api.routers.auth import get_current_user
from api.services.agent_dispatch import dispatch_endpoint_tool_and_wait
from api.services.desktop_agent_tools import endpoint_bridge_tools_for_config, is_endpoint_agent_tool
from api.services.librarian_service import intrinsic_input_schema, intrinsic_tool_description
from api.services.task_system import with_workspace_read_by_name_compat

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
    tools = registry.list_tools()
    for tool in tools:
        name = str(tool.get("name") or "")
        tool["minRole"] = tool_min_role(name)
        tool["description"] = intrinsic_tool_description(user.id, name, str(tool.get("description") or ""))
        tool["inputSchema"] = intrinsic_input_schema(
            user.id,
            name,
            tool.get("inputSchema") if isinstance(tool.get("inputSchema"), dict) else {},
        )
    tool_names = {str(tool.get("name") or "") for tool in tools}
    return {
        "tools": tools,
        "userId": user.id,
        "roleOrder": CONFIGURABLE_ROLES,
        "roleLabels": ROLE_LABELS_ZH,
        # Per-role defaults for checked state and reset-to-default.
        "roleDefaults": default_role_permissions(tool_names),
        # Per-role visible/configurable options. This may include tools that are
        # not checked by default.
        "roleOptions": role_tool_options(tool_names),
        # The admin's currently configured per-role allow-list (may be empty,
        # meaning "use defaults").
        "rolePermissions": parse_role_permissions(user),
    }


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
            allowed_tools = with_workspace_read_by_name_compat(allowed_tools)
            allowed_tools.update(MCP_INTROSPECTION_TOOLS)
            allowed_tools.update(endpoint_bridge_tools_for_config(req.ai_config_id, user.id))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid AI MCP tool config")
        if req.tool not in allowed_tools:
            raise HTTPException(status_code=403, detail=f"Tool not allowed for this AI: {req.tool}")
        # Enforce the role ceiling: known registry tools must be within the set
        # permitted for this AI's role tier, regardless of its saved allow-list.
        role_allowed = effective_allowed_for_config(user, cfg)
        bridge_tools = endpoint_bridge_tools_for_config(req.ai_config_id, user.id)
        if registry.has(req.tool) and req.tool not in role_allowed and req.tool not in bridge_tools:
            raise HTTPException(
                status_code=403,
                detail=f"Tool not permitted for role {config_role_tier(cfg)}: {req.tool}",
            )

    if is_endpoint_agent_tool(req.tool):
        return {
            "tool": req.tool,
            "destructive": True,
            "result": await dispatch_endpoint_tool_and_wait(
                user_id=user.id,
                ai_config_id=req.ai_config_id,
                tool=req.tool,
                args=req.arguments or {},
            ),
        }

    return await registry.call(req.tool, user.id, req.arguments, req.ai_config_id)

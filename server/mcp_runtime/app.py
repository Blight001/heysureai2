"""``mcp-runtime`` FastAPI app — wraps the MCP registry over HTTP.

Endpoints (all under ``/internal``, gated by ``INTERNAL_TOKEN`` Bearer):
- ``GET  /internal/health``
- ``GET  /internal/mcp/tools``  — raw registry catalog + version
- ``POST /internal/mcp/call``   — invoke a tool by name (body carries user_id, ai_config_id, arguments)
- ``POST /internal/mcp/reload`` — hot-reload tool modules + plugins

Auth/permission filtering belongs to the api-gateway side. This service
trusts its callers — they must already be authenticated by their own
ingress layer.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from api.database import create_db_and_tables
from api.mcp import registry
from api.mcp.loader import load_plugins_on_startup, reload_registry
from api.runtime.internal_http import require_internal_token


class CallRequest(BaseModel):
    tool: str = Field(..., description="MCP tool name (e.g. workspace.read_file)")
    user_id: int = Field(..., description="Acting user id; tools scope file/DB access to this user")
    ai_config_id: Optional[int] = None
    arguments: Optional[Dict[str, Any]] = Field(default_factory=dict)


def _tool_catalog() -> Dict[str, Any]:
    return {
        "version": registry.version,
        "tools": registry.list_tools(),
    }


@asynccontextmanager
async def _lifespan(app: FastAPI):
    create_db_and_tables()
    boot = load_plugins_on_startup()
    if boot.get("plugin_errors"):
        for entry in boot["plugin_errors"]:
            print(f"[mcp-runtime] plugin load failed: {entry.get('plugin')} -> {entry.get('error')}")
    print(
        f"[mcp-runtime] ready: {boot.get('tools', 0)} tools (version {boot.get('version', 1)})"
    )
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="HeySure MCP Runtime", lifespan=_lifespan)
    router = APIRouter(prefix="/internal", dependencies=[Depends(require_internal_token)])

    @router.get("/health")
    def health() -> Dict[str, Any]:
        return {"ok": True, "tools": len(registry._tools), "version": registry.version}

    @router.get("/mcp/tools")
    def list_tools() -> Dict[str, Any]:
        return _tool_catalog()

    @router.post("/mcp/call")
    async def call_tool(req: CallRequest) -> Dict[str, Any]:
        if not registry.has(req.tool):
            raise HTTPException(status_code=404, detail=f"Unknown tool: {req.tool}")
        return await registry.call(
            req.tool,
            req.user_id,
            req.arguments or {},
            req.ai_config_id,
        )

    @router.post("/mcp/reload")
    def reload_tools() -> Dict[str, Any]:
        result = reload_registry()
        if not result.get("ok"):
            # 503 so callers know the reload itself failed but the live
            # registry remains intact and usable.
            raise HTTPException(status_code=503, detail=result)
        return result

    app.include_router(router)
    return app

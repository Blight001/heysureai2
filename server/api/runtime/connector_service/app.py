"""``connector-runtime`` FastAPI + Socket.IO app.

Hosts:
- Socket.IO ``/agent`` namespace (and the default ``/`` namespace as a
  compatibility shim) where desktop / browser agents register and stream
  task results.
- HTTP ``/internal/agent/dispatch``: synchronous wrapper around
  :func:`api.services.agent_dispatch.dispatch_endpoint_tool_and_wait` so
  ai-runtime can fire a tool dispatch over HTTP and wait for the agent's
  reply within the same process that holds the Socket.IO session.
- HTTP ``/internal/feishu/send``: outbound Feishu helper for ai-runtime.
- HTTP ``/internal/health``.

Both the Socket.IO server and the HTTP routes share the same ASGI app —
they bind to a single external port (default 3002). ``/internal/*`` is
gated by ``INTERNAL_TOKEN``; the Socket.IO routes use the same per-agent
JWT auth as the monolith.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, Dict, Optional

import socketio
from fastapi import APIRouter, Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from ...database import create_db_and_tables
from ...sio import sio
from ...socket_events import register_socket_events
from ..internal_http import require_internal_token


class AgentDispatchRequest(BaseModel):
    user_id: int
    ai_config_id: Optional[int] = None
    tool: str
    arguments: Dict[str, Any] = Field(default_factory=dict)
    timeout_seconds: int = 120


class FeishuSendRequest(BaseModel):
    user_id: int
    ai_config_id: Optional[int] = None
    text: str
    receive_id: Optional[str] = None
    receive_id_type: Optional[str] = None


@asynccontextmanager
async def _lifespan(app: FastAPI):
    create_db_and_tables()
    # Register Socket.IO handlers on the local server. agent:register /
    # task:result / etc. are wired here so agents that connect on the
    # connector-runtime port get the same behavior as the monolith.
    register_socket_events()
    print("[connector-runtime] ready (Socket.IO + /internal/*)")
    yield


def create_app() -> FastAPI:
    fastapi_app = FastAPI(title="HeySure Connector Runtime", lifespan=_lifespan)

    router = APIRouter(prefix="/internal", dependencies=[Depends(require_internal_token)])

    @router.get("/health")
    def health() -> Dict[str, Any]:
        from ...sio import agents
        return {"ok": True, "agents": len(agents)}

    @router.post("/agent/dispatch")
    async def agent_dispatch(req: AgentDispatchRequest) -> Dict[str, Any]:
        # Lazy import keeps connector_service importable even when the
        # full chat/agent pipeline is not loaded (e.g. minimal smoke tests).
        from ...services.agent_dispatch import dispatch_endpoint_tool_and_wait
        try:
            result = await dispatch_endpoint_tool_and_wait(
                user_id=req.user_id,
                ai_config_id=req.ai_config_id,
                tool=req.tool,
                args=req.arguments,
                timeout_seconds=req.timeout_seconds,
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"dispatch failed: {exc}")
        return {"ok": True, "result": result}

    @router.post("/feishu/send")
    def feishu_send(req: FeishuSendRequest) -> Dict[str, Any]:
        # Imported lazily — pulls in lark-oapi which we don't want loaded
        # for processes that never send outbound Feishu traffic.
        from ...integrations.feishu.service import send_feishu_text_message
        try:
            result = send_feishu_text_message(
                user_id=req.user_id,
                ai_config_id=req.ai_config_id,
                text=req.text,
                receive_id=req.receive_id or "",
                receive_id_type=req.receive_id_type or "",
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"feishu send failed: {exc}")
        return {"ok": True, "result": result}

    fastapi_app.include_router(router)

    # Combine FastAPI + Socket.IO on one ASGI app so they share a single
    # external port. ``sio`` is the real Socket.IO server because this
    # process runs with HEYSURE_SERVICE_ROLE=connector (see api.sio).
    return socketio.ASGIApp(sio, other_asgi_app=fastapi_app)

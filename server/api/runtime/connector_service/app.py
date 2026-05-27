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

import asyncio
from contextlib import asynccontextmanager, suppress
from typing import Any, Dict, Optional

import socketio
from fastapi import APIRouter, Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from ...database import create_db_and_tables
from ...integrations.feishu.long_connection import start_feishu_long_connection_clients
from ...sio import sio
from ...socket_events import register_agent_socket_events
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
    # Register Socket.IO handlers on the local server. Only agent-side
    # events live here; user-side (ui:join) stays on api-gateway.
    register_agent_socket_events()

    # Reap any dispatch rows whose original Future died with a previous
    # connector-runtime process. The poller would otherwise wait forever.
    from ...services.agent_dispatch import expire_orphan_dispatches
    try:
        expired = expire_orphan_dispatches()
        if expired:
            print(f"[connector-runtime] expired {expired} orphan dispatch rows")
    except Exception as exc:
        print(f"[connector-runtime] orphan sweep failed: {exc}")

    # Maintain Feishu long connections from this process. Owning the
    # upstream here means api-gateway restarts no longer drop Feishu.
    stop_event = asyncio.Event()

    async def _feishu_keepalive() -> None:
        while not stop_event.is_set():
            try:
                start_feishu_long_connection_clients()
            except Exception as exc:
                print(f"[connector-runtime] feishu keepalive failed: {exc}")
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=3.0)
            except asyncio.TimeoutError:
                continue

    async def _orphan_sweeper() -> None:
        # Periodic sweep — startup pass alone isn't enough for a process
        # that runs for days without a restart.
        while not stop_event.is_set():
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=60.0)
                return  # stop_event set
            except asyncio.TimeoutError:
                pass
            try:
                expired_now = expire_orphan_dispatches()
                if expired_now:
                    print(f"[connector-runtime] expired {expired_now} orphan dispatch rows")
            except Exception as exc:
                print(f"[connector-runtime] periodic orphan sweep failed: {exc}")

    keepalive_task = asyncio.create_task(_feishu_keepalive())
    sweep_task = asyncio.create_task(_orphan_sweeper())
    print("[connector-runtime] ready (Socket.IO + /internal/* + feishu keepalive)")
    try:
        yield
    finally:
        stop_event.set()
        for task in (keepalive_task, sweep_task):
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


def create_app() -> FastAPI:
    fastapi_app = FastAPI(title="HeySure Connector Runtime", lifespan=_lifespan)

    router = APIRouter(prefix="/internal", dependencies=[Depends(require_internal_token)])

    @router.get("/health")
    def health() -> Dict[str, Any]:
        from ...sio import agents
        return {"ok": True, "agents": len(agents)}

    @router.post("/agent/dispatch")
    async def agent_dispatch(req: AgentDispatchRequest) -> Dict[str, Any]:
        # Non-blocking: emit task:dispatch to the agent + persist a pending
        # row. The caller polls /agent/dispatch/result/{task_id} for the
        # outcome so connector-runtime restarts don't strand the request.
        from ...services.agent_dispatch import dispatch_endpoint_tool
        try:
            task_id = await dispatch_endpoint_tool(
                user_id=req.user_id,
                ai_config_id=req.ai_config_id,
                tool=req.tool,
                args=req.arguments,
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"dispatch failed: {exc}")
        if not task_id:
            raise HTTPException(status_code=503, detail="no agent connected for this tool")
        return {"ok": True, "task_id": task_id, "status": "pending"}

    @router.get("/agent/dispatch/result/{task_id}")
    def agent_dispatch_result(task_id: str) -> Dict[str, Any]:
        # DB-backed lookup so connector-runtime restarts don't lose state.
        from sqlmodel import Session, select
        from ...database import engine
        from ...models import AgentDispatchTask
        with Session(engine) as session:
            row = session.exec(
                select(AgentDispatchTask).where(AgentDispatchTask.task_id == task_id)
            ).first()
        if not row:
            raise HTTPException(status_code=404, detail="task not found")
        payload: Dict[str, Any] = {
            "task_id": row.task_id,
            "status": row.status,
            "success": row.success,
            "summary": row.summary,
            "error": row.error,
            "result": None,
            "agent_id": row.agent_id,
            "tool": row.tool,
        }
        if row.result_json:
            import json as _json
            try:
                payload["result"] = _json.loads(row.result_json)
            except Exception:
                payload["result"] = row.result_json
        return payload

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

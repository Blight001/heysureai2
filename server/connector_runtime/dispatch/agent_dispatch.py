"""
OPT-03: Desktop Agent task dispatch + result handling.

Bridges the server task system and connected desktop agents over Socket.IO.

Socket protocol:
    agent:register   agent → server   { id, name, platform, capabilities[], version }
    task:dispatch    server → agent   { taskId, userId, aiConfigId, sessionId,
                                         instruction, tool, args, allowedTools[] }
    task:progress    agent → server   { taskId, agentId, message }
    task:result      agent → server   { taskId, agentId, success, tool, result, summary }
    task:error       agent → server   { taskId, agentId, error }

Results are persisted into the originating chat session and broadcast to the
user's UI room so the frontend updates live.
"""

import contextvars
import asyncio
import json
import logging
import time
import uuid
from typing import Any, Dict, List, Optional

from sqlmodel import Session, select

from api.database import engine
from connector_runtime.dispatch.desktop_agent_tools import (
    get_connected_browser_agent,
    get_connected_desktop_agent,
    is_browser_tool,
    is_desktop_tool,
    is_endpoint_agent_tool,
)
from api.services.screenshot_store import attach_persisted_screenshot
from api.models import AgentDispatchTask, ChatMessageCreate
from api.sio import agents, sio
from api.services.chat_persistence import _save_message


logger = logging.getLogger(__name__)


def _persist_dispatch(
    *,
    task_id: str,
    user_id: int,
    ai_config_id: Optional[int],
    ai_kind: str,
    session_id: str,
    session_name: Optional[str],
    agent_id: str,
    tool: str,
    instruction: str,
) -> None:
    """Insert a ``pending`` row so connector-runtime restarts can still
    deliver the eventual result to whoever is polling by ``task_id``."""
    try:
        with Session(engine) as session:
            session.add(AgentDispatchTask(
                task_id=task_id,
                user_id=user_id,
                ai_config_id=ai_config_id,
                ai_kind=ai_kind or "assistant",
                session_id=session_id,
                session_name=session_name,
                agent_id=agent_id,
                tool=tool or "",
                instruction=instruction or "",
                status="pending",
            ))
            session.commit()
    except Exception as exc:
        # Persistence failure is non-fatal for the in-memory dispatch path,
        # but it does defeat the restart-resilience guarantee. Log loudly.
        logger.exception(f"persist failed task={task_id}: {exc}")


def _finalize_dispatch_row(
    task_id: str,
    *,
    status: str,
    success: Optional[bool] = None,
    summary: Optional[str] = None,
    result: Any = None,
    error: Optional[str] = None,
) -> None:
    """Mark a dispatch row finished.

    Idempotent for rows that already terminated as ``completed`` or ``error``
    (real result of an agent reply). Allows overwriting a ``timeout`` row —
    if the agent eventually replies after the orphan sweep marked it timed
    out, we preserve the actual result for audit even though the chat_worker
    has already moved on.
    """
    try:
        with Session(engine) as session:
            row = session.exec(
                select(AgentDispatchTask).where(AgentDispatchTask.task_id == task_id)
            ).first()
            if not row:
                return
            if row.status in {"completed", "error"}:
                return  # Real outcome already recorded; don't overwrite.
            row.status = status
            row.success = success
            row.summary = summary
            if result is not None:
                try:
                    row.result_json = json.dumps(result, ensure_ascii=False, default=str)
                except Exception:
                    row.result_json = str(result)
            row.error = error
            row.completed_at = time.time()
            session.add(row)
            session.commit()
    except Exception as exc:
        logger.exception(f"finalize failed task={task_id}: {exc}")


def expire_orphan_dispatches(older_than_seconds: float = 300.0) -> int:
    """Mark pending rows that have been waiting too long as ``timeout``.

    Called on connector-runtime startup to clean up rows whose original
    Future died with a previous process — pollers were stuck looking at
    them.
    """
    cutoff = time.time() - older_than_seconds
    expired = 0
    try:
        with Session(engine) as session:
            rows = session.exec(
                select(AgentDispatchTask).where(AgentDispatchTask.status == "pending")
            ).all()
            for row in rows:
                if (row.created_at or 0) < cutoff:
                    row.status = "timeout"
                    row.error = row.error or "orphaned across connector-runtime restart"
                    row.completed_at = time.time()
                    session.add(row)
                    expired += 1
            if expired:
                session.commit()
    except Exception as exc:
        logger.exception(f"orphan sweep failed: {exc}")
    return expired

# Per-run session context so MCP tools (running inside the worker thread) can
# attach dispatched-task results to the correct chat session. asyncio.run()
# copies the current context, so a value set before the tool call is visible
# inside the (async) MCP handler.
_RUN_SESSION_CONTEXT: contextvars.ContextVar[Optional[Dict[str, Any]]] = contextvars.ContextVar(
    "run_session_context",
    default=None,
)

# taskId -> dispatch context (for routing results back to a session).
_PENDING_DISPATCHES: Dict[str, Dict[str, Any]] = {}
_PENDING_DISPATCH_WAITERS: Dict[str, Dict[str, Any]] = {}

# Dispatches with no agent reply after this many seconds are considered lost and
# are dropped so the in-memory map does not grow unbounded when an agent drops.
_DISPATCH_TTL_SECONDS = 1800


def purge_stale_dispatches(now: Optional[float] = None) -> int:
    now = now if now is not None else time.time()
    stale = [
        task_id
        for task_id, ctx in _PENDING_DISPATCHES.items()
        if now - float(ctx.get("created_at") or 0) > _DISPATCH_TTL_SECONDS
    ]
    for task_id in stale:
        _PENDING_DISPATCHES.pop(task_id, None)
    return len(stale)


def _update_agent_task_state(agent_id: str, *, status: str, task_id: str, error: Optional[str] = None) -> None:
    for agent in agents.values():
        if str(agent.get("id")) == str(agent_id):
            agent["lastTaskId"] = task_id
            agent["lastTaskStatus"] = status
            agent["lastTaskAt"] = time.time()
            agent["lastSeenAt"] = time.time()
            agent["lastError"] = error
            break


def set_run_session_context(ctx: Optional[Dict[str, Any]]):
    return _RUN_SESSION_CONTEXT.set(ctx or None)


def get_run_session_context() -> Optional[Dict[str, Any]]:
    return _RUN_SESSION_CONTEXT.get()


def _find_agent_sid(agent_id: str) -> Optional[str]:
    for sid, agent in agents.items():
        if str(agent.get("id")) == str(agent_id):
            return sid
    return None


def _agent_kind_label(agent_id: str) -> str:
    for agent in agents.values():
        if str(agent.get("id")) != str(agent_id):
            continue
        platform = str(agent.get("platform") or "").lower()
        if bool(agent.get("isBrowserExtension")) or "browser-extension" in platform:
            return "浏览器Agent"
        if bool(agent.get("isWindowsDesktop")) or "desktop" in platform:
            return "桌面端Agent"
        return "端侧Agent"
    return "端侧Agent"


async def dispatch_task_to_agent(
    *,
    agent_id: str,
    user_id: int,
    ai_config_id: Optional[int],
    ai_kind: str,
    session_id: str,
    session_name: Optional[str],
    model: Optional[str],
    instruction: str,
    tool: str = "",
    args: Optional[Dict[str, Any]] = None,
    allowed_tools: Optional[List[str]] = None,
    wait_for_result: bool = False,
    timeout_seconds: int = 120,
    suppress_session_message: bool = False,
) -> Dict[str, Any]:
    target_sid = _find_agent_sid(agent_id)
    if not target_sid:
        return {"success": False, "error": f"Agent not connected: {agent_id}"}

    purge_stale_dispatches()
    task_id = f"atask_{uuid.uuid4().hex[:12]}"
    payload = {
        "taskId": task_id,
        "userId": user_id,
        "aiConfigId": ai_config_id,
        "sessionId": session_id,
        "instruction": instruction,
        "tool": tool or "",
        "args": args or {},
        "allowedTools": allowed_tools or [],
    }
    _PENDING_DISPATCHES[task_id] = {
        "agent_id": agent_id,
        "user_id": user_id,
        "ai_config_id": ai_config_id,
        "ai_kind": ai_kind or "assistant",
        "session_id": session_id,
        "session_name": session_name,
        "model": model,
        "instruction": instruction,
        "tool": tool or "",
        "created_at": time.time(),
        "suppress_session_message": bool(suppress_session_message),
    }
    # Persist before emit so a crash between emit and the result handler
    # still leaves a recoverable trail for the chat_worker poll path.
    _persist_dispatch(
        task_id=task_id,
        user_id=user_id,
        ai_config_id=ai_config_id,
        ai_kind=ai_kind,
        session_id=session_id,
        session_name=session_name,
        agent_id=agent_id,
        tool=tool or "",
        instruction=instruction or "",
    )
    waiter = None
    if wait_for_result:
        loop = asyncio.get_running_loop()
        waiter = {"loop": loop, "future": loop.create_future()}
        _PENDING_DISPATCH_WAITERS[task_id] = waiter
    await sio.emit("task:dispatch", payload, to=target_sid)
    if wait_for_result and waiter:
        future = waiter["future"]
        try:
            return await asyncio.wait_for(future, timeout=max(1, int(timeout_seconds or 120)))
        except asyncio.TimeoutError:
            _PENDING_DISPATCHES.pop(task_id, None)
            return {
                "success": False,
                "taskId": task_id,
                "agentId": agent_id,
                "tool": tool or "",
                "error": f"Endpoint agent result timeout after {timeout_seconds}s",
            }
        finally:
            _PENDING_DISPATCH_WAITERS.pop(task_id, None)
    return {
        "success": True,
        "taskId": task_id,
        "agentId": agent_id,
        "note": f"Task dispatched to {_agent_kind_label(agent_id)}. Result will arrive asynchronously and be appended to this session.",
    }


def _resolve_result_context(data: Dict[str, Any]) -> Dict[str, Any]:
    """Prefer the tracked dispatch context; fall back to fields echoed by the agent."""
    task_id = str(data.get("taskId") or "")
    ctx = _PENDING_DISPATCHES.get(task_id)
    if ctx:
        return ctx
    return {
        "agent_id": str(data.get("agentId") or "unknown"),
        "user_id": data.get("userId"),
        "ai_config_id": data.get("aiConfigId"),
        "ai_kind": data.get("aiKind") or "assistant",
        "session_id": data.get("sessionId"),
        "session_name": None,
        "model": None,
        "instruction": data.get("instruction") or "",
        "tool": data.get("tool") or "",
    }


def _save_agent_message(ctx: Dict[str, Any], content: str, tags: str) -> None:
    user_id = ctx.get("user_id")
    session_id = ctx.get("session_id")
    if not user_id or not session_id:
        return
    with Session(engine) as session:
        _save_message(
            session,
            int(user_id),
            ChatMessageCreate(
                role="system",
                content=content,
                tags=tags,
                ai_config_id=ctx.get("ai_config_id"),
                ai_kind=ctx.get("ai_kind") or "assistant",
                session_id=session_id,
                session_name=ctx.get("session_name"),
                model=ctx.get("model"),
                total_tokens=0,
            ),
        )


async def _emit_to_user(ctx: Dict[str, Any], event: str, payload: Dict[str, Any]) -> None:
    user_id = ctx.get("user_id")
    if user_id is None:
        return
    await sio.emit(event, payload, room=f"user_{user_id}")


async def handle_task_progress(data: Dict[str, Any]) -> None:
    ctx = _resolve_result_context(data)
    await _emit_to_user(ctx, "agent:task_progress", {
        "taskId": data.get("taskId"),
        "agentId": ctx.get("agent_id"),
        "message": str(data.get("message") or ""),
        "updatedAt": time.time(),
    })


async def handle_task_result(data: Dict[str, Any]) -> None:
    ctx = _resolve_result_context(data)
    task_id = str(data.get("taskId") or "")
    agent_id = str(ctx.get("agent_id") or data.get("agentId") or "unknown")
    success = bool(data.get("success", True))
    tool = str(data.get("tool") or ctx.get("tool") or "")
    summary = str(data.get("summary") or "")
    result = data.get("result")
    if success and tool in {"browser_screenshot", "screen.capture", "screen.capture_region"}:
        try:
            result = attach_persisted_screenshot(
                user_id=int(ctx.get("user_id") or 0),
                ai_config_id=ctx.get("ai_config_id"),
                tool=tool,
                result=result,
            )
        except Exception as exc:
            if isinstance(result, dict):
                result = {k: v for k, v in result.items() if k not in {"dataUrl", "data_url", "imageDataUrl", "screenshotDataUrl"}}
                result["uploaded"] = False
                result["upload_error"] = str(exc)

    status = "成功" if success else "失败"
    result_text = result if isinstance(result, str) else _safe_dump(result)
    agent_label = _agent_kind_label(agent_id)
    content = (
        f"[{agent_label}执行结果]\n"
        f"Agent: {agent_id}\n"
        f"工具: {tool or '(综合任务)'}\n"
        f"状态: {status}\n\n"
        f"[摘要]\n{summary or '(无摘要)'}\n\n"
        f"[结果]\n{result_text}"
    )
    if not bool(ctx.get("suppress_session_message")):
        _save_agent_message(ctx, content, "agent_task_result")
    _update_agent_task_state(agent_id, status="success" if success else "failed", task_id=task_id)
    _finalize_dispatch_row(
        task_id,
        status="completed" if success else "error",
        success=success,
        summary=summary,
        result=result,
        error=None if success else summary or "agent reported failure",
    )
    waiter = _PENDING_DISPATCH_WAITERS.get(task_id)
    waiter_payload = {
        "success": success,
        "taskId": task_id,
        "agentId": agent_id,
        "tool": tool,
        "summary": summary,
        "result": result,
    }
    if waiter:
        loop = waiter.get("loop")
        future = waiter.get("future")
        if loop and future and not future.done():
            loop.call_soon_threadsafe(future.set_result, waiter_payload)
    await _emit_to_user(ctx, "agent:task_result", {
        "taskId": task_id,
        "agentId": agent_id,
        "success": success,
        "tool": tool,
        "summary": summary,
        "result": result,
        "updatedAt": time.time(),
    })
    _PENDING_DISPATCHES.pop(task_id, None)


async def handle_task_error(data: Dict[str, Any]) -> None:
    ctx = _resolve_result_context(data)
    task_id = str(data.get("taskId") or "")
    agent_id = str(ctx.get("agent_id") or data.get("agentId") or "unknown")
    error = str(data.get("error") or "Unknown agent error")
    agent_label = _agent_kind_label(agent_id)
    content = (
        f"[{agent_label}执行失败]\n"
        f"Agent: {agent_id}\n"
        f"工具: {ctx.get('tool') or '(综合任务)'}\n\n"
        f"[错误]\n{error}"
    )
    if not bool(ctx.get("suppress_session_message")):
        _save_agent_message(ctx, content, "agent_task_error")
    _update_agent_task_state(agent_id, status="error", task_id=task_id, error=error)
    _finalize_dispatch_row(
        task_id,
        status="error",
        success=False,
        error=error,
    )
    waiter = _PENDING_DISPATCH_WAITERS.get(task_id)
    if waiter:
        loop = waiter.get("loop")
        future = waiter.get("future")
        if loop and future and not future.done():
            loop.call_soon_threadsafe(future.set_result, {
                "success": False,
                "taskId": task_id,
                "agentId": agent_id,
                "tool": str(ctx.get("tool") or ""),
                "error": error,
                "result": None,
            })
    await _emit_to_user(ctx, "agent:task_error", {
        "taskId": task_id,
        "agentId": agent_id,
        "error": error,
        "updatedAt": time.time(),
    })
    _PENDING_DISPATCHES.pop(task_id, None)


def _safe_dump(value: Any) -> str:
    import json
    try:
        return json.dumps(value, ensure_ascii=False, indent=2)
    except Exception:
        return str(value)


async def dispatch_endpoint_tool(
    *,
    user_id: int,
    ai_config_id: Optional[int],
    tool: str,
    args: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    """Fire-and-forget variant of :func:`dispatch_endpoint_tool_and_wait`.

    Emits ``task:dispatch`` to the right agent and returns the ``task_id``
    immediately. The dispatch row is persisted before the emit so the
    caller can poll ``AgentDispatchTask`` by ``task_id`` and survive a
    connector-runtime restart. Returns ``None`` when no agent is bound.
    """
    tool_name = str(tool or "").strip()
    if not is_endpoint_agent_tool(tool_name) or not ai_config_id:
        return None

    if is_browser_tool(tool_name):
        agent = get_connected_browser_agent(ai_config_id, user_id)
    elif is_desktop_tool(tool_name):
        agent = get_connected_desktop_agent(ai_config_id, user_id)
    else:
        agent = None
    if not agent:
        return None
    agent_id = str(agent.get("id") or "").strip()
    if not agent_id:
        return None

    run_ctx = get_run_session_context() or {}
    result = await dispatch_task_to_agent(
        agent_id=agent_id,
        user_id=user_id,
        ai_config_id=ai_config_id,
        ai_kind=str(run_ctx.get("ai_kind") or "assistant"),
        session_id=str(run_ctx.get("session_id") or ""),
        session_name=run_ctx.get("session_name"),
        model=run_ctx.get("model"),
        instruction=f"Run endpoint MCP tool {tool_name}",
        tool=tool_name,
        args=args or {},
        allowed_tools=[tool_name],
        wait_for_result=False,
        suppress_session_message=True,
    )
    return str(result.get("taskId") or "") or None


async def dispatch_endpoint_tool_and_wait(
    *,
    user_id: int,
    ai_config_id: Optional[int],
    tool: str,
    args: Optional[Dict[str, Any]] = None,
    timeout_seconds: int = 120,
) -> Dict[str, Any]:
    tool_name = str(tool or "").strip()
    if not is_endpoint_agent_tool(tool_name):
        return {"success": False, "error": f"Not an endpoint agent tool: {tool_name}"}
    if not ai_config_id:
        return {"success": False, "error": "ai_config_id is required for endpoint MCP tools"}

    agent = None
    if is_browser_tool(tool_name):
        agent = get_connected_browser_agent(ai_config_id, user_id)
    elif is_desktop_tool(tool_name):
        agent = get_connected_desktop_agent(ai_config_id, user_id)
    if not agent:
        kind = "browser" if is_browser_tool(tool_name) else "desktop"
        return {"success": False, "error": f"No connected {kind} agent bound to ai_config_id={ai_config_id}"}

    agent_id = str(agent.get("id") or "").strip()
    if not agent_id:
        return {"success": False, "error": "Connected endpoint agent has no id"}

    effective_timeout_seconds = _endpoint_timeout_seconds(
        tool_name,
        args or {},
        timeout_seconds,
    )
    run_ctx = get_run_session_context() or {}
    return await dispatch_task_to_agent(
        agent_id=agent_id,
        user_id=user_id,
        ai_config_id=ai_config_id,
        ai_kind=str(run_ctx.get("ai_kind") or "assistant"),
        session_id=str(run_ctx.get("session_id") or ""),
        session_name=run_ctx.get("session_name"),
        model=run_ctx.get("model"),
        instruction=f"Run endpoint MCP tool {tool_name}",
        tool=tool_name,
        args=args or {},
        allowed_tools=[tool_name],
        wait_for_result=True,
        timeout_seconds=effective_timeout_seconds,
        suppress_session_message=True,
    )


def _endpoint_timeout_seconds(tool: str, args: Dict[str, Any], fallback: int) -> int:
    """Resolve server-side wait timeout from endpoint tool args.

    Screenshot pages can wedge inside Chrome or lose a large socket payload.
    Tool-level timeouts inside the browser extension do not help if the
    extension never replies, so the dispatch waiter must honor timeout args too.
    """
    candidates = [
        args.get("timeout_seconds"),
        (float(args["task_timeout_ms"]) / 1000.0) if args.get("task_timeout_ms") is not None else None,
        (float(args["timeout_ms"]) / 1000.0) if args.get("timeout_ms") is not None else None,
    ]
    for value in candidates:
        try:
            parsed = int(float(value))
        except (TypeError, ValueError):
            continue
        if parsed > 0:
            return max(1, min(300, parsed))
    if str(tool or "") == "browser_screenshot":
        return max(1, min(60, int(fallback or 35)))
    return max(1, int(fallback or 120))



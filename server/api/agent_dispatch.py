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
import time
import uuid
from typing import Any, Dict, List, Optional

from sqlmodel import Session

from .database import engine
from .models import ChatMessageCreate
from .sio import agents, sio
from .routers.chat_persistence import _save_message

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


def reset_run_session_context(token) -> None:
    _RUN_SESSION_CONTEXT.reset(token)


def get_run_session_context() -> Optional[Dict[str, Any]]:
    return _RUN_SESSION_CONTEXT.get()


def _find_agent_sid(agent_id: str) -> Optional[str]:
    for sid, agent in agents.items():
        if str(agent.get("id")) == str(agent_id):
            return sid
    return None


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
    }
    await sio.emit("task:dispatch", payload, to=target_sid)
    return {
        "success": True,
        "taskId": task_id,
        "agentId": agent_id,
        "note": "Task dispatched to desktop agent. Result will arrive asynchronously and be appended to this session.",
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

    status = "成功" if success else "失败"
    result_text = result if isinstance(result, str) else _safe_dump(result)
    content = (
        "[桌面Agent执行结果]\n"
        f"Agent: {agent_id}\n"
        f"工具: {tool or '(综合任务)'}\n"
        f"状态: {status}\n\n"
        f"[摘要]\n{summary or '(无摘要)'}\n\n"
        f"[结果]\n{result_text}"
    )
    _save_agent_message(ctx, content, "agent_task_result")
    _update_agent_task_state(agent_id, status="success" if success else "failed", task_id=task_id)
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
    content = (
        "[桌面Agent执行失败]\n"
        f"Agent: {agent_id}\n"
        f"工具: {ctx.get('tool') or '(综合任务)'}\n\n"
        f"[错误]\n{error}"
    )
    _save_agent_message(ctx, content, "agent_task_error")
    _update_agent_task_state(agent_id, status="error", task_id=task_id, error=error)
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


async def _dispatch_task(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    """MCP tool handler: dispatch a task to a connected desktop agent."""
    agent_id = str(args.get("agentId") or "").strip()
    instruction = str(args.get("instruction") or "").strip()
    tool = str(args.get("tool") or "").strip()
    tool_args = args.get("args") if isinstance(args.get("args"), dict) else {}
    if not agent_id:
        return {"success": False, "error": "Missing agentId"}
    if not instruction and not tool:
        return {"success": False, "error": "Provide an instruction or a tool to run"}

    run_ctx = get_run_session_context() or {}
    return await dispatch_task_to_agent(
        agent_id=agent_id,
        user_id=user_id,
        ai_config_id=ai_config_id,
        ai_kind=str(run_ctx.get("ai_kind") or "assistant"),
        session_id=str(run_ctx.get("session_id") or ""),
        session_name=run_ctx.get("session_name"),
        model=run_ctx.get("model"),
        instruction=instruction,
        tool=tool,
        args=tool_args,
        allowed_tools=args.get("allowedTools") if isinstance(args.get("allowedTools"), list) else None,
    )

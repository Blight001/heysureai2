"""Admin panel API — service monitoring + user management.

All routes are gated to platform staff (``owner`` / ``admin``). The owner
(房主) is the only tier that can change roles or touch another owner; admins
(管理员) can monitor services, restart sub-tasks, list members and reset
member passwords.

Mounted at ``/api/admin`` (see ``PREFIX``) and auto-discovered by
``gateway.app``.
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from api.auth import get_password_hash
from api.core.logging_config import get_recent_logs
from api.core.settings import settings
from api.database import get_session
from api.models import ChatRun, User
from api.runtime.internal_http import InternalClient
from gateway.routers.auth import get_current_user


logger = logging.getLogger(__name__)

router = APIRouter()
PREFIX = "/api/admin"

VALID_ROLES = ("owner", "admin", "member")
ROLE_LABELS = {"owner": "房主", "admin": "管理员", "member": "成员"}


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------


def require_admin_user(authorization: str = Header(None), session: Session = Depends(get_session)) -> User:
    """Resolve the caller and require an owner/admin tier."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authentication token")
    user = get_current_user(authorization, session)
    if user.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="需要管理员或房主权限")
    return user


# ---------------------------------------------------------------------------
# Service monitoring
# ---------------------------------------------------------------------------


def _service_registry():
    """(key, display name, base_url) for every monitorable sub-service.

    ``gateway`` is this very process, so it has no URL (handled in-process).
    The others are reachable only when their ``*_runtime_url`` env is set
    (i.e. a split/compose deployment); in a monolith they show as ``local``.
    """
    return [
        ("gateway", "API 网关", ""),
        ("mcp", "MCP 运行时", settings.mcp_runtime_url),
        ("connector", "连接器运行时", settings.connector_runtime_url),
        ("ai", "AI 运行时", settings.ai_runtime_url),
    ]


def _probe_service(key: str, name: str, base_url: str) -> dict:
    if key == "gateway":
        return {
            "key": key,
            "name": name,
            "status": "running",
            "detail": {"role": "gateway"},
            "url": "(self)",
        }
    if not base_url:
        return {
            "key": key,
            "name": name,
            "status": "local",
            "detail": {"note": "未配置独立服务地址（单体模式）"},
            "url": "",
        }
    client = InternalClient(base_url, timeout=4.0)
    try:
        payload = client.get("/internal/health")
        status = "running" if payload.get("ok") else "degraded"
        return {"key": key, "name": name, "status": status, "detail": payload, "url": base_url}
    except Exception as exc:  # network error / non-2xx / timeout
        return {
            "key": key,
            "name": name,
            "status": "down",
            "detail": {"error": str(exc)},
            "url": base_url,
        }
    finally:
        client.close()


@router.get("/services")
def list_services(_admin: User = Depends(require_admin_user)) -> dict:
    services = [_probe_service(key, name, url) for key, name, url in _service_registry()]
    return {"services": services, "checked_at": time.time()}


@router.get("/services/{key}/logs")
def service_logs(
    key: str,
    limit: int = 200,
    level: Optional[str] = None,
    _admin: User = Depends(require_admin_user),
) -> dict:
    limit = max(1, min(600, int(limit or 200)))
    registry = {k: (name, url) for k, name, url in _service_registry()}
    if key not in registry:
        raise HTTPException(status_code=404, detail="未知的子服务")
    name, base_url = registry[key]

    if key == "gateway":
        return {"key": key, "name": name, "lines": get_recent_logs(limit=limit, level=level)}
    if not base_url:
        return {"key": key, "name": name, "lines": [], "note": "单体模式：日志与网关合并"}
    client = InternalClient(base_url, timeout=4.0)
    try:
        params = {"limit": limit}
        if level:
            params["level"] = level
        payload = client.get("/internal/logs", params=params)
        return {"key": key, "name": name, "lines": payload.get("lines", [])}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"无法获取 {name} 日志: {exc}")
    finally:
        client.close()


# ---------------------------------------------------------------------------
# Sub-task monitoring + control (ChatRun)
# ---------------------------------------------------------------------------


@router.get("/tasks")
def list_tasks(
    limit: int = 50,
    status: Optional[str] = None,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin_user),
) -> dict:
    limit = max(1, min(200, int(limit or 50)))
    stmt = select(ChatRun).order_by(ChatRun.updated_at.desc()).limit(limit)
    if status:
        stmt = select(ChatRun).where(ChatRun.status == status).order_by(ChatRun.updated_at.desc()).limit(limit)
    runs = session.exec(stmt).all()

    # Batch the owning-account lookup so the list stays one extra query.
    user_ids = {r.user_id for r in runs}
    users = {}
    if user_ids:
        for u in session.exec(select(User).where(User.id.in_(user_ids))).all():
            users[u.id] = u

    tasks = []
    for r in runs:
        owner = users.get(r.user_id)
        tasks.append(
            {
                "run_id": r.run_id,
                "status": r.status,
                "stop_requested": r.stop_requested,
                "user_id": r.user_id,
                "user_name": owner.name if owner else None,
                "user_account": owner.account if owner else None,
                "ai_config_id": r.ai_config_id,
                "ai_kind": r.ai_kind,
                "session_id": r.session_id,
                "session_name": r.session_name,
                "error_message": r.error_message,
                "started_at": r.started_at,
                "finished_at": r.finished_at,
                "heartbeat_at": r.heartbeat_at,
                "created_at": r.created_at,
                "updated_at": r.updated_at,
            }
        )
    return {"tasks": tasks}


@router.post("/tasks/{run_id}/stop")
def stop_task(
    run_id: str,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin_user),
) -> dict:
    run = session.exec(select(ChatRun).where(ChatRun.run_id == run_id)).first()
    if not run:
        raise HTTPException(status_code=404, detail="子任务不存在")
    now = time.time()
    run.stop_requested = True
    if run.status in ("queued", "running"):
        run.status = "stopped"
        run.finished_at = run.finished_at or now
    run.updated_at = now
    session.add(run)
    session.commit()
    return {"ok": True, "run_id": run_id, "status": run.status}


@router.post("/tasks/{run_id}/restart")
def restart_task(
    run_id: str,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin_user),
) -> dict:
    """Re-enqueue a finished/errored/stopped run so the worker pool picks it up.

    Mints a fresh ``run_id`` for the requeued copy so it doesn't collide with
    the historical row's unique key, then NOTIFYs the ai-runtime queue.
    """
    run = session.exec(select(ChatRun).where(ChatRun.run_id == run_id)).first()
    if not run:
        raise HTTPException(status_code=404, detail="子任务不存在")
    if run.status in ("queued", "running"):
        raise HTTPException(status_code=409, detail="子任务仍在运行，无需重启")

    now = time.time()
    new_run_id = f"run_{uuid.uuid4().hex[:16]}"
    requeued = ChatRun(
        run_id=new_run_id,
        user_id=run.user_id,
        ai_config_id=run.ai_config_id,
        ai_kind=run.ai_kind,
        session_id=run.session_id,
        session_name=run.session_name,
        status="queued",
        worker_kwargs_json=run.worker_kwargs_json,
        created_at=now,
        updated_at=now,
    )
    session.add(requeued)
    session.commit()

    try:
        from ai_runtime.worker import notify_queue

        notify_queue(new_run_id)
    except Exception:
        logger.exception("notify_queue failed for restarted run")

    return {"ok": True, "run_id": new_run_id, "status": "queued", "from_run_id": run_id}


# ---------------------------------------------------------------------------
# User management
# ---------------------------------------------------------------------------


class RoleUpdate(BaseModel):
    role: str


class PasswordReset(BaseModel):
    new_password: str


def _serialize_user(u: User) -> dict:
    return {
        "id": u.id,
        "name": u.name,
        "account": u.account,
        "avatar": u.avatar,
        "role": u.role,
        "role_label": ROLE_LABELS.get(u.role, u.role),
        "created_at": u.created_at,
    }


@router.get("/users")
def list_users(
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin_user),
) -> dict:
    users = session.exec(select(User).order_by(User.id)).all()
    return {"users": [_serialize_user(u) for u in users]}


@router.patch("/users/{user_id}/role")
def set_user_role(
    user_id: int,
    payload: RoleUpdate,
    session: Session = Depends(get_session),
    actor: User = Depends(require_admin_user),
) -> dict:
    new_role = (payload.role or "").strip().lower()
    if new_role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="无效的角色")
    target = session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")

    # Only the owner may grant/revoke the owner tier or touch another owner.
    if actor.role != "owner" and (new_role == "owner" or target.role == "owner"):
        raise HTTPException(status_code=403, detail="只有房主能管理房主权限")

    # Never strand the platform without an owner.
    if target.role == "owner" and new_role != "owner":
        other_owners = session.exec(
            select(User).where(User.role == "owner", User.id != target.id)
        ).first()
        if not other_owners:
            raise HTTPException(status_code=400, detail="至少需要保留一名房主")

    target.role = new_role
    session.add(target)
    session.commit()
    session.refresh(target)
    return {"ok": True, "user": _serialize_user(target)}


@router.post("/users/{user_id}/reset-password")
def reset_user_password(
    user_id: int,
    payload: PasswordReset,
    session: Session = Depends(get_session),
    actor: User = Depends(require_admin_user),
) -> dict:
    new_password = (payload.new_password or "").strip()
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="密码至少需要 6 位")
    target = session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    # Admins cannot reset an owner's password; owners can reset anyone.
    if actor.role != "owner" and target.role == "owner":
        raise HTTPException(status_code=403, detail="只有房主能重置房主的密码")

    target.hashed_password = get_password_hash(new_password)
    session.add(target)
    session.commit()
    return {"ok": True, "user_id": user_id}

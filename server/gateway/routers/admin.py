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
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlmodel import Session, SQLModel, select

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


@router.post("/services/{key}/restart")
def restart_service(key: str, admin: User = Depends(require_admin_user)) -> dict:
    """Restart a whole sub-service (its process/port), not an individual run.

    - ``gateway`` restarts this very process — the connection serving this
      request drops and the service comes back up on the same port.
    - The remote runtimes are told to re-exec themselves via their own
      ``/internal/restart`` endpoint.
    - In monolith mode (no dedicated URL) there is no separate process to
      bounce, so the call is rejected.
    """
    registry = {k: (name, url) for k, name, url in _service_registry()}
    if key not in registry:
        raise HTTPException(status_code=404, detail="未知的子服务")
    name, base_url = registry[key]

    if key == "gateway":
        from api.runtime.process_control import request_restart

        logger.warning(f"admin {admin.account} triggered gateway restart")
        cmd = request_restart(delay=1.0)
        return {"ok": True, "key": key, "name": name, "restarting": True, "command": cmd}

    if not base_url:
        raise HTTPException(status_code=400, detail=f"{name} 未配置独立服务地址（单体模式无法重启）")

    client = InternalClient(base_url, timeout=5.0)
    try:
        payload = client.post("/internal/restart")
        logger.warning(f"admin {admin.account} triggered restart of {key} ({base_url})")
        return {"ok": True, "key": key, "name": name, **payload}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"无法重启 {name}: {exc}")
    finally:
        client.close()


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


def _delete_user_owned_rows(session: Session, user_id: int) -> None:
    """Remove every row scoped to ``user_id`` before deleting the account.

    Postgres enforces the ``user_id`` foreign keys, so the account row can't
    go until its dependents do. We walk the SQLModel metadata in reverse
    dependency order and clear any table carrying a ``user_id`` column — this
    stays correct as new user-scoped tables are added without editing here.
    """
    for table in reversed(SQLModel.metadata.sorted_tables):
        if table.name == "user":
            continue
        if "user_id" in table.c:
            session.execute(
                text(f'DELETE FROM "{table.name}" WHERE user_id = :uid'),
                {"uid": user_id},
            )


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(require_admin_user),
) -> dict:
    target = session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    if target.id == actor.id:
        raise HTTPException(status_code=400, detail="不能删除自己")
    # Admins may not remove owners; only owners can.
    if actor.role != "owner" and target.role == "owner":
        raise HTTPException(status_code=403, detail="只有房主能删除房主")
    # Never delete the last remaining owner.
    if target.role == "owner":
        other_owner = session.exec(
            select(User).where(User.role == "owner", User.id != target.id)
        ).first()
        if not other_owner:
            raise HTTPException(status_code=400, detail="至少需要保留一名房主")

    _delete_user_owned_rows(session, user_id)
    session.delete(target)
    session.commit()
    logger.warning(f"admin {actor.account} deleted user #{user_id} ({target.account})")
    return {"ok": True, "user_id": user_id}

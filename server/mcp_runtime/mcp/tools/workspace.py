import os
import re
import subprocess
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from api.database import engine
from api.device_bindings import get_binding
from api.models import AIRuntimeStatus, AssistantAIConfig
from api.sio import agents
from ..core import generate_file_tree, get_project_root, safe_join


MAX_COMMAND_LENGTH = 8000
DEFAULT_COMMAND_TIMEOUT = 120
MAX_COMMAND_TIMEOUT = 600
BLOCKED_COMMAND_RE = re.compile(
    r'\b('
    r'format|diskpart|mountvol|bcdedit|regedit|'
    r'takeown|icacls|net\s+user|net\s+localgroup|'
    r'shutdown|restart-computer|stop-computer|'
    r'ssh|scp|ftp|telnet'
    r')\b',
    re.IGNORECASE,
)


def _ensure_inside_workspace(root: str, path: str) -> str:
    abs_root = os.path.abspath(root)
    abs_path = os.path.abspath(path)
    try:
        common = os.path.commonpath([abs_root, abs_path])
    except ValueError:
        common = ""
    if common != abs_root:
        raise HTTPException(status_code=403, detail="Access denied: path outside workspace")
    return abs_path


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def _resolve_command_cwd(project_root: str, cwd: Optional[str], *, strict_workspace: bool = False) -> str:
    if not cwd:
        return project_root
    cwd_text = str(cwd).strip()
    if not cwd_text or cwd_text == ".":
        return project_root
    if os.path.isabs(cwd_text):
        resolved = os.path.abspath(os.path.expanduser(os.path.expandvars(cwd_text)))
        if strict_workspace:
            resolved = _ensure_inside_workspace(project_root, resolved)
        if not os.path.isdir(resolved):
            raise HTTPException(status_code=400, detail="cwd does not exist or is not a directory")
        return resolved

    resolved = safe_join(project_root, cwd_text)
    if not os.path.isdir(resolved):
        raise HTTPException(status_code=400, detail="cwd does not exist or is not a directory")
    return _ensure_inside_workspace(project_root, resolved)


def _validate_command(command: str) -> None:
    if not isinstance(command, str) or not command.strip():
        raise HTTPException(status_code=400, detail="Missing command")
    if len(command) > MAX_COMMAND_LENGTH:
        raise HTTPException(status_code=400, detail="Command is too long")
    if "\x00" in command:
        raise HTTPException(status_code=400, detail="Command contains invalid characters")
    if BLOCKED_COMMAND_RE.search(command):
        raise HTTPException(status_code=403, detail="Command is blocked by the command safety policy")


def _sandbox_env(project_root: str) -> Dict[str, str]:
    sandbox_home = os.path.join(project_root, ".sandbox_home")
    sandbox_tmp = os.path.join(project_root, ".sandbox_tmp")
    os.makedirs(sandbox_home, exist_ok=True)
    os.makedirs(sandbox_tmp, exist_ok=True)
    env = {
        "PATH": os.environ.get("PATH", ""),
        "PATHEXT": os.environ.get("PATHEXT", ""),
        "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""),
        "WINDIR": os.environ.get("WINDIR", ""),
        "COMSPEC": os.environ.get("COMSPEC", ""),
        "TEMP": sandbox_tmp,
        "TMP": sandbox_tmp,
        "USERPROFILE": sandbox_home,
        "HOME": sandbox_home,
        "SANDBOX_ROOT": project_root,
    }
    return {key: value for key, value in env.items() if value}


def _command_env(project_root: str, *, sandbox_env: bool = False) -> Dict[str, str]:
    if sandbox_env:
        return _sandbox_env(project_root)
    env = os.environ.copy()
    env.setdefault("SANDBOX_ROOT", project_root)
    return env


def _coerce_timeout(value: Any) -> int:
    try:
        seconds = int(value or DEFAULT_COMMAND_TIMEOUT)
    except Exception:
        seconds = DEFAULT_COMMAND_TIMEOUT
    return max(1, min(MAX_COMMAND_TIMEOUT, seconds))


def _run_command(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    command = args.get("command")
    _validate_command(command)

    project_root = get_project_root(user_id, ai_config_id)
    strict_workspace = _truthy(args.get("strict_workspace") or args.get("workspace_only"))
    sandbox_env = _truthy(args.get("sandbox_env") or args.get("isolated_env"))
    command_cwd = _resolve_command_cwd(project_root, args.get("cwd"), strict_workspace=strict_workspace)
    timeout = _coerce_timeout(args.get("timeout"))
    try:
        result = subprocess.run(
            command,
            shell=True,
            cwd=command_cwd,
            env=_command_env(project_root, sandbox_env=sandbox_env),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        output = exc.stdout or ""
        if exc.stderr:
            output += f"\nError:\n{exc.stderr}"
        output += f"\nError:\nCommand timed out after {timeout} seconds"
        return {
            "command": command,
            "success": False,
            "exit_code": None,
            "output": output,
            "cwd": command_cwd,
            "workspace_root": project_root,
            "sandboxed": sandbox_env or strict_workspace,
            "strict_workspace": strict_workspace,
            "sandbox_env": sandbox_env,
        }

    output = result.stdout
    if result.stderr:
        output += f"\nError:\n{result.stderr}"

    return {
        "command": command,
        "success": result.returncode == 0,
        "exit_code": result.returncode,
        "output": output,
        "cwd": command_cwd,
        "workspace_root": project_root,
        "sandboxed": sandbox_env or strict_workspace,
        "strict_workspace": strict_workspace,
        "sandbox_env": sandbox_env,
    }

def _parse_int(value: Any) -> Optional[int]:
    try:
        parsed = int(value)
        return parsed if parsed > 0 else None
    except Exception:
        return None


def _list_connected_socket_agents(
    user_id: Optional[int] = None,
    ai_config_id: Optional[int] = None,
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    expected_user_id = _parse_int(user_id)
    expected_ai_config_id = _parse_int(ai_config_id)
    for item in list(agents.values()):
        row = dict(item) if isinstance(item, dict) else {"value": item}
        agent_user_id = _parse_int(row.get("userId") or row.get("user_id"))
        if expected_user_id and agent_user_id and agent_user_id != expected_user_id:
            continue

        device_id = str(row.get("id") or "").strip()
        bound_ai_config_id = get_binding(expected_user_id, device_id) if expected_user_id and device_id else None
        if expected_ai_config_id and bound_ai_config_id != expected_ai_config_id:
            continue

        row["aiConfigId"] = bound_ai_config_id
        row["ai_config_id"] = bound_ai_config_id
        row["source"] = "socket"
        row["dispatchable"] = bound_ai_config_id is not None
        out.append(row)
    return out

def _list_managed_ai_agents(user_id: int) -> List[Dict[str, Any]]:
    with Session(engine) as session:
        cfgs = session.exec(
            select(AssistantAIConfig)
            .where(AssistantAIConfig.user_id == user_id)
            .order_by(AssistantAIConfig.sort_order.asc(), AssistantAIConfig.created_at.asc())
        ).all()
        statuses = session.exec(
            select(AIRuntimeStatus).where(
                AIRuntimeStatus.user_id == user_id,
                AIRuntimeStatus.ai_kind == "assistant",
            )
        ).all()
    status_map = {int(row.ai_config_id): row for row in statuses if row.ai_config_id is not None}
    out: List[Dict[str, Any]] = []
    for cfg in cfgs:
        status = status_map.get(int(cfg.id or 0))
        current_status = str(status.current_status or "").strip() if status else ""
        out.append(
            {
                "id": f"ai_config_{cfg.id}",
                "ai_config_id": cfg.id,
                "name": cfg.name,
                "ai_role": cfg.ai_role,
                "digital_member_role": cfg.digital_member_role,
                "enabled": bool(cfg.enabled),
                "mcp_enabled": bool(cfg.mcp_enabled),
                "runtime_status": current_status or ("idle" if cfg.enabled else "stopped"),
                "runtime_tool": str(status.current_mcp_tool or "").strip() if status else "",
                "source": "ai_config",
                "dispatchable": False,
            }
        )
    return out

def _list_agents(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    connected_agents = _list_connected_socket_agents(user_id, ai_config_id)
    managed_agents = _list_managed_ai_agents(user_id)
    all_agents = connected_agents + managed_agents
    return {
        "agents": all_agents,
        "agent_count": len(all_agents),
        "connected_agents": connected_agents,
        "connected_agent_count": len(connected_agents),
        "managed_agents": managed_agents,
        "managed_agent_count": len(managed_agents),
        "note": "connected_agents are socket-registered and dispatchable; managed_agents are AI configs for visibility.",
    }

def _get_overview(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    project_root = get_project_root(user_id, ai_config_id)
    cfg_db_uri = None
    if ai_config_id:
        with Session(engine) as session:
            cfg = session.exec(
                select(AssistantAIConfig).where(
                    AssistantAIConfig.user_id == user_id,
                    AssistantAIConfig.id == ai_config_id,
                )
            ).first()
            if cfg:
                cfg_db_uri = cfg.database_uri
    connected_agents = _list_connected_socket_agents(user_id, ai_config_id)
    managed_agents = _list_managed_ai_agents(user_id)
    all_agents = connected_agents + managed_agents
    return {
        "workspace_root": project_root,
        "workspace_tree": generate_file_tree(project_root),
        "database_uri": cfg_db_uri,
        "agent_count": len(all_agents),
        "agents": all_agents,
        "connected_agent_count": len(connected_agents),
        "managed_agent_count": len(managed_agents),
    }


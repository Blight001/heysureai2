import json
import re
from datetime import datetime
from typing import Any, Dict, Optional

from sqlmodel import Session, select

from ..models import (
    DEFAULT_INHERITANCE_NOTICE,
    DEFAULT_RESUME_TASK_PROMPT,
    DEFAULT_START_TASK_PROMPT,
    DEFAULT_SUPERVISION_PROMPT,
    AITaskJob,
    ChatRun,
)

DEFAULT_SYSTEM_AUTO_CONTROL: Dict[str, Any] = {
    "enabled": False,
    "start_task_prompt": DEFAULT_START_TASK_PROMPT,
    "resume_task_prompt": DEFAULT_RESUME_TASK_PROMPT,
    "supervision_prompt": DEFAULT_SUPERVISION_PROMPT,
    "inheritance_notice": DEFAULT_INHERITANCE_NOTICE,
    "tasks": [],
}

TASK_RUNTIME_REQUIRED_TOOLS = {
    "task.get_current",
    "task.complete",
    "task.inherit",
    "task.list",
    "task.wait_all",
    "ai.reply_message",
}
TASK_TOOLSET_FOR_CREATE_COMPAT = {"task.list", "task.get_current", "task.inherit", "task.complete"}
TASK_CREATE_TOOLS = {"task.create", "task.create_immediate", "task.create_scheduled", "task.create_recurring"}
WORKSPACE_TOOLSET_FOR_READ_BY_NAME_COMPAT = {"workspace.read_files"}


def with_task_create_compat(tools: set[str]) -> set[str]:
    normalized = {str(item).strip() for item in (tools or set()) if str(item).strip()}
    if normalized.intersection(TASK_CREATE_TOOLS):
        normalized.update(TASK_CREATE_TOOLS)
        return normalized
    if normalized.intersection(TASK_TOOLSET_FOR_CREATE_COMPAT):
        normalized.update(TASK_CREATE_TOOLS)
    return normalized


def with_workspace_read_by_name_compat(tools: set[str]) -> set[str]:
    normalized = {str(item).strip() for item in (tools or set()) if str(item).strip()}
    if "workspace.read_file_by_name" in normalized:
        return normalized
    if normalized.intersection(WORKSPACE_TOOLSET_FOR_READ_BY_NAME_COMPAT):
        normalized.add("workspace.read_file_by_name")
    return normalized


def normalize_workspace_root(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip().replace("\\", "/").strip("/")
    return normalized or None


def normalize_task_item(raw: Any) -> Dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    priority = 5
    interval_minutes = 30
    try:
        priority = int(src.get("priority") or 5)
    except Exception:
        priority = 5
    try:
        interval_minutes = int(src.get("interval_minutes") or 30)
    except Exception:
        interval_minutes = 30
    return {
        "id": str(src.get("id") or "").strip(),
        "title": str(src.get("title") or "未命名任务").strip() or "未命名任务",
        "instruction": str(src.get("instruction") or "").strip(),
        "priority": max(1, min(10, priority)),
        "enabled": bool(src.get("enabled", True)),
        "schedule_enabled": bool(src.get("schedule_enabled", False)),
        "interval_minutes": max(1, interval_minutes),
    }


def normalize_system_auto_control(raw: Optional[str]) -> Dict[str, Any]:
    cfg = dict(DEFAULT_SYSTEM_AUTO_CONTROL)
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                cfg.update(parsed)
        except Exception:
            pass
    cfg["enabled"] = bool(cfg.get("enabled", False))
    cfg["start_task_prompt"] = str(cfg.get("start_task_prompt") or DEFAULT_SYSTEM_AUTO_CONTROL["start_task_prompt"]).strip()
    cfg["resume_task_prompt"] = str(cfg.get("resume_task_prompt") or DEFAULT_SYSTEM_AUTO_CONTROL["resume_task_prompt"]).strip()
    cfg["supervision_prompt"] = str(cfg.get("supervision_prompt") or DEFAULT_SYSTEM_AUTO_CONTROL["supervision_prompt"]).strip()
    cfg["inheritance_notice"] = str(cfg.get("inheritance_notice") or DEFAULT_SYSTEM_AUTO_CONTROL["inheritance_notice"]).strip()
    raw_tasks = cfg.get("tasks")
    if not isinstance(raw_tasks, list):
        raw_tasks = []
    cfg["tasks"] = [normalize_task_item(item) for item in raw_tasks]
    return cfg


def normalize_tasks_from_control(raw: Optional[str]) -> list[Dict[str, Any]]:
    return normalize_system_auto_control(raw).get("tasks", [])


def decode_task_payload(raw: Optional[str]) -> Dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def find_task_active_run(session: Session, user_id: int, config_id: int, job: AITaskJob) -> Optional[ChatRun]:
    run_row = None
    if job.last_run_id:
        run_row = session.exec(
            select(ChatRun).where(
                ChatRun.user_id == user_id,
                ChatRun.run_id == job.last_run_id,
            )
        ).first()
        if run_row and run_row.status in {"queued", "running"}:
            return run_row
    if job.session_id:
        run_row = session.exec(
            select(ChatRun).where(
                ChatRun.user_id == user_id,
                ChatRun.ai_config_id == config_id,
                ChatRun.ai_kind == "core",
                ChatRun.session_id == job.session_id,
                ChatRun.status.in_(["queued", "running"]),
            ).order_by(ChatRun.updated_at.desc())
        ).first()
        if run_row:
            return run_row
    return None


def iter_task_session_ids(job_id: str, current_session_id: Optional[str]) -> list[str]:
    prefix = f"session_task_{job_id}"
    out = [prefix]
    sid = str(current_session_id or "").strip()
    if sid and not sid.startswith(prefix) and sid not in out:
        out.append(sid)
    return out


def parse_generation_from_session_id(session_id: str, fallback: int) -> int:
    sid = str(session_id or "")
    match = re.search(r"_g(\d+)$", sid)
    if not match:
        return fallback
    try:
        return max(1, int(match.group(1)))
    except Exception:
        return fallback


def _parse_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    if isinstance(value, (int, float)):
        return bool(value)
    return default


def _parse_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except Exception:
        parsed = default
    return max(minimum, min(maximum, parsed))


def _parse_timestamp(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        parsed = float(value)
        return parsed if parsed > 0 else None
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = float(text)
        return parsed if parsed > 0 else None
    except Exception:
        pass
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return dt.timestamp()
    except Exception:
        return None


def extract_task_payload(body: Dict[str, Any]) -> Dict[str, Any]:
    schedule_enabled = _parse_bool(body.get("schedule_enabled"), False)
    schedule_loop_enabled = _parse_bool(body.get("schedule_loop_enabled"), False)
    schedule_run_immediately = _parse_bool(body.get("schedule_run_immediately"), False)
    schedule_duration_minutes = _parse_int(body.get("schedule_duration_minutes"), 30, 1, 7 * 24 * 60)
    schedule_at = _parse_timestamp(body.get("schedule_at"))

    override_token_limit_enabled = _parse_bool(body.get("override_token_limit_enabled"), False)
    token_limit_override = _parse_int(body.get("token_limit_override"), 10000, 1, 10**9)

    override_mcp_tools_enabled = _parse_bool(body.get("override_mcp_tools_enabled"), False)
    mcp_tools_raw = body.get("mcp_tools_override")
    if isinstance(mcp_tools_raw, str):
        try:
            mcp_tools_raw = json.loads(mcp_tools_raw)
        except Exception:
            mcp_tools_raw = []
    mcp_tools_override: list[str] = []
    if isinstance(mcp_tools_raw, list):
        dedup = set()
        for tool in mcp_tools_raw:
            item = str(tool or "").strip()
            if not item or item in dedup:
                continue
            dedup.add(item)
            mcp_tools_override.append(item)

    override_workspace_root_enabled = _parse_bool(body.get("override_workspace_root_enabled"), False)
    workspace_root_override = normalize_workspace_root(str(body.get("workspace_root_override") or ""))
    if not workspace_root_override:
        workspace_root_override = "."

    return {
        "schedule": {
            "enabled": schedule_enabled,
            "loop_enabled": schedule_loop_enabled,
            "run_immediately": schedule_run_immediately,
            "duration_minutes": schedule_duration_minutes,
            "schedule_at": schedule_at,
        },
        "override_token_limit": {
            "enabled": override_token_limit_enabled,
            "value": token_limit_override,
        },
        "override_mcp_tools": {
            "enabled": override_mcp_tools_enabled,
            "tools": mcp_tools_override,
        },
        "override_workspace_root": {
            "enabled": override_workspace_root_enabled,
            "value": workspace_root_override,
        },
    }

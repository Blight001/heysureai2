import json
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from ...database import engine
from ...models import AITaskJob, AssistantAIConfig, ChatMessage, ChatRun, ChatSession
from ...services.governance import assert_can_manage_or_legacy
from ...services.task_system import extract_task_payload

_FINISHED_STATUSES = {"completed", "cancelled", "stopped", "error"}
_ACTIVE_STATUSES = {"queued", "running", "paused"}
_TASK_LIST_STATUSES = _ACTIVE_STATUSES | _FINISHED_STATUSES

# Phase 5: concurrency caps (0 = unlimited)
_MAX_ACTIVE_TASKS_PER_AI = 10
_MAX_ACTIVE_SUBTASKS_PER_MANAGER = 20

_SCHEDULE_AT_KEYS: tuple[str, ...] = (
    "schedule_at",
    "run_at",
    "schedule_time",
)
_SCHEDULE_DURATION_KEYS: tuple[str, ...] = (
    "schedule_duration_minutes",
    "duration_minutes",
    "interval_minutes",
)


def _to_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "on"}:
            return True
        if lowered in {"0", "false", "no", "off"}:
            return False
    if isinstance(value, (int, float)):
        return bool(value)
    return default

def _pick_value(source: Dict[str, Any], keys: tuple[str, ...]) -> Any:
    if not isinstance(source, dict):
        return None
    for key in keys:
        if key in source:
            return source.get(key)
    return None

def _task_priority_from_args(args: Dict[str, Any]) -> int:
    raw = args.get("priority")
    if raw is None:
        raw = args.get("level")
    if isinstance(raw, str):
        normalized = raw.strip().lower()
        level_map = {
            "high": 8,
            "medium": 5,
            "low": 3,
            "urgent": 10,
            "critical": 10,
            "normal": 5,
            "高": 8,
            "中": 5,
            "低": 3,
            "紧急": 10,
            "普通": 5,
        }
        if normalized in level_map:
            return int(level_map[normalized])
    try:
        parsed = int(raw)
    except Exception:
        parsed = 5
    return max(1, min(10, parsed))

def _pick_schedule_value(args: Dict[str, Any], keys: tuple[str, ...]) -> Any:
    schedule_raw = args.get("schedule")
    schedule_obj = schedule_raw if isinstance(schedule_raw, dict) else {}
    local = _pick_value(schedule_obj, keys)
    if local is not None:
        return local
    return _pick_value(args, keys)

def _is_non_empty_schedule_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True

def _parse_schedule_at_strict(value: Any) -> tuple[Optional[float], Optional[str], bool]:
    if value is None:
        return None, None, False
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None, None, False
    else:
        text = str(value).strip()
    provided = True

    if isinstance(value, (int, float)):
        ts = float(value)
        if ts <= 0:
            return None, "schedule_at 必须是正数时间戳（Unix 秒）", provided
        return ts, None, provided

    try:
        ts = float(text)
        if ts <= 0:
            return None, "schedule_at 必须是正数时间戳（Unix 秒）", provided
        return ts, None, provided
    except Exception:
        pass

    iso_text = text
    if iso_text.endswith("Z"):
        iso_text = iso_text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(iso_text)
    except Exception:
        return None, "schedule_at 字符串必须是 ISO-8601 时间（示例: 2026-03-24T16:30:00+08:00）", provided

    if dt.tzinfo is None or dt.utcoffset() is None:
        return None, "schedule_at 使用 ISO-8601 时必须包含时区（+08:00 或 Z）", provided
    return dt.timestamp(), None, provided

def _normalize_schedule_at_arg(args: Dict[str, Any], value: float) -> Dict[str, Any]:
    out = dict(args or {})
    out["schedule_at"] = float(value)
    schedule_raw = out.get("schedule")
    if isinstance(schedule_raw, dict):
        schedule_obj = dict(schedule_raw)
        schedule_obj["schedule_at"] = float(value)
        out["schedule"] = schedule_obj
    return out

def _resolve_schedule_run_immediately(args: Dict[str, Any], default: bool = False) -> bool:
    raw = _pick_schedule_value(
        args,
        (
            "run_immediately",
            "schedule_run_immediately",
            "first_run_immediately",
            "immediate",
            "run_now",
        ),
    )
    return _to_bool(raw, default)

def _build_task_payload_from_args(args: Dict[str, Any]) -> tuple[Dict[str, Any], bool]:
    schedule_enabled_raw = _pick_schedule_value(args, (
        "enabled", "enable", "schedule_enabled", "is_enabled", "active", "on",
    ))
    schedule_at = _pick_schedule_value(args, _SCHEDULE_AT_KEYS)
    schedule_duration = _pick_schedule_value(args, _SCHEDULE_DURATION_KEYS)
    schedule_loop_enabled = _pick_schedule_value(args, (
        "loop_enabled", "schedule_loop_enabled", "loop", "repeat", "recurring",
    ))
    schedule_run_immediately = _pick_schedule_value(args, (
        "run_immediately", "schedule_run_immediately", "first_run_immediately",
        "immediate", "run_now",
    ))

    has_schedule_hint = any(
        item not in (None, "", False)
        for item in [schedule_at, schedule_duration, schedule_loop_enabled, schedule_run_immediately]
    )
    schedule_raw = args.get("schedule")
    schedule_obj = schedule_raw if isinstance(schedule_raw, dict) else {}
    if isinstance(schedule_obj, dict) and bool(schedule_obj):
        has_schedule_hint = True
    schedule_enabled = _to_bool(schedule_enabled_raw, has_schedule_hint)

    payload_source: Dict[str, Any] = {
        "schedule_enabled": schedule_enabled,
        "schedule_at": schedule_at,
        "schedule_duration_minutes": schedule_duration,
        "schedule_loop_enabled": _to_bool(schedule_loop_enabled, False),
        "schedule_run_immediately": _to_bool(schedule_run_immediately, False),
    }
    task_payload = extract_task_payload(payload_source)

    schedule = task_payload.get("schedule")
    if isinstance(schedule, dict):
        loop_enabled = bool(schedule.get("loop_enabled"))
        run_immediately = bool(schedule.get("run_immediately")) and loop_enabled
        schedule["loop_enabled"] = bool(loop_enabled)
        schedule["run_immediately"] = bool(run_immediately)
        if bool(schedule.get("enabled")):
            try:
                duration_minutes = max(1, int(schedule.get("duration_minutes") or 30))
            except Exception:
                duration_minutes = 30
            try:
                schedule_at_val = float(schedule.get("schedule_at") or 0)
            except Exception:
                schedule_at_val = 0.0
            if run_immediately:
                schedule_at_val = float(time.time())
            elif schedule_at_val <= 0:
                schedule_at_val = float(time.time() + duration_minutes * 60)
            schedule["duration_minutes"] = duration_minutes
            schedule["schedule_at"] = float(schedule_at_val)
            schedule["enabled"] = True
    return task_payload, bool(schedule_enabled)

def _enforce_task_schedule_mode(
    task_payload: Dict[str, Any],
    *,
    enabled: bool,
    loop_enabled: bool,
    run_immediately: bool,
) -> None:
    schedule = task_payload.get("schedule")
    if not isinstance(schedule, dict):
        schedule = {}
        task_payload["schedule"] = schedule

    try:
        duration_minutes = max(1, int(schedule.get("duration_minutes") or 30))
    except Exception:
        duration_minutes = 30

    run_now = bool(enabled and loop_enabled and run_immediately)
    schedule_at = _safe_timestamp(schedule.get("schedule_at"))

    if enabled:
        if run_now:
            schedule_at_val: Optional[float] = float(time.time())
        elif schedule_at is None:
            schedule_at_val = float(time.time() + duration_minutes * 60)
        else:
            schedule_at_val = float(schedule_at)
    else:
        schedule_at_val = None

    schedule["enabled"] = bool(enabled)
    schedule["loop_enabled"] = bool(loop_enabled) if enabled else False
    schedule["run_immediately"] = bool(run_now)
    schedule["duration_minutes"] = int(duration_minutes)
    schedule["schedule_at"] = schedule_at_val

def _task_create_type_from_payload(task_payload: Dict[str, Any]) -> str:
    schedule = task_payload.get("schedule")
    if not isinstance(schedule, dict):
        return "immediate"
    if not bool(schedule.get("enabled")):
        return "immediate"
    if bool(schedule.get("loop_enabled")):
        return "recurring"
    return "scheduled"

def _task_create_impl(
    user_id: int,
    args: Dict[str, Any],
    ai_config_id: Optional[int],
    *,
    source_tool: str,
    mode: str,
) -> Dict[str, Any]:
    title = str(args.get("title") or args.get("name") or args.get("task_name") or "").strip()
    instruction = str(args.get("instruction") or args.get("content") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail=f"title (or name/task_name) is required for {source_tool}")
    if not instruction:
        raise HTTPException(status_code=400, detail=f"instruction (or content) is required for {source_tool}")

    normalized_args = dict(args or {})
    raw_schedule_at = _pick_schedule_value(normalized_args, _SCHEDULE_AT_KEYS)
    raw_schedule_duration = _pick_schedule_value(normalized_args, _SCHEDULE_DURATION_KEYS)
    parsed_schedule_at, schedule_at_error, has_schedule_at_input = _parse_schedule_at_strict(raw_schedule_at)
    has_duration_input = _is_non_empty_schedule_value(raw_schedule_duration)
    if schedule_at_error:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{source_tool}: {schedule_at_error}。"
                "仅支持 Unix 秒时间戳，或带时区 ISO-8601（例如 2026-03-24T16:30:00+08:00）。"
            ),
        )
    if has_schedule_at_input and parsed_schedule_at is not None:
        normalized_args = _normalize_schedule_at_arg(normalized_args, parsed_schedule_at)

    if mode == "immediate":
        if has_schedule_at_input or has_duration_input:
            raise HTTPException(
                status_code=400,
                detail=f"{source_tool}: mode=immediate 不接受定时参数，请移除 schedule_at/schedule_duration_minutes。",
            )
    elif mode == "scheduled":
        if has_schedule_at_input and has_duration_input:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{source_tool}: schedule_at 与 schedule_duration_minutes 只能二选一，"
                    "不要同时传入。"
                ),
            )
        if (not has_schedule_at_input) and (not has_duration_input):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{source_tool}: 请明确提供 schedule_at 或 schedule_duration_minutes 其一，"
                    "避免默认时间导致错位执行。"
                ),
            )
    elif mode == "recurring":
        if has_schedule_at_input:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{source_tool}: mode=recurring 不支持 schedule_at，请仅使用 schedule_duration_minutes，"
                    "可选 schedule_run_immediately。"
                ),
            )
    else:
        raise HTTPException(
            status_code=400,
            detail=f"{source_tool}: mode 必须是 immediate、scheduled 或 recurring。",
        )

    priority = _task_priority_from_args(normalized_args)
    task_payload, schedule_enabled = _build_task_payload_from_args(normalized_args)
    template_id = str(normalized_args.get("template_id") or "").strip() or None

    if mode == "immediate":
        _enforce_task_schedule_mode(
            task_payload,
            enabled=False,
            loop_enabled=False,
            run_immediately=False,
        )
        schedule_enabled = False
    elif mode == "scheduled":
        _enforce_task_schedule_mode(
            task_payload,
            enabled=True,
            loop_enabled=False,
            run_immediately=False,
        )
        schedule_enabled = True
    elif mode == "recurring":
        _enforce_task_schedule_mode(
            task_payload,
            enabled=True,
            loop_enabled=True,
            run_immediately=_resolve_schedule_run_immediately(normalized_args, False),
        )
        schedule_enabled = True

    task_create_type = _task_create_type_from_payload(task_payload)

    with Session(engine) as session:
        owner_cfg = _resolve_task_runtime_owner(session, user_id, ai_config_id, normalized_args)

        is_fan_out = ai_config_id and int(owner_cfg.id) != int(ai_config_id)

        # Per-AI concurrency cap
        if _MAX_ACTIVE_TASKS_PER_AI > 0:
            active_count = session.exec(
                select(AITaskJob).where(
                    AITaskJob.user_id == user_id,
                    AITaskJob.ai_config_id == int(owner_cfg.id),
                    AITaskJob.status.notin_(list(_FINISHED_STATUSES)),
                )
            ).all()
            if len(active_count) >= _MAX_ACTIVE_TASKS_PER_AI:
                raise HTTPException(
                    status_code=429,
                    detail=(
                        f"AI '{owner_cfg.name}' already has {len(active_count)} active tasks "
                        f"(cap={_MAX_ACTIVE_TASKS_PER_AI}). "
                        "Wait for existing tasks to complete before dispatching more."
                    ),
                )

        # Per-manager fan-out subtask cap
        if is_fan_out and _MAX_ACTIVE_SUBTASKS_PER_MANAGER > 0:
            dispatched_count = session.exec(
                select(AITaskJob).where(
                    AITaskJob.user_id == user_id,
                    AITaskJob.created_by_ai_config_id == int(ai_config_id),
                    AITaskJob.status.notin_(list(_FINISHED_STATUSES)),
                )
            ).all()
            if len(dispatched_count) >= _MAX_ACTIVE_SUBTASKS_PER_MANAGER:
                raise HTTPException(
                    status_code=429,
                    detail=(
                        f"Manager AI has {len(dispatched_count)} active dispatched subtasks "
                        f"(cap={_MAX_ACTIVE_SUBTASKS_PER_MANAGER}). "
                        "Wait for subtasks to complete before dispatching more."
                    ),
                )

        row = AITaskJob(
            job_id=f"job_{uuid.uuid4().hex[:12]}",
            user_id=user_id,
            ai_config_id=int(owner_cfg.id),
            created_by_ai_config_id=int(ai_config_id) if ai_config_id else None,
            ai_kind="core",
            template_id=template_id,
            title=title,
            instruction=instruction,
            task_payload=json.dumps(task_payload, ensure_ascii=False),
            priority=priority,
            status="queued",
            trigger_type="schedule" if schedule_enabled else "manual",
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        schedule_meta = _build_task_schedule_meta(task_payload, row.trigger_type)
        created_ts = _safe_timestamp(row.created_at)
        return {
            "created": True,
            "job_id": row.job_id,
            "title": row.title,
            "instruction": row.instruction,
            "priority": row.priority,
            "trigger_type": row.trigger_type,
            "task_create_type": task_create_type,
            "create_tool": source_tool,
            "task_payload": task_payload,
            "owner_ai_config_id": owner_cfg.id,
            "owner_ai_name": owner_cfg.name,
            "requested_ai_config_id": ai_config_id,
            "created_at_unix": created_ts,
            "created_at_local": _format_ts_local(created_ts),
            "created_at_utc": _format_ts_utc(created_ts),
            "schedule": schedule_meta,
        }

def _safe_decode_task_payload(raw: Optional[str]) -> Dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}

def _safe_timestamp(value: Any) -> Optional[float]:
    try:
        ts = float(value)
    except Exception:
        return None
    if ts <= 0:
        return None
    return ts

def _format_ts_local(ts: Optional[float]) -> str:
    if ts is None:
        return ""
    return datetime.fromtimestamp(float(ts)).isoformat(sep=" ", timespec="seconds")

def _format_ts_utc(ts: Optional[float]) -> str:
    if ts is None:
        return ""
    return datetime.fromtimestamp(float(ts), tz=timezone.utc).isoformat(timespec="seconds")

def _build_task_schedule_meta(task_payload: Dict[str, Any], trigger_type: str) -> Dict[str, Any]:
    schedule = task_payload.get("schedule") if isinstance(task_payload, dict) else {}
    if not isinstance(schedule, dict):
        schedule = {}
    enabled = bool(schedule.get("enabled"))
    schedule_at = _safe_timestamp(schedule.get("schedule_at"))
    duration_minutes = int(schedule.get("duration_minutes") or 30) if enabled else int(schedule.get("duration_minutes") or 0)
    loop_enabled = bool(schedule.get("loop_enabled"))
    run_immediately = bool(schedule.get("run_immediately"))
    return {
        "trigger_type": str(trigger_type or "").strip(),
        "schedule_enabled": enabled,
        "schedule_at_unix": schedule_at,
        "schedule_at_local": _format_ts_local(schedule_at),
        "schedule_at_utc": _format_ts_utc(schedule_at),
        "schedule_duration_minutes": max(0, int(duration_minutes or 0)),
        "schedule_loop_enabled": loop_enabled,
        "schedule_run_immediately": run_immediately,
    }

def _task_job_payload(row: AITaskJob) -> Dict[str, Any]:
    payload = _safe_decode_task_payload(row.task_payload)
    created_ts = _safe_timestamp(row.created_at)
    return {
        "job_id": row.job_id,
        "title": row.title,
        "instruction": row.instruction,
        "task_payload": payload,
        "priority": row.priority,
        "status": row.status,
        "trigger_type": row.trigger_type,
        "session_id": row.session_id,
        "template_id": row.template_id,
        "created_at_unix": created_ts,
        "created_at_local": _format_ts_local(created_ts),
        "created_at_utc": _format_ts_utc(created_ts),
        "schedule": _build_task_schedule_meta(payload, row.trigger_type),
    }

def _resolve_task_runtime_owner(
    session: Session,
    user_id: int,
    ai_config_id: Optional[int],
    args: Dict[str, Any],
) -> AssistantAIConfig:
    if not ai_config_id:
        raise HTTPException(status_code=400, detail="ai_config_id is required for task tools")

    caller_cfg = session.exec(
        select(AssistantAIConfig).where(
            AssistantAIConfig.user_id == user_id,
            AssistantAIConfig.id == ai_config_id,
        )
    ).first()
    if not caller_cfg:
        raise HTTPException(status_code=404, detail="AI config not found")

    caller_role = str(caller_cfg.ai_role or "").strip()
    caller_member_role = str(caller_cfg.digital_member_role or "").strip().lower()

    raw_target = args.get("target_ai_config_id")
    if raw_target is None:
        raw_target = args.get("target_config_id")

    def _resolve_target(target_raw: Any) -> AssistantAIConfig:
        try:
            target_id = int(target_raw)
        except Exception:
            raise HTTPException(status_code=400, detail="target_ai_config_id must be an integer")
        target_cfg = session.exec(
            select(AssistantAIConfig).where(
                AssistantAIConfig.user_id == user_id,
                AssistantAIConfig.id == target_id,
            )
        ).first()
        if not target_cfg:
            raise HTTPException(status_code=404, detail="Target AI config not found")
        if str(target_cfg.ai_role or "").strip() != "digital_member":
            raise HTTPException(status_code=400, detail="Target AI config must be digital_member")
        return target_cfg

    if caller_role == "digital_member":
        # A manager member may fan out subtasks to other members (orchestrator mode),
        # but only to members it is authorized to manage (governance tree).
        if caller_member_role == "manager" and raw_target is not None:
            target_cfg = _resolve_target(raw_target)
            denial = assert_can_manage_or_legacy(session, user_id, caller_cfg, target_cfg)
            if denial:
                raise HTTPException(status_code=403, detail=denial)
            return target_cfg
        return caller_cfg

    if caller_role != "assistant_admin":
        raise HTTPException(status_code=400, detail="Only digital_member or assistant_admin supports task scheduler")

    if raw_target is not None:
        return _resolve_target(raw_target)

    candidates = session.exec(
        select(AssistantAIConfig).where(
            AssistantAIConfig.user_id == user_id,
            AssistantAIConfig.ai_role == "digital_member",
            AssistantAIConfig.enabled == True,
        ).order_by(AssistantAIConfig.sort_order.asc(), AssistantAIConfig.created_at.asc())
    ).all()
    if not candidates:
        raise HTTPException(
            status_code=400,
            detail="No enabled digital_member available for task scheduling; provide target_ai_config_id or enable one",
        )
    manager = next(
        (cfg for cfg in candidates if str(cfg.digital_member_role or "").strip().lower() == "manager"),
        None,
    )
    return manager or candidates[0]

def _load_task_job_for_owner(
    session: Session,
    user_id: int,
    owner_cfg: AssistantAIConfig,
    job_id: str,
) -> AITaskJob:
    if not job_id:
        raise HTTPException(status_code=400, detail="job_id is required")
    row = session.exec(
        select(AITaskJob).where(
            AITaskJob.user_id == user_id,
            AITaskJob.ai_config_id == int(owner_cfg.id),
            AITaskJob.job_id == job_id,
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Task job not found")
    return row

def _merge_task_payload_for_update(existing_payload: Dict[str, Any], args: Dict[str, Any]) -> Dict[str, Any]:
    payload = dict(existing_payload or {})
    has_schedule_update = any(
        key in args
        for key in (
            "mode",
            "schedule_enabled",
            "schedule_at",
            "run_at",
            "schedule_time",
            "schedule_duration_minutes",
            "duration_minutes",
            "interval_minutes",
            "schedule_loop_enabled",
            "loop",
            "repeat",
            "schedule_run_immediately",
            "run_now",
            "schedule",
        )
    )
    if has_schedule_update:
        mode = str(args.get("mode") or "").strip().lower()
        if mode in {"now", "manual"}:
            mode = "immediate"
        elif mode in {"once", "schedule"}:
            mode = "scheduled"
        elif mode in {"loop", "repeat"}:
            mode = "recurring"
        patch_payload, _ = _build_task_payload_from_args(args)
        schedule = patch_payload.get("schedule") if isinstance(patch_payload, dict) else {}
        if not isinstance(schedule, dict):
            schedule = {}
        if mode == "immediate":
            _enforce_task_schedule_mode(schedule_payload := {"schedule": schedule}, enabled=False, loop_enabled=False, run_immediately=False)
            schedule = schedule_payload["schedule"]
        elif mode == "scheduled":
            _enforce_task_schedule_mode(schedule_payload := {"schedule": schedule}, enabled=True, loop_enabled=False, run_immediately=False)
            schedule = schedule_payload["schedule"]
        elif mode == "recurring":
            _enforce_task_schedule_mode(
                schedule_payload := {"schedule": schedule},
                enabled=True,
                loop_enabled=True,
                run_immediately=_resolve_schedule_run_immediately(args, False),
            )
            schedule = schedule_payload["schedule"]
        elif mode:
            raise HTTPException(status_code=400, detail="mode must be immediate, scheduled, or recurring")
        payload["schedule"] = schedule
    return payload

def _task_create(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    mode = str((args or {}).get("mode") or "").strip().lower()
    if not mode:
        raise HTTPException(
            status_code=400,
            detail="task.create: mode is required: immediate, scheduled, or recurring",
        )
    mode_aliases = {
        "now": "immediate",
        "manual": "immediate",
        "once": "scheduled",
        "schedule": "scheduled",
        "loop": "recurring",
        "repeat": "recurring",
    }
    mode = mode_aliases.get(mode, mode)
    return _task_create_impl(user_id, args, ai_config_id, source_tool="task.create", mode=mode)

def _task_update(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    job_id = str(args.get("job_id") or "").strip()
    with Session(engine) as session:
        owner_cfg = _resolve_task_runtime_owner(session, user_id, ai_config_id, args)
        row = _load_task_job_for_owner(session, user_id, owner_cfg, job_id)
        previous_status = str(row.status or "")

        title_provided = "title" in args or "name" in args or "task_name" in args
        instruction_provided = "instruction" in args or "content" in args
        if title_provided:
            title = str(args.get("title") or args.get("name") or args.get("task_name") or "").strip()
            if not title:
                raise HTTPException(status_code=400, detail="title cannot be empty")
            row.title = title
        if instruction_provided:
            instruction = str(args.get("instruction") or args.get("content") or "").strip()
            if not instruction:
                raise HTTPException(status_code=400, detail="instruction cannot be empty")
            row.instruction = instruction
        if "priority" in args or "level" in args:
            row.priority = _task_priority_from_args(args)
        if "status" in args:
            status = str(args.get("status") or "").strip().lower()
            if status not in {"queued", "paused"}:
                raise HTTPException(status_code=400, detail="status can only be queued or paused")
            if previous_status in _FINISHED_STATUSES:
                raise HTTPException(status_code=400, detail="Cannot update a finished task status")
            row.status = status
            if status == "queued":
                row.finished_at = None

        payload = _merge_task_payload_for_update(_safe_decode_task_payload(row.task_payload), args)
        row.task_payload = json.dumps(payload, ensure_ascii=False)
        schedule = payload.get("schedule") if isinstance(payload, dict) else {}
        row.trigger_type = "schedule" if isinstance(schedule, dict) and bool(schedule.get("enabled")) else "manual"
        row.updated_at = time.time()
        session.add(row)
        session.commit()
        session.refresh(row)
        return {
            "updated": True,
            "previous_status": previous_status,
            "owner_ai_config_id": owner_cfg.id,
            "owner_ai_name": owner_cfg.name,
            "task": _task_job_payload(row),
            "runtime_note": "If the task is already running, title/instruction edits affect persisted metadata but not the active prompt.",
        }

def _delete_task_job_records(session: Session, user_id: int, config_id: int, job: AITaskJob) -> int:
    deleted_messages = 0
    now = time.time()
    prefixes = [f"session_task_{job.job_id}"]
    sid = str(job.session_id or "").strip()
    if sid and sid not in prefixes:
        prefixes.append(sid)

    for session_prefix in prefixes:
        run_rows = session.exec(
            select(ChatRun).where(
                ChatRun.user_id == user_id,
                ChatRun.ai_config_id == config_id,
                ChatRun.ai_kind == "core",
                ChatRun.session_id.like(f"{session_prefix}%"),
            )
        ).all()
        for row in run_rows:
            row.stop_requested = True
            if row.status in {"queued", "running"}:
                row.status = "stopped"
            if row.finished_at is None:
                row.finished_at = now
            row.updated_at = now
            session.add(row)

        msg_rows = session.exec(
            select(ChatMessage).where(
                ChatMessage.user_id == user_id,
                ChatMessage.ai_config_id == config_id,
                ChatMessage.ai_kind == "core",
                ChatMessage.session_id.like(f"{session_prefix}%"),
            )
        ).all()
        deleted_messages += len(msg_rows)
        for msg in msg_rows:
            session.delete(msg)

        session_rows = session.exec(
            select(ChatSession).where(
                ChatSession.user_id == user_id,
                ChatSession.ai_config_id == config_id,
                ChatSession.ai_kind == "core",
                ChatSession.session_id.like(f"{session_prefix}%"),
            )
        ).all()
        for row in session_rows:
            session.delete(row)
    return deleted_messages

def _task_delete(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    job_id = str(args.get("job_id") or "").strip()
    with Session(engine) as session:
        owner_cfg = _resolve_task_runtime_owner(session, user_id, ai_config_id, args)
        row = _load_task_job_for_owner(session, user_id, owner_cfg, job_id)
        previous_status = str(row.status or "")
        deleted_messages = _delete_task_job_records(session, user_id, int(owner_cfg.id), row)
        session.delete(row)
        session.commit()
        return {
            "deleted": True,
            "job_id": job_id,
            "previous_status": previous_status,
            "deleted_messages": deleted_messages,
            "owner_ai_config_id": owner_cfg.id,
            "owner_ai_name": owner_cfg.name,
        }

def _task_status_rank(raw: str) -> int:
    status = str(raw or "").strip()
    if status == "running":
        return 0
    if status == "queued":
        return 1
    if status == "paused":
        return 2
    return 9

def _parse_task_list_statuses(value: Any) -> List[str]:
    if value is None:
        return []
    raw_items = value if isinstance(value, list) else str(value).split(",")
    out: List[str] = []
    seen = set()
    for raw in raw_items:
        item = str(raw or "").strip()
        if not item or item not in _TASK_LIST_STATUSES or item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out

def _parse_task_list_limit(value: Any, default: int) -> int:
    try:
        parsed = int(value)
    except Exception:
        parsed = default
    return max(1, min(500, parsed))

def _task_row_to_dict(row: AITaskJob) -> Dict[str, Any]:
    payload = _safe_decode_task_payload(row.task_payload)
    created_ts = _safe_timestamp(row.created_at)
    started_ts = _safe_timestamp(row.started_at)
    finished_ts = _safe_timestamp(row.finished_at)
    return {
        "job_id": row.job_id,
        "title": row.title,
        "instruction": row.instruction,
        "task_payload": payload,
        "priority": row.priority,
        "status": row.status,
        "session_id": row.session_id,
        "template_id": row.template_id,
        "created_at_unix": created_ts,
        "created_at_local": _format_ts_local(created_ts),
        "created_at_utc": _format_ts_utc(created_ts),
        "started_at_unix": started_ts,
        "started_at_local": _format_ts_local(started_ts),
        "started_at_utc": _format_ts_utc(started_ts),
        "finished_at_unix": finished_ts,
        "finished_at_local": _format_ts_local(finished_ts),
        "finished_at_utc": _format_ts_utc(finished_ts),
        "schedule": _build_task_schedule_meta(payload, row.trigger_type),
    }

def _task_list(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    job_id = str(args.get("job_id") or "").strip()
    current_only = _to_bool(args.get("current_only", args.get("current")), False)
    include_history = _to_bool(args.get("include_history", args.get("history")), False)
    history_only = _to_bool(args.get("history_only"), False)
    requested_statuses = _parse_task_list_statuses(args.get("status") or args.get("statuses"))
    limit = _parse_task_list_limit(args.get("limit"), 100 if (include_history or history_only) else 500)
    with Session(engine) as session:
        owner_cfg = _resolve_task_runtime_owner(session, user_id, ai_config_id, args)
        query = select(AITaskJob).where(
            AITaskJob.user_id == user_id,
            AITaskJob.ai_config_id == int(owner_cfg.id),
        )
        if job_id:
            query = query.where(AITaskJob.job_id == job_id)
        elif requested_statuses:
            query = query.where(AITaskJob.status.in_(requested_statuses))
        elif history_only:
            query = query.where(AITaskJob.status.in_(list(_FINISHED_STATUSES)))
        elif not include_history:
            query = query.where(AITaskJob.status.in_(list(_ACTIVE_STATUSES)))
        rows = session.exec(
            query.order_by(AITaskJob.priority.desc(), AITaskJob.created_at.asc())
        ).all()
        if current_only or job_id:
            rows.sort(
                key=lambda item: (
                    _task_status_rank(str(item.status or "")),
                    -int(item.priority or 0),
                    float(item.created_at or 0),
                )
            )
            rows = rows[:1]
        elif include_history or history_only or requested_statuses:
            rows.sort(
                key=lambda item: (
                    0 if str(item.status or "") in _ACTIVE_STATUSES else 1,
                    _task_status_rank(str(item.status or "")),
                    -float(item.created_at or 0),
                )
            )
            rows = rows[:limit]
        tasks = [_task_row_to_dict(row) for row in rows]
        task = tasks[0] if tasks else None
        return {
            "owner_ai_config_id": owner_cfg.id,
            "owner_ai_name": owner_cfg.name,
            "requested_ai_config_id": ai_config_id,
            "requested_job_id": job_id or None,
            "current_only": bool(current_only),
            "include_history": bool(include_history),
            "history_only": bool(history_only),
            "statuses": requested_statuses or None,
            "limit": limit,
            "task": task if (current_only or job_id) else None,
            "tasks": tasks,
        }

def _task_inherit(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    if not ai_config_id:
        raise HTTPException(status_code=400, detail="ai_config_id is required for task tools")
    job_id = str(args.get("job_id") or "").strip()
    summary = str(args.get("summary") or "").strip()
    if not summary:
        raise HTTPException(status_code=400, detail="summary is required for task.inherit")
    with Session(engine) as session:
        row = None
        if job_id:
            row = session.exec(
                select(AITaskJob).where(
                    AITaskJob.user_id == user_id,
                    AITaskJob.ai_config_id == ai_config_id,
                    AITaskJob.job_id == job_id,
                )
            ).first()
        if not row:
            row = session.exec(
                select(AITaskJob).where(
                    AITaskJob.user_id == user_id,
                    AITaskJob.ai_config_id == ai_config_id,
                    AITaskJob.status == "running",
                ).order_by(AITaskJob.priority.desc(), AITaskJob.created_at.asc())
            ).first()
        if not row:
            raise HTTPException(status_code=404, detail="No running task to inherit")
        if str(row.status or "").strip() in {"completed", "cancelled", "stopped", "error"}:
            raise HTTPException(status_code=400, detail="Task already finished")
        row.updated_at = time.time()
        session.add(row)
        session.commit()
        return {
            "inherited": True,
            "job_id": row.job_id,
            "title": row.title,
            "summary": summary,
        }

def _task_complete(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    if not ai_config_id:
        raise HTTPException(status_code=400, detail="ai_config_id is required for task tools")
    job_id = str(args.get("job_id") or "").strip()
    summary = str(args.get("summary") or "").strip()
    with Session(engine) as session:
        row = None
        if job_id:
            row = session.exec(
                select(AITaskJob).where(
                    AITaskJob.user_id == user_id,
                    AITaskJob.ai_config_id == ai_config_id,
                    AITaskJob.job_id == job_id,
                )
            ).first()
        if not row:
            row = session.exec(
                select(AITaskJob).where(
                    AITaskJob.user_id == user_id,
                    AITaskJob.ai_config_id == ai_config_id,
                    AITaskJob.status == "running",
                ).order_by(AITaskJob.priority.desc(), AITaskJob.created_at.asc())
            ).first()
        if not row:
            raise HTTPException(status_code=404, detail="No running task to complete")
        row.status = "completed"
        row.finished_at = time.time()
        row.updated_at = row.finished_at
        session.add(row)
        session.commit()
        return {
            "completed": True,
            "job_id": row.job_id,
            "title": row.title,
            "summary": summary,
            "next_step_hint": (
                "若本次产生了可复用经验，请用 memory.write 沉淀关键事实/教训；"
                "若发现可改进系统 prompt/工具/流程的规律，请用 evolution.input 提交进化建议（附证据与风险）。"
            ),
        }

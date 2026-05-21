IS_ROUTER_ENTRY = False

import json
import time
import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from api.database import engine
from api.mcp import get_project_root, reset_mcp_runtime_overrides, set_mcp_runtime_overrides
from api.models import AITaskJob, AssistantAIConfig, ChatMessage, ChatRun, User
from api.task_system import parse_generation_from_session_id, with_task_create_compat, with_workspace_read_by_name_compat
from .chat_base import _RUN_LIVE_STATE, _RUN_STATE_LOCK
from .chat_prompt_utils import (
    _append_prompt_section,
    _clear_run_live_text,
    _merge_global_mcp_method,
    _strip_runtime_injected_sections,
)


def _resolve_ai_runtime(session: Session, user: User, ai_kind: str, ai_config_id: Optional[int]):
    cfg = None
    if ai_kind in ("assistant", "core"):
        if ai_config_id is None:
            cfg = session.exec(
                select(AssistantAIConfig).where(
                    AssistantAIConfig.user_id == user.id,
                    AssistantAIConfig.enabled == True,
                )
            ).first()
        else:
            cfg = session.exec(
                select(AssistantAIConfig).where(
                    AssistantAIConfig.id == ai_config_id,
                    AssistantAIConfig.user_id == user.id,
                )
            ).first()
        if not cfg:
            raise HTTPException(status_code=400, detail="No available assistant AI config")
        if not cfg.enabled:
            raise HTTPException(status_code=400, detail="Selected assistant AI is stopped")
        api_key = cfg.api_key
        base_url = cfg.base_url
        model = cfg.model
        # Strip auto-injected runtime sections before appending current effective values.
        system_prompt = _strip_runtime_injected_sections(cfg.prompt or "")
        # Show the effective runtime workspace (absolute path), not only raw config text like ".".
        system_prompt = _append_prompt_section(system_prompt, "AI 工作目录", get_project_root(user.id, cfg.id))
        if cfg.database_uri:
            system_prompt = _append_prompt_section(system_prompt, "AI 数据库连接", cfg.database_uri)
    else:
        api_key = user.admin_api_key
        base_url = user.admin_base_url
        model = user.admin_model
        system_prompt = _strip_runtime_injected_sections(user.admin_prompt or "")
    if not api_key:
        raise HTTPException(status_code=400, detail="Admin API key not configured")
    if not base_url:
        raise HTTPException(status_code=400, detail="Base URL not configured")
    if not model:
        raise HTTPException(status_code=400, detail="Model not configured")
    global_mcp_method = str(getattr(user, "mcp_call_method", "") or "").strip()
    system_prompt = _merge_global_mcp_method(system_prompt, global_mcp_method, cfg)
    return cfg, api_key, base_url, model, system_prompt

def _parse_allowed_tools(raw: Optional[str]) -> set[str]:
    try:
        parsed = json.loads(raw or "[]")
        if not isinstance(parsed, list):
            return set()
        raw_tools = {str(item).strip() for item in parsed if isinstance(item, str) and str(item).strip()}
        raw_tools = with_task_create_compat(raw_tools)
        return with_workspace_read_by_name_compat(raw_tools)
    except Exception:
        return set()

def _resolve_effective_workspace_root(
    user_id: int,
    ai_config_id: Optional[int],
    workspace_root_override: Optional[str] = None,
) -> str:
    override = str(workspace_root_override or "").strip()
    if not override:
        return get_project_root(user_id, ai_config_id)
    token = set_mcp_runtime_overrides(
        {
            "user_id": user_id,
            "ai_config_id": ai_config_id,
            "workspace_root": override,
        }
    )
    try:
        return get_project_root(user_id, ai_config_id)
    finally:
        reset_mcp_runtime_overrides(token)

def _build_task_mcp_rules(allowed_tools: set[str], workspace_root: str, include_workspace: bool = False) -> str:
    allowlist = "\n".join(f"- {tool}" for tool in sorted(allowed_tools)) if allowed_tools else "- （空）"
    workspace_section = ""
    if include_workspace:
        workspace_section = (
            "\n\n[任务运行时工作目录(绝对路径)]\n"
            f"{workspace_root}\n"
        )
    return (
        f"{workspace_section}"
        "\n[任务运行时MCP调用规则]\n"
        "1. 每轮最多调用 1 个 MCP 工具；拿到结果后再决定下一步，不允许并行多工具。\n"
        "2. 仅允许调用白名单中的工具；白名单外工具会被系统拒绝。\n"
        "3. 所有文件路径都必须是相对路径，并且只能在上述工作目录内访问。\n"
        "4. 写入/删除/命令执行类操作前，先说明目的、目标对象和预期影响，再执行。\n"
        "5. 工具失败时先阅读错误并调整参数重试，禁止重复相同失败调用。\n"
        "6. 禁止编造工具结果；必须基于真实 MCP 返回继续推理与执行。\n"
        "7. 创建定时任务时，`schedule_at` 仅允许 Unix 秒或带时区 ISO-8601（必须含 `+08:00` 或 `Z`）；"
        "循环任务禁止传 `schedule_at`。\n"
        "\n[任务运行时MCP工具白名单]\n"
        f"{allowlist}"
    )

def _load_task_payload_by_session(
    session: Session,
    user_id: int,
    ai_config_id: Optional[int],
    session_id: str,
) -> Dict[str, Any]:
    if ai_config_id is None:
        return {}
    row = session.exec(
        select(AITaskJob).where(
            AITaskJob.user_id == user_id,
            AITaskJob.ai_config_id == ai_config_id,
            AITaskJob.session_id == session_id,
        ).order_by(AITaskJob.updated_at.desc())
    ).first()
    if not row or not row.task_payload:
        return {}
    try:
        parsed = json.loads(row.task_payload)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}

def _load_task_job_by_session(
    session: Session,
    user_id: int,
    ai_config_id: Optional[int],
    session_id: str,
) -> Optional[AITaskJob]:
    if ai_config_id is None:
        return None
    return session.exec(
        select(AITaskJob).where(
            AITaskJob.user_id == user_id,
            AITaskJob.ai_config_id == ai_config_id,
            AITaskJob.session_id == session_id,
        ).order_by(AITaskJob.updated_at.desc())
    ).first()

def _is_task_finished_status(status: str) -> bool:
    return str(status or "").strip() in {"completed", "cancelled", "stopped", "error"}

def _create_loop_scheduled_job(
    session: Session,
    source_job: Optional[AITaskJob],
    now: float,
) -> Optional[AITaskJob]:
    if not source_job:
        return None
    if str(source_job.trigger_type or "").strip().lower() != "schedule":
        return None
    try:
        payload = json.loads(source_job.task_payload) if source_job.task_payload else {}
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    schedule = payload.get("schedule") if isinstance(payload, dict) else {}
    if not isinstance(schedule, dict):
        return None
    if not bool(schedule.get("enabled")):
        return None
    if not bool(schedule.get("loop_enabled")):
        return None
    try:
        duration_minutes = max(1, int(schedule.get("duration_minutes") or 30))
    except Exception:
        duration_minutes = 30
    next_schedule = dict(schedule)
    next_schedule["enabled"] = True
    next_schedule["loop_enabled"] = True
    # "立即执行"仅用于首次创建；循环续建后统一按时长触发。
    next_schedule["run_immediately"] = False
    next_schedule["duration_minutes"] = duration_minutes
    next_schedule["schedule_at"] = float(now + duration_minutes * 60)
    payload["schedule"] = next_schedule
    next_job = AITaskJob(
        job_id=f"job_{uuid.uuid4().hex[:12]}",
        user_id=source_job.user_id,
        ai_config_id=source_job.ai_config_id,
        ai_kind=source_job.ai_kind or "core",
        template_id=source_job.template_id,
        title=source_job.title,
        instruction=source_job.instruction,
        task_payload=json.dumps(payload, ensure_ascii=False),
        priority=max(1, min(10, int(source_job.priority or 5))),
        status="queued",
        trigger_type="schedule",
    )
    session.add(next_job)
    return next_job

def _run_set_status(run_id: str, status: str, error_message: Optional[str] = None, finished: bool = False):
    with Session(engine) as bg:
        row = bg.exec(select(ChatRun).where(ChatRun.run_id == run_id)).first()
        if not row:
            return
        row.status = status
        row.error_message = error_message
        row.updated_at = time.time()
        if row.started_at is None and status == "running":
            row.started_at = time.time()
        if finished:
            row.finished_at = time.time()
        bg.add(row)
        bg.commit()
    if finished:
        _clear_run_live_text(run_id)

def _run_should_stop(run_id: str) -> bool:
    with Session(engine) as bg:
        row = bg.exec(select(ChatRun).where(ChatRun.run_id == run_id)).first()
        return bool(row and row.stop_requested)

def _session_total_tokens(
    session: Session,
    user_id: int,
    ai_kind: str,
    session_id: str,
    ai_config_id: Optional[int],
) -> int:
    stmt = select(ChatMessage).where(
        ChatMessage.user_id == user_id,
        ChatMessage.ai_kind == ai_kind,
        ChatMessage.session_id == session_id,
    )
    if ai_config_id is not None:
        stmt = stmt.where(ChatMessage.ai_config_id == ai_config_id)
    rows = session.exec(stmt).all()
    persisted_total = int(sum(int(r.total_tokens or 0) for r in rows))

    active_runs = session.exec(
        select(ChatRun).where(
            ChatRun.user_id == user_id,
            ChatRun.ai_kind == ai_kind,
            ChatRun.session_id == session_id,
            ChatRun.status.in_(["queued", "running"]),
        )
    ).all()
    pending_total = 0
    with _RUN_STATE_LOCK:
        for run in active_runs:
            if ai_config_id is not None and run.ai_config_id != ai_config_id:
                continue
            pending_total += int((_RUN_LIVE_STATE.get(run.run_id) or {}).get("pending_total_tokens") or 0)
    return int(persisted_total + pending_total)

def _live_pending_tokens_for(
    session: Session,
    *,
    user_id: int,
    ai_kind: str,
    ai_config_id: Optional[int] = None,
    session_id: Optional[str] = None,
) -> Dict[str, int]:
    stmt = select(ChatRun).where(
        ChatRun.user_id == user_id,
        ChatRun.ai_kind == ai_kind,
        ChatRun.status.in_(["queued", "running"]),
    )
    if ai_config_id is not None:
        stmt = stmt.where(ChatRun.ai_config_id == ai_config_id)
    if session_id is not None:
        stmt = stmt.where(ChatRun.session_id == session_id)
    runs = session.exec(stmt).all()
    prompt = 0
    completion = 0
    total = 0
    with _RUN_STATE_LOCK:
        for run in runs:
            live = _RUN_LIVE_STATE.get(run.run_id) or {}
            prompt += int(live.get("pending_prompt_tokens") or 0)
            completion += int(live.get("pending_completion_tokens") or 0)
            total += int(live.get("pending_total_tokens") or 0)
    return {
        "prompt_tokens": int(prompt),
        "completion_tokens": int(completion),
        "total_tokens": int(total),
    }

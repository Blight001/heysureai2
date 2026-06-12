"""Chat runtime helpers: resolve the effective AI runtime/config for a request,
load task payloads/jobs by session, manage per-run status and stop flags, and
compute session token totals."""

IS_ROUTER_ENTRY = False

import json
import time
import uuid
from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from api.database import engine
from mcp_runtime.mcp import get_project_root
from api.models import AITaskJob, AssistantAIConfig, ChatMessage, ChatRun, User
from api.services.model_presets import resolve_model_preset
from api.services.task_system import with_workspace_read_by_name_compat
from .run_state import _RUN_LIVE_STATE, _RUN_STATE_LOCK
from .chat_prompt_utils import (
    _append_prompt_section,
    _clear_run_live_text,
    _strip_runtime_injected_sections,
)


def _resolve_ai_runtime(session: Session, user: User, ai_kind: str, ai_config_id: Optional[int]):
    # KnowledgeBase 文件为真相源：建目录 + 首次把现有内容导出成文件（幂等）。
    # 运行时直接读文件（见下方 effective_* 调用），不再回写数据库。
    from api.services import kb_store

    kb_store.ensure_user_kb(user.id)
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
        api_key, base_url, model = resolve_model_preset(user, cfg)
        # 方案 A：人格 Prompt 直接读 KnowledgeBase/personas/*.md（文件缺失回退 DB）。
        system_prompt = _strip_runtime_injected_sections(kb_store.effective_ai_prompt(user.id, cfg))
        # Show the effective runtime workspace (absolute path), not only raw config text like ".".
        system_prompt = _append_prompt_section(system_prompt, "AI 工作目录", get_project_root(user.id, cfg.id))
        if cfg.database_uri:
            system_prompt = _append_prompt_section(system_prompt, "AI 数据库连接", cfg.database_uri)
    else:
        api_key, base_url, model = resolve_model_preset(user, None)
        system_prompt = _strip_runtime_injected_sections(
            kb_store.effective_system_value(user.id, "admin_prompt", user.admin_prompt)
        )
    if not api_key:
        raise HTTPException(status_code=400, detail="Admin API key not configured")
    if not base_url:
        raise HTTPException(status_code=400, detail="Base URL not configured")
    if not model:
        raise HTTPException(status_code=400, detail="Model not configured")
    if cfg and not cfg.mcp_enabled:
        system_prompt = _append_prompt_section(
            system_prompt,
            "MCP状态",
            "当前 AI 的 MCP 功能未启用。不要调用 MCP 工具；如果任务必须使用 MCP，请说明需要先在该 AI 配置中开启 MCP。",
        )
    return cfg, api_key, base_url, model, system_prompt

def _parse_allowed_tools(raw: Optional[str]) -> set[str]:
    from connector_runtime.dispatch.desktop_agent_tools import strip_endpoint_tool_config_names

    try:
        parsed = json.loads(raw or "[]")
        if not isinstance(parsed, list):
            return set()
        raw_tools = {str(item).strip() for item in parsed if isinstance(item, str) and str(item).strip()}
        return strip_endpoint_tool_config_names(with_workspace_read_by_name_compat(raw_tools))
    except Exception:
        return set()

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
    """循环任务完成后创建下一轮实例；循环已结束（轮数跑满/超截止时间）返回 None。

    下一轮触发时刻由 task_schedule.build_next_loop_schedule 按循环方式
    （interval / daily / weekly）统一计算。
    """
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

    from api.services.task_schedule import build_next_loop_schedule

    next_schedule = build_next_loop_schedule(payload.get("schedule"), now)
    if next_schedule is None:
        return None
    payload["schedule"] = next_schedule
    next_job = AITaskJob(
        job_id=f"job_{uuid.uuid4().hex[:12]}",
        user_id=source_job.user_id,
        ai_config_id=source_job.ai_config_id,
        created_by_ai_config_id=source_job.created_by_ai_config_id,
        created_by_session_id=source_job.created_by_session_id,
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
        if row.stop_requested and status != "stopped":
            status = "stopped"
            error_message = row.error_message or error_message
            finished = True
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

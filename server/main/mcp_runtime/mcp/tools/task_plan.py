"""MCP tools for the planned task flow.

The AI drives a long task through four tools:

- ``plan.create``    commit a full multi-phase plan before acting
- ``plan.get``       read the current plan + progress
- ``phase.complete`` finish the current phase (runtime then hides its
                     deep-thinking + MCP detail from the live context)
- ``task.finish``    summarize the whole run into a success/failure log

Durable plan state lives in :mod:`api.services.task_plan`; the conversation
context side effects are applied by the inference loop.
"""

import re
from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from api.database import engine
from api.models import AITaskJob
from api.services import task_plan as plan_service
from connector_runtime.dispatch.device_dispatch import get_run_session_context
from ..core import get_project_root


def _run_context() -> Dict[str, Any]:
    return get_run_session_context() or {}


def _resolve_session_id(args: Dict[str, Any]) -> Optional[str]:
    explicit = str((args or {}).get("session_id") or "").strip()
    if explicit:
        return explicit
    return str(_run_context().get("session_id") or "").strip() or None


def _resolve_job_id(session: Session, user_id: int, ai_config_id: int, session_id: Optional[str]) -> Optional[str]:
    """Best-effort link of a plan to its task job.

    Task runtimes use session ids shaped like ``session_task_<job_id>[_g<n>]``;
    fall back to the newest active job for this AI when that pattern is absent.
    """
    if session_id:
        match = re.match(r"^session_task_(job_[0-9a-f]+)", str(session_id))
        if match:
            return match.group(1)
    row = session.exec(
        select(AITaskJob).where(
            AITaskJob.user_id == user_id,
            AITaskJob.ai_config_id == int(ai_config_id),
            AITaskJob.status == "running",
        ).order_by(AITaskJob.priority.desc(), AITaskJob.created_at.asc())
    ).first()
    return str(row.job_id) if row else None


def _require_ai_config_id(ai_config_id: Optional[int]) -> int:
    if not ai_config_id:
        raise HTTPException(status_code=400, detail="ai_config_id is required for plan tools")
    return int(ai_config_id)


def _plan_create(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    cfg_id = _require_ai_config_id(ai_config_id)
    goal = str((args or {}).get("goal") or (args or {}).get("objective") or "").strip()
    if not goal:
        raise HTTPException(status_code=400, detail="goal is required: 先用一句话写清整体目标。")
    try:
        phases = plan_service.normalize_phases((args or {}).get("phases"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    session_id = _resolve_session_id(args)
    with Session(engine) as session:
        job_id = _resolve_job_id(session, user_id, cfg_id, session_id)
        plan = plan_service.create_plan(
            session,
            user_id=user_id,
            ai_config_id=cfg_id,
            session_id=session_id,
            job_id=job_id,
            goal=goal,
            phases=phases,
        )
        progress = plan_service.plan_progress(session, plan)
    return {
        "created": True,
        "plan": progress,
        "next_step_hint": (
            "计划已登记。现在从第 1 个阶段开始执行；完成一个阶段后调用 phase.complete 收尾该阶段"
            "（系统会自动精简上一阶段的上下文）；全部阶段完成后调用 task.finish 总结。"
        ),
    }


def _plan_get(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    cfg_id = _require_ai_config_id(ai_config_id)
    session_id = _resolve_session_id(args)
    with Session(engine) as session:
        plan = plan_service.get_active_plan(session, user_id, cfg_id, session_id)
        if plan is None:
            return {"has_plan": False, "note": "当前没有进行中的计划。复杂任务请先用 plan.create 制定计划。"}
        return {"has_plan": True, "plan": plan_service.plan_progress(session, plan)}


def _phase_complete(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    cfg_id = _require_ai_config_id(ai_config_id)
    # Summary is optional: the system drives phase progression, so phase.complete
    # only needs to mark the boundary.
    summary = str((args or {}).get("summary") or "").strip()
    status = str((args or {}).get("status") or "completed").strip().lower()
    if status not in {"completed", "failed"}:
        status = "completed"
    session_id = _resolve_session_id(args)
    with Session(engine) as session:
        plan = plan_service.get_active_plan(session, user_id, cfg_id, session_id)
        if plan is None:
            raise HTTPException(status_code=404, detail="没有进行中的计划；请先 plan.create 或直接作答。")
        result = plan_service.complete_current_phase(session, plan, summary=summary, status=status)
        progress = plan_service.plan_progress(session, plan)
    hint = (
        "已是最后一个阶段：系统将要求你调用 task.finish 总结整个任务。"
        if result["all_phases_done"]
        else "本阶段已收尾、上下文已精简。系统会下发下一个阶段，按系统调度执行即可。"
    )
    return {
        "phase_completed": True,
        "finished_phase": result["finished_phase"],
        "next_phase": result["next_phase"],
        "all_phases_done": result["all_phases_done"],
        "plan": progress,
        "next_step_hint": hint,
    }


def _task_finish(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    cfg_id = _require_ai_config_id(ai_config_id)
    summary = str((args or {}).get("summary") or "").strip()
    if not summary:
        raise HTTPException(status_code=400, detail="summary is required: 给出整个任务的完整复盘总结。")
    outcome = str((args or {}).get("outcome") or "").strip().lower()
    if outcome not in {"success", "failure"}:
        raise HTTPException(status_code=400, detail="outcome 必须是 success 或 failure。")
    session_id = _resolve_session_id(args)
    with Session(engine) as session:
        plan = plan_service.get_active_plan(session, user_id, cfg_id, session_id)
        if plan is None:
            raise HTTPException(status_code=404, detail="没有进行中的计划可以收尾。")
        plan_service.finish_plan(session, plan, outcome=outcome, summary=summary)
        phases = plan_service.list_phases(session, plan.plan_id)
        workspace_root = get_project_root(user_id, cfg_id)
        try:
            log_path = plan_service.write_outcome_log(workspace_root, plan, phases, summary=summary)
        except Exception as exc:  # log failure must not abort task completion
            log_path = ""
            log_error = str(exc)
        else:
            log_error = ""
        progress = plan_service.plan_progress(session, plan)
        job_id = plan.job_id
    result: Dict[str, Any] = {
        "finished": True,
        "outcome": outcome,
        "plan_id": progress["plan_id"],
        "job_id": job_id,
        "log_path": log_path,
        "next_step_hint": (
            "任务已收尾，完整流程已写入"
            + ("成功" if outcome == "success" else "失败")
            + "日志，供后续沉淀为可复用知识。"
        ),
    }
    if log_error:
        result["log_warning"] = f"日志写入失败（不影响任务收尾）: {log_error}"
    return result

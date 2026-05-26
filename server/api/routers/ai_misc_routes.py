IS_ROUTER_ENTRY = False

import time
from typing import Any, Dict, List, Optional

from fastapi import Depends, Header, HTTPException
from sqlmodel import Session, select

from api.database import get_session
from api.integrations.feishu.long_connection import get_feishu_long_connection_state
from api.models import (
    AITaskJob,
    AIRuntimeStatus,
    AssistantAIConfig,
    ChatMessage,
    ChatRun,
    ChatSession,
    ChatSessionCreate,
    TokenUsageSnapshot,
)
from api.routers.auth import get_current_user
from api.services.ai_service import ensure_default_ai_for_user, remove_switch_key
from api.services.task_system import decode_task_payload, parse_generation_from_session_id
from .ai_base import router


@router.post("/configs/{config_id}/clear-tokens")
async def clear_ai_token_usage(
    config_id: int,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    cfg = session.get(AssistantAIConfig, config_id)
    if not cfg or cfg.user_id != user.id:
        raise HTTPException(status_code=404, detail="AI config not found")

    rows = session.exec(
        select(TokenUsageSnapshot).where(
            TokenUsageSnapshot.user_id == user.id,
            TokenUsageSnapshot.ai_kind == "assistant",
            TokenUsageSnapshot.ai_config_id == config_id,
        )
    ).all()
    deleted = len(rows)
    for row in rows:
        session.delete(row)
    session.commit()
    return {"success": True, "deleted": deleted}

@router.delete("/configs/{config_id}")
async def delete_ai_config(
    config_id: int,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    cfg = session.get(AssistantAIConfig, config_id)
    if not cfg or cfg.user_id != user.id:
        raise HTTPException(status_code=404, detail="AI config not found")

    status_rows = session.exec(
        select(AIRuntimeStatus).where(
            AIRuntimeStatus.user_id == user.id,
            AIRuntimeStatus.ai_config_id == config_id,
            AIRuntimeStatus.ai_kind == "assistant",
        )
    ).all()
    for row in status_rows:
        session.delete(row)

    session_rows = session.exec(
        select(ChatSession).where(
            ChatSession.user_id == user.id,
            ChatSession.ai_config_id == config_id,
            ChatSession.ai_kind == "assistant",
        )
    ).all()
    for row in session_rows:
        session.delete(row)

    session.delete(cfg)
    session.commit()
    remove_switch_key(user.id, cfg.switch_key)
    return {"success": True}

@router.get("/runtime-status")
async def get_runtime_status(
    ai_config_id: Optional[int] = None,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    statement = select(AIRuntimeStatus).where(AIRuntimeStatus.user_id == user.id)
    if ai_config_id:
        statement = statement.where(AIRuntimeStatus.ai_config_id == ai_config_id)
    return session.exec(statement).all()

@router.get("/token-snapshots")
async def get_token_snapshots(
    ai_kind: str = "assistant",
    ai_config_id: Optional[int] = None,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    statement = select(TokenUsageSnapshot).where(
        TokenUsageSnapshot.user_id == user.id,
        TokenUsageSnapshot.ai_kind == ai_kind,
    )
    if ai_config_id:
        statement = statement.where(TokenUsageSnapshot.ai_config_id == ai_config_id)
    rows = session.exec(statement).all()
    return rows

@router.get("/cards")
async def list_ai_cards(
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    ensure_default_ai_for_user(session, user.id)

    cfgs = session.exec(
        select(AssistantAIConfig)
        .where(AssistantAIConfig.user_id == user.id)
        .order_by(AssistantAIConfig.sort_order.asc(), AssistantAIConfig.created_at.asc())
    ).all()
    statuses = session.exec(
        select(AIRuntimeStatus).where(
            AIRuntimeStatus.user_id == user.id,
            AIRuntimeStatus.ai_kind == "assistant",
        )
    ).all()
    snapshots = session.exec(
        select(TokenUsageSnapshot).where(
            TokenUsageSnapshot.user_id == user.id,
            TokenUsageSnapshot.ai_kind == "assistant",
        )
    ).all()

    status_map = {row.ai_config_id: row for row in statuses if row.ai_config_id is not None}
    token_totals = {}
    for row in snapshots:
        if row.ai_config_id is None:
            continue
        token_totals[row.ai_config_id] = token_totals.get(row.ai_config_id, 0) + (row.total_tokens or 0)

    core_sessions = session.exec(
        select(ChatSession).where(
            ChatSession.user_id == user.id,
            ChatSession.ai_kind == "core",
        )
    ).all()
    latest_core_session_by_cfg: Dict[int, ChatSession] = {}
    for row in core_sessions:
        if row.ai_config_id is None:
            continue
        key = int(row.ai_config_id)
        prev = latest_core_session_by_cfg.get(key)
        if not prev or (row.updated_at or 0) > (prev.updated_at or 0):
            latest_core_session_by_cfg[key] = row

    core_messages = session.exec(
        select(ChatMessage).where(
            ChatMessage.user_id == user.id,
            ChatMessage.ai_kind == "core",
        )
    ).all()
    core_session_tokens: Dict[tuple[Optional[int], str], int] = {}
    for msg in core_messages:
        key = (msg.ai_config_id, msg.session_id)
        core_session_tokens[key] = core_session_tokens.get(key, 0) + int(msg.total_tokens or 0)
    core_task_tokens_by_prefix: Dict[tuple[int, str], int] = {}
    for (cfg_id, sid), total in core_session_tokens.items():
        if cfg_id is None:
            continue
        session_id = str(sid or "")
        if not session_id.startswith("session_task_"):
            continue
        session_prefix = session_id.split("_g")[0] if "_g" in session_id else session_id
        token_key = (int(cfg_id), session_prefix)
        core_task_tokens_by_prefix[token_key] = core_task_tokens_by_prefix.get(token_key, 0) + int(total or 0)

    active_runs = session.exec(
        select(ChatRun).where(
            ChatRun.user_id == user.id,
            ChatRun.status.in_(["queued", "running"]),
        ).order_by(ChatRun.updated_at.desc())
    ).all()
    active_run_map = {}
    for row in active_runs:
        key = (row.ai_config_id, row.ai_kind)
        if key not in active_run_map:
            active_run_map[key] = row

    recent_user_chat_cutoff = time.time() - 60
    recent_user_messages = session.exec(
        select(ChatMessage).where(
            ChatMessage.user_id == user.id,
            ChatMessage.role == "user",
            ChatMessage.created_at >= recent_user_chat_cutoff,
        ).order_by(ChatMessage.created_at.desc())
    ).all()
    recent_user_chat_map: Dict[tuple[Optional[int], str], ChatMessage] = {}
    for row in recent_user_messages:
        session_id = str(row.session_id or "")
        if session_id.startswith("session_task_"):
            continue
        key = (row.ai_config_id, row.ai_kind)
        if key not in recent_user_chat_map:
            recent_user_chat_map[key] = row

    task_jobs = session.exec(
        select(AITaskJob).where(
            AITaskJob.user_id == user.id,
        ).order_by(AITaskJob.created_at.desc())
    ).all()
    task_jobs_by_cfg: Dict[int, List[AITaskJob]] = {}
    for row in task_jobs:
        task_jobs_by_cfg.setdefault(int(row.ai_config_id), []).append(row)

    task_runs = session.exec(
        select(ChatRun).where(
            ChatRun.user_id == user.id,
            ChatRun.ai_kind == "core",
            ChatRun.session_id.like("session_task_%"),
        ).order_by(ChatRun.updated_at.desc())
    ).all()
    task_generations_by_prefix: Dict[str, set[int]] = {}
    task_active_status_by_prefix: Dict[str, str] = {}
    for row in task_runs:
        sid = str(row.session_id or "").strip()
        if not sid.startswith("session_task_"):
            continue
        session_prefix = sid.split("_g")[0] if "_g" in sid else sid
        generation = parse_generation_from_session_id(sid, 1)
        if generation <= 0:
            generation = 1
        if session_prefix not in task_generations_by_prefix:
            task_generations_by_prefix[session_prefix] = set()
        task_generations_by_prefix[session_prefix].add(generation)
        if session_prefix not in task_active_status_by_prefix and str(row.status or "") in {"queued", "running"}:
            task_active_status_by_prefix[session_prefix] = str(row.status or "")

    try:
        from api.routers.chat import _RUN_LIVE_STATE, _RUN_STATE_LOCK  # type: ignore
        with _RUN_STATE_LOCK:
            run_live_state = dict(_RUN_LIVE_STATE)
    except Exception:
        run_live_state = {}

    def _build_task_summary(job: AITaskJob, token_limit: int) -> Dict[str, Any]:
        session_prefix = f"session_task_{job.job_id}"
        generation_set = task_generations_by_prefix.get(session_prefix) or set()
        generation_count = len(generation_set)
        latest_generation = max(generation_set) if generation_set else 1
        run_status = str(task_active_status_by_prefix.get(session_prefix) or "")
        effective_status = str(job.status or "")
        if run_status in {"queued", "running"} and effective_status in {"queued", "running"}:
            effective_status = "running" if run_status == "running" else "queued"
        task_token_used = core_task_tokens_by_prefix.get((int(job.ai_config_id), session_prefix), 0)
        task_payload = decode_task_payload(job.task_payload)
        schedule = task_payload.get("schedule") if isinstance(task_payload, dict) else {}
        schedule = schedule if isinstance(schedule, dict) else {}
        try:
            schedule_at = float(schedule.get("schedule_at") or 0)
        except Exception:
            schedule_at = 0.0
        try:
            schedule_duration_minutes = int(schedule.get("duration_minutes") or 0)
        except Exception:
            schedule_duration_minutes = 0
        return {
            "job_id": job.job_id,
            "title": job.title,
            "status": job.status,
            "effective_status": effective_status,
            "run_status": run_status,
            "trigger_type": job.trigger_type,
            "schedule_enabled": bool(schedule.get("enabled")),
            "schedule_at": schedule_at if schedule_at > 0 else None,
            "schedule_loop_enabled": bool(schedule.get("loop_enabled")),
            "schedule_duration_minutes": schedule_duration_minutes,
            "generation_count": generation_count,
            "latest_generation": latest_generation,
            "task_token_used": int(task_token_used or 0),
            "task_token_limit": int(token_limit or 0),
            "created_at": job.created_at,
            "updated_at": job.updated_at,
            "started_at": job.started_at,
            "finished_at": job.finished_at,
        }

    def _task_activity_ts(item: Dict[str, Any]) -> float:
        for key in ("finished_at", "updated_at", "started_at", "created_at"):
            try:
                value = float(item.get(key) or 0)
            except Exception:
                value = 0.0
            if value > 0:
                return value
        return 0.0

    def _is_scheduled_task(item: Dict[str, Any]) -> bool:
        return (
            str(item.get("trigger_type") or "").lower() == "schedule"
            or bool(item.get("schedule_enabled"))
        )

    def _is_unfinished_task(item: Dict[str, Any]) -> bool:
        status = str(item.get("effective_status") or item.get("status") or "").lower()
        return status not in {"completed", "done", "finished", "cancelled", "stopped", "error"}

    def _scheduled_task_sort_key(item: Dict[str, Any]) -> tuple[float, float]:
        try:
            schedule_at = float(item.get("schedule_at") or 0)
        except Exception:
            schedule_at = 0.0
        return (schedule_at if schedule_at > 0 else float("inf"), -_task_activity_ts(item))

    def _build_feishu_status(cfg: AssistantAIConfig) -> Dict[str, str]:
        if str(cfg.bot_channel or "feishu").strip().lower() != "feishu":
            return {"status": "disabled", "mode": "off", "label": "未启用", "message": "当前机器人类型不是飞书"}
        if not cfg.feishu_enabled:
            return {"status": "disabled", "mode": "off", "label": "未启用", "message": "飞书机器人未启用"}
        app_id = str(cfg.feishu_app_id or "").strip()
        app_secret = str(cfg.feishu_app_secret or "").strip()
        webhook_url = str(cfg.feishu_webhook_url or "").strip()
        if app_id or app_secret:
            if not app_id or not app_secret:
                return {
                    "status": "failed",
                    "mode": "long_connection",
                    "label": "失败",
                    "message": "App ID / Secret 配置不完整",
                }
            state = get_feishu_long_connection_state(int(cfg.id or 0))
            return {
                "status": state.get("status") or "failed",
                "mode": "long_connection",
                "label": "成功" if state.get("status") == "success" else "失败",
                "message": state.get("message") or "",
            }
        if webhook_url:
            return {
                "status": "success",
                "mode": "webhook",
                "label": "成功",
                "message": "Webhook 发送配置已完成",
            }
        return {"status": "failed", "mode": "none", "label": "失败", "message": "未配置 App ID/Secret 或 Webhook URL"}

    def _build_qq_status(cfg: AssistantAIConfig) -> Dict[str, str]:
        if str(cfg.bot_channel or "feishu").strip().lower() != "qq":
            return {"status": "disabled", "mode": "off", "label": "未启用", "message": "当前机器人类型不是 QQ"}
        if not cfg.qq_enabled:
            return {"status": "disabled", "mode": "off", "label": "未启用", "message": "QQ机器人未启用"}
        app_id = str(cfg.qq_app_id or "").strip()
        app_secret = str(cfg.qq_app_secret or "").strip()
        if not app_id or not app_secret:
            return {
                "status": "failed",
                "mode": "webhook",
                "label": "失败",
                "message": "App ID / Secret 配置不完整",
            }
        mode = "sandbox_webhook" if bool(cfg.qq_sandbox) else "webhook"
        return {
            "status": "pending",
            "mode": mode,
            "label": "待回调",
            "message": "QQ 使用 Webhook 回调，不会建立长连接；接收消息需要在 QQ 开放平台配置公网 HTTPS 回调 /api/qq/events/{AI配置ID}，端口只能使用 80、443、8080、8443，并订阅 C2C/群聊/频道消息事件",
        }

    cards = []
    for cfg in cfgs:
        status = status_map.get(cfg.id)
        token_used = token_totals.get(cfg.id, 0)
        if cfg.ai_role == "digital_member":
            latest_session = latest_core_session_by_cfg.get(int(cfg.id))
            if latest_session:
                token_used = core_session_tokens.get((cfg.id, latest_session.session_id), 0)
            else:
                token_used = 0
        ai_kind = "assistant" if cfg.ai_role == "assistant_admin" else "core"
        active_run = active_run_map.get((cfg.id, ai_kind))
        recent_user_chat = recent_user_chat_map.get((cfg.id, ai_kind))
        run_live = run_live_state.get(active_run.run_id, {}) if active_run else {}
        active_run_session_id = str(active_run.session_id or "") if active_run else ""
        is_task_run_active = active_run_session_id.startswith("session_task_")
        user_chat_active = bool(active_run and not is_task_run_active)
        recent_user_chat_active = bool(recent_user_chat)
        live_token_pending = int(run_live.get("pending_total_tokens") or 0)
        token_used = int(token_used or 0) + live_token_pending
        live_text = str(run_live.get("text") or "")
        live_reasoning = str(run_live.get("reasoning") or "")
        live_tool = str(run_live.get("current_tool") or "").strip()
        cfg_task_jobs = task_jobs_by_cfg.get(int(cfg.id), [])
        cfg_task_summaries = [_build_task_summary(job, int(cfg.token_limit or 0)) for job in cfg_task_jobs]
        cfg_task_summaries_by_activity = sorted(
            cfg_task_summaries,
            key=_task_activity_ts,
            reverse=True,
        )
        current_task = next(
            (
                item for item in cfg_task_summaries_by_activity
                if str(item.get("effective_status") or "").lower() == "running"
            ),
            None,
        )
        if current_task is None:
            current_task = next(
                (
                    item for item in cfg_task_summaries_by_activity
                    if str(item.get("effective_status") or "").lower() in {"queued", "paused"}
                    and not _is_scheduled_task(item)
                ),
                None,
            )
        latest_completed_task = next(
            (
                item for item in cfg_task_summaries_by_activity
                if str(item.get("effective_status") or "").lower() in {"completed", "done", "finished"}
            ),
            None,
        )
        scheduled_tasks = [
            item for item in cfg_task_summaries_by_activity
            if _is_scheduled_task(item)
            and _is_unfinished_task(item)
            and (not current_task or item.get("job_id") != current_task.get("job_id"))
        ]
        scheduled_tasks = sorted(scheduled_tasks, key=_scheduled_task_sort_key)[:3]
        current_or_recent_task = current_task or latest_completed_task
        current_task_title = str(current_task.get("title") or "") if current_task else ""
        current_task_status = str(current_task.get("effective_status") or "idle") if current_task else "idle"
        feishu_status = _build_feishu_status(cfg)
        qq_status = _build_qq_status(cfg)
        bot_channel = str(cfg.bot_channel or "feishu")
        cards.append(
            {
                "id": cfg.id,
                "name": cfg.name,
                "description": cfg.description,
                "model": cfg.model,
                "ai_role": cfg.ai_role,
                "digital_member_role": cfg.digital_member_role,
                "platform": cfg.platform,
                "generation": cfg.generation,
                "token_limit": cfg.token_limit,
                "token_used": token_used,
                "token_live_pending": live_token_pending,
                "lifecycle_status": cfg.lifecycle_status,
                "current_behavior": cfg.current_behavior,
                "workspace_root": cfg.workspace_root,
                "database_uri": cfg.database_uri,
                "project_id": cfg.project_id,
                "project_name": cfg.project_name,
                "parent_ai_config_id": cfg.parent_ai_config_id,
                "root_manager_ai_config_id": cfg.root_manager_ai_config_id,
                "management_scope": cfg.management_scope,
                "enabled": cfg.enabled,
                "mcp_enabled": cfg.mcp_enabled,
                "bot_channel": bot_channel,
                "feishu_enabled": cfg.feishu_enabled,
                "feishu_webhook_url": cfg.feishu_webhook_url,
                "feishu_app_id": cfg.feishu_app_id,
                "feishu_default_receive_id": cfg.feishu_default_receive_id,
                "feishu_default_receive_id_type": cfg.feishu_default_receive_id_type,
                "feishu_status": feishu_status,
                "qq_enabled": cfg.qq_enabled,
                "qq_app_id": cfg.qq_app_id,
                "qq_sandbox": cfg.qq_sandbox,
                "qq_default_target_id": cfg.qq_default_target_id,
                "qq_default_target_type": cfg.qq_default_target_type,
                "qq_status": qq_status,
                "bot_enabled": cfg.qq_enabled if bot_channel == "qq" else cfg.feishu_enabled,
                "bot_status": qq_status if bot_channel == "qq" else feishu_status,
                "switch_key": cfg.switch_key,
                "mcp_tools": cfg.mcp_tools,
                "system_auto_control": cfg.system_auto_control,
                "runtime_status": status.current_status if status else "idle",
                "runtime_tool": status.current_mcp_tool if status else "",
                "latest_mcp_tool": live_tool or (status.current_mcp_tool if status else ""),
                "active_run_status": str(active_run.status or "") if active_run else "",
                "active_run_phase": str(run_live.get("phase") or "idle") if active_run else "idle",
                "active_run_session_id": active_run_session_id,
                "user_chat_active": user_chat_active,
                "recent_user_chat_active": recent_user_chat_active,
                "recent_user_chat_at": recent_user_chat.created_at if recent_user_chat else None,
                "current_task_title": current_task_title,
                "current_task_status": current_task_status,
                "task_current": current_task,
                "task_current_or_recent": current_or_recent_task,
                "task_recent_completed": latest_completed_task,
                "task_scheduled_tasks": scheduled_tasks,
                "latest_thinking": live_reasoning or live_text,
            }
        )
    return cards

@router.post("/sessions")
async def create_session(
    body: ChatSessionCreate,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    new_id = f"session_{int(time.time() * 1000)}"
    row = ChatSession(
        user_id=user.id,
        ai_config_id=body.ai_config_id,
        ai_kind=body.ai_kind,
        session_id=new_id,
        session_name=body.session_name,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row

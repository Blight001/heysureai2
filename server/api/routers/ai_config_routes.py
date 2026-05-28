IS_ROUTER_ENTRY = False

import time
from typing import Optional

from fastapi import Depends, Header, HTTPException
from sqlmodel import Session, select

from api.bots import all_channels, iter_bots
from api.database import get_session
from api.mcp.permissions import clamp_tools_json, config_role_tier
from api.models import (
    AIRuntimeStatus,
    AssistantAIConfig,
    AssistantAIConfigCreate,
    AssistantAIConfigUpdate,
)
from api.routers.auth import get_current_user
from api.services.ai_service import ensure_default_ai_for_user
from api.services.model_presets import normalize_model_presets
from api.services.task_system import normalize_workspace_root
from .ai_base import (
    _default_system_auto_control_for_user,
    _normalize_ai_role,
    _normalize_digital_member_role,
    router,
)


def _normalize_bot_channel(value) -> str:
    """Snap an incoming ``bot_channel`` to a registered bot, defaulting to ``feishu``."""
    channel = str(value or "feishu").strip().lower()
    return channel if channel in set(all_channels()) else "feishu"


def _restart_all_bot_long_connections() -> None:
    """Best-effort kick every registered bot's long-connection client.

    Each adapter is idempotent — already-running clients just reload their
    config; missing clients spin up.
    """
    for bot in iter_bots():
        try:
            bot.start_long_connections()
        except Exception as exc:
            print(f"[start_{bot.channel}_long_connection_clients] {exc}")


def _resolve_config_model_fields(user, preset_id: Optional[str], fallback_model: Optional[str] = None) -> dict:
    presets = normalize_model_presets(getattr(user, "model_presets", ""), user)
    requested_id = str(preset_id or "").strip()
    selected = None
    if requested_id:
        selected = next((item for item in presets if item["id"] == requested_id), None)
    if selected is None and fallback_model:
        model_name = str(fallback_model or "").strip()
        selected = next((item for item in presets if item["model"] == model_name or item["id"] == model_name), None)
    if selected is None and presets and not requested_id:
        selected = presets[0]
    if selected is None:
        raise HTTPException(status_code=400, detail="Selected model preset not found")
    return {
        "api_key": selected["api_key"],
        "base_url": selected["base_url"],
        "model": selected["model"],
        "model_preset_id": selected["id"],
    }


@router.get("/configs")
async def list_ai_configs(
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    ensure_default_ai_for_user(session, user.id)
    rows = session.exec(
        select(AssistantAIConfig)
        .where(AssistantAIConfig.user_id == user.id)
        .order_by(AssistantAIConfig.sort_order.asc(), AssistantAIConfig.created_at.asc())
    ).all()
    return rows

@router.post("/configs")
async def create_ai_config(
    body: AssistantAIConfigCreate,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    switch_key = body.switch_key or f"assistant_{int(time.time() * 1000)}"
    role = _normalize_ai_role(body.ai_role)
    member_role = _normalize_digital_member_role(body.digital_member_role)
    token_limit = 0 if role == "assistant_admin" else (body.token_limit or 10000)
    workspace_root = normalize_workspace_root(body.workspace_root)
    if role == "assistant_admin" and workspace_root is None:
        workspace_root = "."
    bot_channel = _normalize_bot_channel(body.bot_channel)
    model_fields = _resolve_config_model_fields(user, body.model_preset_id, body.model)
    raw_mcp_tools = body.mcp_tools or AssistantAIConfig.model_fields["mcp_tools"].default
    tier = config_role_tier(
        AssistantAIConfig(ai_role=role, digital_member_role=member_role)
    )
    clamped_mcp_tools = clamp_tools_json(user, tier, raw_mcp_tools)
    cfg = AssistantAIConfig(
        user_id=user.id,
        name=body.name,
        description=body.description or "",
        api_key=model_fields["api_key"],
        base_url=model_fields["base_url"],
        model=model_fields["model"],
        model_preset_id=model_fields["model_preset_id"],
        prompt=body.prompt or "",
        strip_markdown_symbols=bool(body.strip_markdown_symbols),
        ai_role=role,
        digital_member_role=member_role,
        platform=body.platform or "Server-Core",
        generation=body.generation or 1,
        token_limit=token_limit,
        lifecycle_status=body.lifecycle_status or "working",
        current_behavior=body.current_behavior or "等待指令...",
        workspace_root=workspace_root,
        database_uri=body.database_uri,
        bot_channel=bot_channel,
        feishu_enabled=bool(body.feishu_enabled) and bot_channel == "feishu",
        feishu_webhook_url=body.feishu_webhook_url or "",
        feishu_app_id=body.feishu_app_id or "",
        feishu_app_secret=body.feishu_app_secret or "",
        feishu_verification_token=body.feishu_verification_token or "",
        feishu_default_receive_id=body.feishu_default_receive_id or "",
        feishu_default_receive_id_type=body.feishu_default_receive_id_type or "chat_id",
        qq_enabled=bool(body.qq_enabled) and bot_channel == "qq",
        qq_app_id=body.qq_app_id or "",
        qq_app_secret=body.qq_app_secret or "",
        qq_sandbox=body.qq_sandbox if body.qq_sandbox is not None else False,
        qq_default_target_id=body.qq_default_target_id or "",
        qq_default_target_type=body.qq_default_target_type or "c2c",
        project_id=body.project_id,
        project_name=body.project_name,
        sort_order=body.sort_order or 100,
        enabled=body.enabled if body.enabled is not None else True,
        mcp_enabled=body.mcp_enabled if body.mcp_enabled is not None else True,
        switch_key=switch_key,
        mcp_tools=clamped_mcp_tools,
        system_auto_control=body.system_auto_control or _default_system_auto_control_for_user(user),
    )
    session.add(cfg)
    session.commit()
    session.refresh(cfg)
    _restart_all_bot_long_connections()
    return cfg

@router.put("/configs/{config_id}")
async def update_ai_config(
    config_id: int,
    body: AssistantAIConfigUpdate,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    cfg = session.get(AssistantAIConfig, config_id)
    if not cfg or cfg.user_id != user.id:
        raise HTTPException(status_code=404, detail="AI config not found")
    updates = body.model_dump(exclude_unset=True)
    if "model_preset_id" in updates or "model" in updates:
        updates.update(
            _resolve_config_model_fields(
                user,
                updates.get("model_preset_id", cfg.model_preset_id),
                updates.get("model", cfg.model),
            )
        )
    if "bot_channel" in updates:
        updates["bot_channel"] = _normalize_bot_channel(updates.get("bot_channel"))
    next_bot_channel = updates.get("bot_channel", cfg.bot_channel)
    # Switching channels must mutually-exclude every other registered bot
    # so two backends never fight over the same AI config.
    for bot in iter_bots():
        if bot.channel != next_bot_channel:
            bot.disable_in_config_updates(updates)
    if "ai_role" in updates:
        updates["ai_role"] = _normalize_ai_role(updates.get("ai_role"))
    next_ai_role = updates.get("ai_role", cfg.ai_role)
    if "digital_member_role" in updates or next_ai_role == "digital_member":
        updates["digital_member_role"] = _normalize_digital_member_role(
            updates.get("digital_member_role", cfg.digital_member_role)
        )
    if next_ai_role == "assistant_admin":
        updates["token_limit"] = 0
        if "workspace_root" not in updates or not updates.get("workspace_root"):
            updates["workspace_root"] = "."
    for key, value in updates.items():
        if key == "workspace_root":
            value = normalize_workspace_root(value)
        setattr(cfg, key, value)
    # Narrow the saved tool set to what this AI's role tier is permitted to use.
    cfg.mcp_tools = clamp_tools_json(user, config_role_tier(cfg), cfg.mcp_tools)
    cfg.updated_at = time.time()
    session.add(cfg)
    session.commit()
    session.refresh(cfg)
    _restart_all_bot_long_connections()

    status = session.exec(
        select(AIRuntimeStatus).where(
            AIRuntimeStatus.user_id == user.id,
            AIRuntimeStatus.ai_config_id == cfg.id,
            AIRuntimeStatus.ai_kind == "assistant",
        )
    ).first()
    if not status:
        status = AIRuntimeStatus(user_id=user.id, ai_config_id=cfg.id, ai_kind="assistant")
    status.running = cfg.enabled
    status.mcp_enabled = cfg.mcp_enabled
    status.updated_at = time.time()
    session.add(status)
    session.commit()
    return cfg

@router.post("/configs/{config_id}/toggle-run")
async def toggle_ai_run(
    config_id: int,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    cfg = session.get(AssistantAIConfig, config_id)
    if not cfg or cfg.user_id != user.id:
        raise HTTPException(status_code=404, detail="AI config not found")
    cfg.enabled = not cfg.enabled
    cfg.updated_at = time.time()
    session.add(cfg)
    status = session.exec(
        select(AIRuntimeStatus).where(
            AIRuntimeStatus.user_id == user.id,
            AIRuntimeStatus.ai_config_id == cfg.id,
            AIRuntimeStatus.ai_kind == "assistant",
        )
    ).first()
    if not status:
        status = AIRuntimeStatus(user_id=user.id, ai_config_id=cfg.id, ai_kind="assistant")
    status.running = cfg.enabled
    status.updated_at = time.time()
    session.add(status)
    session.commit()
    return cfg

def _compute_root_manager(session: Session, user_id: int, cfg: AssistantAIConfig) -> int:
    seen = set()
    current = cfg
    root_id = int(current.id or 0)
    while current and current.parent_ai_config_id is not None:
        pid = int(current.parent_ai_config_id)
        if pid in seen:
            break
        seen.add(pid)
        parent = session.exec(
            select(AssistantAIConfig).where(
                AssistantAIConfig.user_id == user_id,
                AssistantAIConfig.id == pid,
            )
        ).first()
        if not parent:
            break
        root_id = int(parent.id or 0)
        current = parent
    return root_id


@router.post("/configs/{config_id}/bind-parent")
async def bind_ai_parent(
    config_id: int,
    body: dict,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    cfg = session.get(AssistantAIConfig, config_id)
    if not cfg or cfg.user_id != user.id:
        raise HTTPException(status_code=404, detail="AI config not found")
    raw_parent = body.get("parent_ai_config_id") if isinstance(body, dict) else None
    if raw_parent is None:
        raise HTTPException(status_code=400, detail="parent_ai_config_id is required")
    try:
        parent_id = int(raw_parent)
    except Exception:
        raise HTTPException(status_code=400, detail="parent_ai_config_id must be an integer")
    if parent_id == config_id:
        raise HTTPException(status_code=400, detail="An AI cannot be its own parent")
    parent = session.get(AssistantAIConfig, parent_id)
    if not parent or parent.user_id != user.id:
        raise HTTPException(status_code=404, detail="Parent AI config not found")

    # Cycle guard: walking up from the prospective parent must not reach config_id.
    cursor = parent
    seen = set()
    while cursor and cursor.parent_ai_config_id is not None:
        pid = int(cursor.parent_ai_config_id)
        if pid == config_id:
            raise HTTPException(status_code=400, detail="Binding would create a management cycle")
        if pid in seen:
            break
        seen.add(pid)
        cursor = session.get(AssistantAIConfig, pid)

    cfg.parent_ai_config_id = parent_id
    cfg.root_manager_ai_config_id = _compute_root_manager(session, user.id, cfg)
    if str(cfg.management_scope or "self") == "self":
        cfg.management_scope = "children"
    # Ensure the parent can manage children by default.
    if str(parent.management_scope or "self") == "self":
        parent.management_scope = "children"
        session.add(parent)
    cfg.updated_at = time.time()
    session.add(cfg)
    session.commit()
    session.refresh(cfg)
    return cfg


@router.post("/configs/{config_id}/unbind-parent")
async def unbind_ai_parent(
    config_id: int,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    cfg = session.get(AssistantAIConfig, config_id)
    if not cfg or cfg.user_id != user.id:
        raise HTTPException(status_code=404, detail="AI config not found")
    cfg.parent_ai_config_id = None
    cfg.root_manager_ai_config_id = int(cfg.id or 0)
    cfg.updated_at = time.time()
    session.add(cfg)
    session.commit()
    session.refresh(cfg)
    return cfg


@router.get("/governance/tree")
async def get_governance_tree(
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    rows = session.exec(
        select(AssistantAIConfig)
        .where(AssistantAIConfig.user_id == user.id)
        .order_by(AssistantAIConfig.sort_order.asc(), AssistantAIConfig.created_at.asc())
    ).all()
    children_by_parent: dict[int, list] = {}
    nodes = {}
    for cfg in rows:
        nodes[int(cfg.id or 0)] = {
            "ai_config_id": int(cfg.id or 0),
            "name": cfg.name,
            "ai_role": cfg.ai_role,
            "digital_member_role": cfg.digital_member_role,
            "parent_ai_config_id": cfg.parent_ai_config_id,
            "management_scope": cfg.management_scope,
            "project_id": cfg.project_id,
            "children": [],
        }
    roots = []
    for cfg in rows:
        node = nodes[int(cfg.id or 0)]
        pid = cfg.parent_ai_config_id
        if pid is not None and int(pid) in nodes:
            nodes[int(pid)]["children"].append(node)
        else:
            roots.append(node)
    return {"roots": roots, "count": len(rows)}


@router.post("/configs/{config_id}/clone")
async def clone_ai_config(
    config_id: int,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    src = session.get(AssistantAIConfig, config_id)
    if not src or src.user_id != user.id:
        raise HTTPException(status_code=404, detail="AI config not found")
    new_cfg = AssistantAIConfig(
        user_id=user.id,
        name=f"{src.name} (副本)",
        description=src.description,
        api_key=src.api_key,
        base_url=src.base_url,
        model=src.model,
        model_preset_id=src.model_preset_id,
        prompt=src.prompt,
        ai_role=src.ai_role,
        digital_member_role=src.digital_member_role,
        platform=src.platform,
        generation=src.generation,
        token_limit=src.token_limit,
        lifecycle_status=src.lifecycle_status,
        current_behavior="等待指令...",
        workspace_root=src.workspace_root,
        database_uri=src.database_uri,
        bot_channel="feishu",
        feishu_enabled=False,
        qq_enabled=False,
        project_id=src.project_id,
        project_name=src.project_name,
        parent_ai_config_id=src.parent_ai_config_id,
        management_scope=src.management_scope,
        sort_order=(src.sort_order or 100) + 1,
        enabled=False,
        mcp_enabled=src.mcp_enabled,
        switch_key=f"assistant_{int(time.time() * 1000)}",
        mcp_tools=clamp_tools_json(user, config_role_tier(src), src.mcp_tools),
        system_auto_control=src.system_auto_control,
    )
    session.add(new_cfg)
    session.commit()
    session.refresh(new_cfg)
    return new_cfg


@router.post("/configs/{config_id}/toggle-mcp")
async def toggle_ai_mcp(
    config_id: int,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    cfg = session.get(AssistantAIConfig, config_id)
    if not cfg or cfg.user_id != user.id:
        raise HTTPException(status_code=404, detail="AI config not found")
    cfg.mcp_enabled = not cfg.mcp_enabled
    cfg.updated_at = time.time()
    session.add(cfg)
    status = session.exec(
        select(AIRuntimeStatus).where(
            AIRuntimeStatus.user_id == user.id,
            AIRuntimeStatus.ai_config_id == cfg.id,
            AIRuntimeStatus.ai_kind == "assistant",
        )
    ).first()
    if not status:
        status = AIRuntimeStatus(user_id=user.id, ai_config_id=cfg.id, ai_kind="assistant")
    status.mcp_enabled = cfg.mcp_enabled
    status.updated_at = time.time()
    session.add(status)
    session.commit()
    return cfg

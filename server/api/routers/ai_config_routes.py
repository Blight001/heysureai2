IS_ROUTER_ENTRY = False

import time

from fastapi import Depends, Header, HTTPException
from sqlmodel import Session, select

from api.ai_service import ensure_default_ai_for_user, sync_switch_file
from api.database import get_session
from api.feishu_long_connection import start_feishu_long_connection_clients
from api.models import (
    AIRuntimeStatus,
    AssistantAIConfig,
    AssistantAIConfigCreate,
    AssistantAIConfigUpdate,
)
from api.routers.auth import get_current_user
from api.task_system import normalize_workspace_root
from .ai_base import (
    _default_system_auto_control_for_user,
    _normalize_ai_role,
    _normalize_digital_member_role,
    router,
)


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
    cfg = AssistantAIConfig(
        user_id=user.id,
        name=body.name,
        description=body.description or "",
        api_key=body.api_key or "",
        base_url=body.base_url or "",
        model=body.model or "",
        prompt=body.prompt or "",
        ai_role=role,
        digital_member_role=member_role,
        platform=body.platform or "Server-Core",
        generation=body.generation or 1,
        token_limit=token_limit,
        lifecycle_status=body.lifecycle_status or "working",
        current_behavior=body.current_behavior or "等待指令...",
        workspace_root=workspace_root,
        database_uri=body.database_uri,
        feishu_enabled=bool(body.feishu_enabled),
        feishu_webhook_url=body.feishu_webhook_url or "",
        feishu_app_id=body.feishu_app_id or "",
        feishu_app_secret=body.feishu_app_secret or "",
        feishu_verification_token=body.feishu_verification_token or "",
        feishu_default_receive_id=body.feishu_default_receive_id or "",
        feishu_default_receive_id_type=body.feishu_default_receive_id_type or "chat_id",
        project_id=body.project_id,
        project_name=body.project_name,
        sort_order=body.sort_order or 100,
        enabled=body.enabled if body.enabled is not None else True,
        mcp_enabled=body.mcp_enabled if body.mcp_enabled is not None else True,
        switch_key=switch_key,
        mcp_tools=body.mcp_tools or AssistantAIConfig.model_fields["mcp_tools"].default,
        system_auto_control=body.system_auto_control or _default_system_auto_control_for_user(user),
    )
    session.add(cfg)
    session.commit()
    session.refresh(cfg)
    sync_switch_file(user.id, cfg.switch_key, cfg.enabled, cfg.mcp_enabled)
    if cfg.feishu_enabled:
        try:
            start_feishu_long_connection_clients()
        except Exception as exc:
            print(f"[start_feishu_long_connection_clients] {exc}")
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
    cfg.updated_at = time.time()
    session.add(cfg)
    session.commit()
    session.refresh(cfg)
    if cfg.feishu_enabled:
        try:
            start_feishu_long_connection_clients()
        except Exception as exc:
            print(f"[start_feishu_long_connection_clients] {exc}")

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
    sync_switch_file(user.id, cfg.switch_key, cfg.enabled, cfg.mcp_enabled)
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
    sync_switch_file(user.id, cfg.switch_key, cfg.enabled, cfg.mcp_enabled)
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
    sync_switch_file(user.id, cfg.switch_key, cfg.enabled, cfg.mcp_enabled)
    return cfg

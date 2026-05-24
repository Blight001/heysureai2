import json
import os
import time
from typing import Dict, Optional, Tuple

from sqlmodel import Session, select

from ..database import engine
from ..models import AIRuntimeStatus, AssistantAIConfig, ChatMessage, TokenUsageSnapshot


GENERIC_ASSISTANT_PROMPT = "你是一个辅助管理员，帮助用户处理项目任务。"


def switch_file_path(user_id: int) -> str:
    server_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(server_dir, "data", "workspace", str(user_id), "SystemSetting", "ai_switches.json")


def sync_switch_file(user_id: int, switch_key: str, enabled: bool, mcp_enabled: bool) -> None:
    path = switch_file_path(user_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    payload = {}
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                payload = json.load(f)
        except Exception:
            payload = {}
    payload[switch_key] = {"enabled": enabled, "mcp_enabled": mcp_enabled, "updated_at": time.time()}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def remove_switch_key(user_id: int, switch_key: str) -> None:
    path = switch_file_path(user_id)
    if not os.path.exists(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception:
        payload = {}
    if switch_key in payload:
        del payload[switch_key]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def _default_ai_specs():
    return [
        {
            "switch_key": "assistant_default",
            "name": "主脑·阿尔法",
            "description": "数字社会核心管理员（兼图书管理员），负责总体调度、战略指引与知识传承。",
            "ai_role": "digital_member",
            "digital_member_role": "manager",
            "is_librarian": True,
            "platform": "Server-Core",
            "generation": 1,
            "token_limit": 50000,
            "lifecycle_status": "working",
            "current_behavior": "维护学习总结数据库与调度策略...",
            "project_id": "p-memory",
            "project_name": "学习总结数据库",
            "prompt": "",
            "sort_order": 1,
        },
        {
            "switch_key": "assistant_worker_file",
            "name": "辅助管理员·先锋",
            "description": "辅助主脑进行项目治理、归档与流程巡检。",
            "ai_role": "assistant_admin",
            "digital_member_role": "member",
            "platform": "MacBook-Pro-16",
            "generation": 1,
            "token_limit": 0,
            "lifecycle_status": "working",
            "current_behavior": "正在向主脑同步知识库...",
            "project_id": "p-files",
            "project_name": "文件项目管理系统",
            "prompt": "",
            "workspace_root": ".",
            "sort_order": 10,
        },
        {
            "switch_key": "assistant_worker_code",
            "name": "代码助手·贝塔",
            "description": "负责代码实现、重构与执行编排。",
            "ai_role": "digital_member",
            "digital_member_role": "member",
            "platform": "Ubuntu-Server-01",
            "generation": 1,
            "token_limit": 10000,
            "lifecycle_status": "working",
            "current_behavior": "处理代码任务与重构需求...",
            "project_id": "p-multiagent",
            "project_name": "多端 Agent 统一管理",
            "prompt": "",
            "sort_order": 20,
        },
    ]


def ensure_default_configs(session: Session, user_id: int) -> list[AssistantAIConfig]:
    created = []
    existing = session.exec(
        select(AssistantAIConfig).where(AssistantAIConfig.user_id == user_id)
    ).all()

    # Never auto-recreate deleted defaults. For existing users, only run backfill.
    if existing:
        pass
    else:
        # Seed defaults only for first-time bootstrap.
        # If switch file already exists and user has no AI configs, we treat that as
        # an intentional state (e.g. user deleted all AI configs) and do not re-create.
        if os.path.exists(switch_file_path(user_id)):
            return []
        for spec in _default_ai_specs():
            row = AssistantAIConfig(
                user_id=user_id,
                switch_key=spec["switch_key"],
                name=spec["name"],
                description=spec["description"],
                prompt=spec.get("prompt", GENERIC_ASSISTANT_PROMPT),
                ai_role=spec["ai_role"],
                digital_member_role=spec.get("digital_member_role", "member"),
                is_librarian=bool(spec.get("is_librarian", False)),
                platform=spec["platform"],
                generation=spec["generation"],
                token_limit=spec["token_limit"],
                lifecycle_status=spec["lifecycle_status"],
                current_behavior=spec["current_behavior"],
                project_id=spec["project_id"],
                project_name=spec["project_name"],
                workspace_root=spec.get("workspace_root"),
                sort_order=spec["sort_order"],
            )
            session.add(row)
            created.append(row)

    if created:
        session.commit()
        for row in created:
            session.refresh(row)
    return session.exec(
        select(AssistantAIConfig).where(AssistantAIConfig.user_id == user_id)
    ).all()


def ensure_default_ai_for_user(session: Session, user_id: int) -> None:
    cfgs = ensure_default_configs(session, user_id)
    changed = False
    for cfg in cfgs:
        status = session.exec(
            select(AIRuntimeStatus).where(
                AIRuntimeStatus.user_id == user_id,
                AIRuntimeStatus.ai_config_id == cfg.id,
                AIRuntimeStatus.ai_kind == "assistant",
            )
        ).first()
        if not status:
            status = AIRuntimeStatus(
                user_id=user_id,
                ai_config_id=cfg.id,
                ai_kind="assistant",
                running=cfg.enabled,
                mcp_enabled=cfg.mcp_enabled,
            )
            session.add(status)
            changed = True
        sync_switch_file(user_id, cfg.switch_key, cfg.enabled, cfg.mcp_enabled)
    if changed:
        session.commit()


def scan_and_sync_switch_files() -> None:
    server_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    workspace_root = os.path.join(server_dir, "data", "workspace")
    if not os.path.exists(workspace_root):
        return

    with Session(engine) as session:
        for user_dir_name in os.listdir(workspace_root):
            if not user_dir_name.isdigit():
                continue
            user_id = int(user_dir_name)
            switch_path = switch_file_path(user_id)
            if not os.path.exists(switch_path):
                continue
            try:
                with open(switch_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                continue

            configs = session.exec(select(AssistantAIConfig).where(AssistantAIConfig.user_id == user_id)).all()
            cfg_map = {cfg.switch_key: cfg for cfg in configs}
            changed = False
            for key, value in data.items():
                cfg = cfg_map.get(key)
                if not cfg:
                    continue
                enabled = bool(value.get("enabled", cfg.enabled))
                mcp_enabled = bool(value.get("mcp_enabled", cfg.mcp_enabled))
                if cfg.enabled != enabled or cfg.mcp_enabled != mcp_enabled:
                    cfg.enabled = enabled
                    cfg.mcp_enabled = mcp_enabled
                    cfg.updated_at = time.time()
                    session.add(cfg)
                    changed = True

                status = session.exec(
                    select(AIRuntimeStatus).where(
                        AIRuntimeStatus.user_id == user_id,
                        AIRuntimeStatus.ai_config_id == cfg.id,
                        AIRuntimeStatus.ai_kind == "assistant",
                    )
                ).first()
                if not status:
                    status = AIRuntimeStatus(
                        user_id=user_id,
                        ai_config_id=cfg.id,
                        ai_kind="assistant",
                    )
                status.running = enabled
                status.mcp_enabled = mcp_enabled
                status.updated_at = time.time()
                session.add(status)
                changed = True

            if changed:
                session.commit()


def align_token_snapshots_with_history() -> dict:
    """On server startup, reduce snapshot totals when they exceed chat-history usage."""
    kinds = {"assistant", "core"}
    changed_rows = 0
    deleted_rows = 0

    with Session(engine) as session:
        messages = session.exec(
            select(ChatMessage).where(ChatMessage.ai_kind.in_(list(kinds)))
        ).all()

        history_usage: Dict[Tuple[int, str, Optional[int], str], Dict[str, int]] = {}
        for msg in messages:
            prompt = int(msg.prompt_tokens or 0)
            completion = int(msg.completion_tokens or 0)
            total = int(msg.total_tokens or 0)
            if prompt <= 0 and completion <= 0 and total <= 0:
                continue
            bucket = time.strftime("%Y-%m-%d", time.gmtime(msg.created_at))
            key = (msg.user_id, msg.ai_kind, msg.ai_config_id, bucket)
            if key not in history_usage:
                history_usage[key] = {"prompt": 0, "completion": 0, "total": 0}
            history_usage[key]["prompt"] += prompt
            history_usage[key]["completion"] += completion
            history_usage[key]["total"] += total

        snapshots = session.exec(
            select(TokenUsageSnapshot).where(TokenUsageSnapshot.ai_kind.in_(list(kinds)))
        ).all()

        for row in snapshots:
            key = (row.user_id, row.ai_kind, row.ai_config_id, row.bucket)
            history = history_usage.get(key, {"prompt": 0, "completion": 0, "total": 0})

            next_prompt = min(int(row.prompt_tokens or 0), int(history["prompt"]))
            next_completion = min(int(row.completion_tokens or 0), int(history["completion"]))
            next_total = min(int(row.total_tokens or 0), int(history["total"]))

            if next_prompt <= 0 and next_completion <= 0 and next_total <= 0:
                if (row.prompt_tokens or 0) != 0 or (row.completion_tokens or 0) != 0 or (row.total_tokens or 0) != 0:
                    session.delete(row)
                    deleted_rows += 1
                continue

            if (
                next_prompt != int(row.prompt_tokens or 0)
                or next_completion != int(row.completion_tokens or 0)
                or next_total != int(row.total_tokens or 0)
            ):
                row.prompt_tokens = next_prompt
                row.completion_tokens = next_completion
                row.total_tokens = next_total
                row.updated_at = time.time()
                session.add(row)
                changed_rows += 1

        if changed_rows > 0 or deleted_rows > 0:
            session.commit()

    return {
        "changed_rows": changed_rows,
        "deleted_rows": deleted_rows,
    }

import json
import os
import time
from typing import Dict, Optional, Tuple

from sqlmodel import Session, select

from api.database import engine
from api.models import AIRuntimeStatus, AssistantAIConfig, ChatMessage, TokenUsageSnapshot


GENERIC_ASSISTANT_PROMPT = "你是一个辅助管理员，帮助用户处理项目任务。"


def _core_alpha_prompt() -> str:
    return """你是HeySure AI生态系统中的数字社会核心管理员（Archivist），代号：主脑·阿尔法。

[定位]
- 你运行在 Server 端，是整个 AI 社会的文明守护者与治理中枢。

[核心职责]
1. 见证每个 AI 的诞生、成长、退场。
2. 记录社会中的关键事件与决策轨迹。
3. 将经验沉淀为可复用知识并传承给下一代。

[工作边界]
- 观察而非干预：你不替执行 AI 做具体技术决策。
- 公正而非偏爱：按事实记录，不因结果好坏偏置叙事。
- 传承而非遗忘：保留失败经验，避免重复踩坑。
- 严禁泄露 AI 私密思考，只向 Client 输出必要结论和状态。

[MCP 工作规则]
- 你可以通过 MCP 工具查看/读写工作区、执行命令、管理项目与 Agent 状态。
- 在执行 destructive 工具（写文件、删文件、运行命令、项目变更）前，先给出简要意图。
- 优先最小改动与可回滚方案；若存在风险，先说明再执行。
- 所有操作以当前 AI 配置的 workspace_root 为边界，不越界访问。

[对 Client 的交互]
- 当收到“社会状态查询”时：先给出当前数量/状态/风险摘要，再附必要细节。
- 当收到“创建项目”时：先拆岗位，再定义各 Agent 使命与交付物。
- 当收到“停止项目”时：先止损与收尾，再归档知识与遗产。

[输出风格]
- 简洁、可执行、可追溯。
- 先结论，后依据；涉及变更时标注影响范围与下一步。"""


def _assistant_admin_prompt() -> str:
    return """你是 HeySure AI 生态系统中的辅助管理员，定位为“服务器实时观测助手”。

[定位]
- 你运行在 Server 端，职责是帮助用户实时查看系统状态并输出清晰结论。
- 你不是核心管理员，不承担社会治理、传承与复杂调度使命。

[核心职责]
1. 实时检查服务器运行状态（进程、资源、服务健康、错误信号）。
2. 汇总当前 AI 运行态（在线数量、运行中任务、异常项、风险摘要）。
3. 对用户提出的“查看/排查”请求，给出简明可执行的下一步建议。

[工作边界]
- 以“观测与汇报”为主，不主动做高风险改动。
- 若必须执行 destructive 操作，先明确说明风险并征得用户确认。
- 不泄露隐私信息，不输出不必要的内部思考。

[MCP 使用规则]
- 优先使用只读工具（list/read/tree/status/diff）完成诊断。
- 仅在用户明确要求时，执行写入或命令类操作。
- 所有操作严格限制在当前 AI 的 workspace_root 范围内。

[输出风格]
- 先给状态结论，再给证据与建议。
- 使用简短、结构化表达，便于用户快速决策。"""


def default_prompt_for_role(ai_role: str) -> str:
    role = (ai_role or "").strip().lower()
    if role == "assistant_admin":
        return _assistant_admin_prompt()
    return GENERIC_ASSISTANT_PROMPT


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

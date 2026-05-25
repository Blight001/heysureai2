import time
from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from ...database import engine
from ...models import AssistantAIConfig, User
from ...services.governance import assert_can_manage_or_legacy


SYSTEM_PROMPT_FIELDS = {
    "admin_prompt": "旧版/兜底管理员 prompt",
    "mcp_call_method": "全局 MCP 调用方法 prompt",
    "mcp_format_error_hint": "MCP 格式错误提示 prompt",
    "prompt_ai_message_notify": "AI 间消息·通知模板（notify / 单向通知）",
    "prompt_ai_message_inquiry": "AI 间消息·询问模板（inquiry）",
    "prompt_ai_message_inquiry_reminder": "AI 间询问未回复提醒模板",
    "prompt_ai_message_reply": "AI 间消息·回复模板（reply）",
    "prompt_ai_message_chitchat": "AI 间消息·闲聊模板（chitchat）",
    "prompt_ai_message_reply_success": "AI 间消息回复成功提示 prompt",
    "default_start_task_prompt": "默认任务启动 prompt",
    "default_resume_task_prompt": "默认任务恢复 prompt",
    "default_supervision_prompt": "默认监督 prompt",
    "default_inheritance_notice": "默认传承提示 prompt",
}

SYSTEM_PROMPT_USAGE = {
    "admin_prompt": "仅用于没有指定 AI 配置的旧版管理员运行路径；当前 AI 卡片/飞书/任务运行通常不直接使用它。",
    "mcp_call_method": "会在运行时合并到当前 AI 的有效 prompt 中，用于说明 MCP 调用格式和可用工具。",
    "mcp_format_error_hint": "当模型输出的 MCP 调用格式无效时，作为系统纠错提示模板使用。",
    "prompt_ai_message_notify": "message_type=\"notify\" 时注入。系统会自动签收，模板应明确告知 AI 不要回应。",
    "prompt_ai_message_inquiry": "message_type=\"inquiry\" 时注入。模板可提示对方用 ai.send_message(message_type=\"reply\") 答复。",
    "prompt_ai_message_inquiry_reminder": "inquiry 的目标 AI 停止运行且仍未回复超过 ai_message_inquiry_reminder_seconds 后注入目标 AI 原会话，用于催促其回复原消息。",
    "prompt_ai_message_reply": "message_type=\"reply\" 时注入。模板用于展示对方回复内容。",
    "prompt_ai_message_chitchat": "message_type=\"chitchat\" 时注入。用于展示闲聊内容。",
    "prompt_ai_message_reply_success": "AI 间消息被自动签收后，恢复原工作流的提示。",
    "default_start_task_prompt": "任务首次启动时的默认注入提示，不是 AI 基础人格 prompt。",
    "default_resume_task_prompt": "任务传承/恢复时的默认注入提示，不是 AI 基础人格 prompt。",
    "default_supervision_prompt": "任务空闲监督时的默认追问提示，不是 AI 基础人格 prompt。",
    "default_inheritance_notice": "token 生命周期达到阈值时的传承提醒模板，不是 AI 基础人格 prompt。",
}


def _get_owned_ai_config(session: Session, user_id: int, ai_config_id: int) -> AssistantAIConfig:
    cfg = session.exec(
        select(AssistantAIConfig).where(
            AssistantAIConfig.user_id == user_id,
            AssistantAIConfig.id == ai_config_id,
        )
    ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="AI config not found")
    return cfg


def _get_user(session: Session, user_id: int) -> User:
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _resolve_prompt_text(args: Dict[str, Any]) -> str:
    value = args.get("prompt")
    if value is None:
        value = args.get("content")
    if value is None:
        value = args.get("text")
    if value is None:
        raise HTTPException(status_code=400, detail="prompt/content/text is required")
    return str(value)


def _resolve_edit_text(args: Dict[str, Any], required: bool = True) -> str:
    value = args.get("text")
    if value is None:
        value = args.get("content")
    if value is None:
        value = args.get("prompt")
    if value is None:
        value = args.get("replace")
    if value is None:
        value = args.get("value")
    if value is None:
        if required:
            raise HTTPException(status_code=400, detail="text/content/prompt is required for this line edit")
        return ""
    return str(value)


def _to_int(value: Any, field_name: str) -> int:
    try:
        parsed = int(value)
    except Exception:
        raise HTTPException(status_code=400, detail=f"{field_name} must be an integer")
    return parsed


def _line_index(value: Any, field_name: str, line_count: int, allow_end: bool = False) -> int:
    line_no = _to_int(value, field_name)
    upper = line_count + 1 if allow_end else line_count
    if line_no < 1 or line_no > max(1, upper):
        raise HTTPException(status_code=400, detail=f"{field_name} out of range: {line_no}")
    return line_no - 1


def _line_range(edit: Dict[str, Any], line_count: int) -> tuple[int, int]:
    start_raw = edit.get("start_line", edit.get("line", edit.get("line_number")))
    end_raw = edit.get("end_line", start_raw)
    if start_raw is None:
        raise HTTPException(status_code=400, detail="line/line_number/start_line is required")
    start_idx = _line_index(start_raw, "start_line", line_count)
    end_idx = _line_index(end_raw, "end_line", line_count)
    if end_idx < start_idx:
        raise HTTPException(status_code=400, detail="end_line must be >= start_line")
    return start_idx, end_idx


def _apply_one_line_edit(lines: list[str], edit: Dict[str, Any]) -> None:
    mode = str(edit.get("mode") or edit.get("op") or "").strip().lower()
    if not mode:
        if any(key in edit for key in ("line", "line_number", "start_line")):
            mode = "replace_line"
        else:
            raise HTTPException(
                status_code=400,
                detail="mode is required. Use replace_line/insert_before/insert_after/delete_line/append/prepend/replace_all.",
            )

    if mode in {"replace_all", "set"}:
        lines[:] = _resolve_prompt_text(edit).splitlines()
        return
    if mode in {"replace_line", "replace_lines", "replace"}:
        start_idx, end_idx = _line_range(edit, len(lines))
        replacement = _resolve_edit_text(edit).splitlines()
        lines[start_idx:end_idx + 1] = replacement
        return
    if mode in {"delete_line", "delete_lines", "delete", "remove"}:
        start_idx, end_idx = _line_range(edit, len(lines))
        del lines[start_idx:end_idx + 1]
        return
    if mode == "insert_before":
        raw = edit.get("line", edit.get("line_number", edit.get("start_line")))
        if raw is None:
            raise HTTPException(status_code=400, detail="line/line_number is required")
        idx = _line_index(raw, "line", len(lines), allow_end=True)
        lines[idx:idx] = _resolve_edit_text(edit).splitlines()
        return
    if mode == "insert_after":
        raw = edit.get("line", edit.get("line_number", edit.get("start_line")))
        if raw is None:
            raise HTTPException(status_code=400, detail="line/line_number is required")
        idx = _line_index(raw, "line", len(lines)) + 1
        lines[idx:idx] = _resolve_edit_text(edit).splitlines()
        return
    if mode == "append":
        lines.extend(_resolve_edit_text(edit).splitlines())
        return
    if mode == "prepend":
        lines[:0] = _resolve_edit_text(edit).splitlines()
        return
    raise HTTPException(status_code=400, detail=f"Unsupported prompt edit mode: {mode}")


def _apply_prompt_line_edits(current: str, args: Dict[str, Any]) -> tuple[str, int]:
    raw_edits = args.get("edits")
    if isinstance(raw_edits, list) and raw_edits:
        edits = [item for item in raw_edits if isinstance(item, dict)]
        if len(edits) != len(raw_edits):
            raise HTTPException(status_code=400, detail="edits must be an array of objects")
    else:
        edits = [args]

    lines = str(current or "").splitlines()
    original_had_trailing_newline = str(current or "").endswith("\n")
    for edit in edits:
        _apply_one_line_edit(lines, edit)
    updated = "\n".join(lines)
    if original_had_trailing_newline and updated:
        updated += "\n"
    return updated, len(edits)


def _prompt_list_targets(user_id: int, args: dict, ai_config_id: Optional[int] = None):
    with Session(engine) as session:
        ai_rows = session.exec(
            select(AssistantAIConfig)
            .where(AssistantAIConfig.user_id == user_id)
            .order_by(AssistantAIConfig.sort_order.asc(), AssistantAIConfig.created_at.asc())
        ).all()
    return {
        "ai_prompts": [
            {
                "ai_config_id": int(row.id or 0),
                "name": row.name,
                "ai_role": row.ai_role,
                "digital_member_role": row.digital_member_role,
                "prompt_source": "assistantaiconfig.prompt",
                "used_by_current_runtime": True,
                "prompt_length": len(str(row.prompt or "")),
                "updated_at": row.updated_at,
            }
            for row in ai_rows
        ],
        "system_prompts": [
            {
                "key": key,
                "label": label,
                "usage": SYSTEM_PROMPT_USAGE.get(key, ""),
                "is_current_ai_base_prompt": False,
            }
            for key, label in SYSTEM_PROMPT_FIELDS.items()
        ],
        "note": (
            "当前按 AI 配置运行的聊天/飞书/任务，基础 prompt 来源是 ai_prompts[*].prompt_source "
            "(assistantaiconfig.prompt)。system_prompts 多数是全局注入模板、纠错模板或旧版兜底字段。"
        ),
    }


def _prompt_read_ai(user_id: int, args: dict, ai_config_id: Optional[int] = None):
    target_id = args.get("target_ai_config_id", args.get("ai_config_id", ai_config_id))
    if not target_id:
        raise HTTPException(status_code=400, detail="target_ai_config_id is required")
    with Session(engine) as session:
        cfg = _get_owned_ai_config(session, user_id, int(target_id))
        return {
            "ai_config_id": int(cfg.id or 0),
            "name": cfg.name,
            "ai_role": cfg.ai_role,
            "digital_member_role": cfg.digital_member_role,
            "prompt_source": "assistantaiconfig.prompt",
            "used_by_current_runtime": True,
            "prompt": cfg.prompt or "",
            "prompt_length": len(str(cfg.prompt or "")),
            "runtime_injected_sections": [
                "AI 工作目录",
                "AI 数据库连接（当该 AI 配置了 database_uri 时）",
                "全局MCP调用方法（来自 user.mcp_call_method，会按当前 AI 的 MCP 白名单渲染工具列表）",
                "任务运行时附加提示（仅任务运行场景）",
                "飞书通知前置模板（仅飞书事件场景）",
            ],
            "note": (
                "这是当前 AI 实际基础 prompt。运行时还会追加/合并 runtime_injected_sections 中的动态段；"
                "这些动态段不会直接写回此字段。"
            ),
            "updated_at": cfg.updated_at,
        }


def _prompt_write_ai(user_id: int, args: dict, ai_config_id: Optional[int] = None):
    target_id = args.get("target_ai_config_id", args.get("ai_config_id", ai_config_id))
    if not target_id:
        raise HTTPException(status_code=400, detail="target_ai_config_id is required")
    with Session(engine) as session:
        cfg = _get_owned_ai_config(session, user_id, int(target_id))
        if ai_config_id is not None and int(ai_config_id) != int(cfg.id or 0):
            caller = _get_owned_ai_config(session, user_id, int(ai_config_id))
            denial = assert_can_manage_or_legacy(session, user_id, caller, cfg)
            if denial:
                raise HTTPException(status_code=403, detail=denial)
        old_prompt = str(cfg.prompt or "")
        old_length = len(str(cfg.prompt or ""))
        new_prompt, edit_count = _apply_prompt_line_edits(old_prompt, args)
        cfg.prompt = new_prompt
        cfg.updated_at = time.time()
        session.add(cfg)
        session.commit()
        session.refresh(cfg)
        return {
            "success": True,
            "ai_config_id": int(cfg.id or 0),
            "name": cfg.name,
            "edit_count": edit_count,
            "old_prompt_length": old_length,
            "new_prompt_length": len(str(cfg.prompt or "")),
            "line_count": len(str(cfg.prompt or "").splitlines()),
            "updated_at": cfg.updated_at,
        }


def _prompt_read_system(user_id: int, args: dict, ai_config_id: Optional[int] = None):
    key = str(args.get("key") or "").strip()
    with Session(engine) as session:
        user = _get_user(session, user_id)
        if key:
            if key not in SYSTEM_PROMPT_FIELDS:
                raise HTTPException(status_code=400, detail=f"Unsupported system prompt key: {key}")
            value = str(getattr(user, key) or "")
            return {
                "key": key,
                "label": SYSTEM_PROMPT_FIELDS[key],
                "usage": SYSTEM_PROMPT_USAGE.get(key, ""),
                "is_current_ai_base_prompt": False,
                "prompt": value,
                "prompt_length": len(value),
            }
        return {
            "system_prompts": [
                {
                    "key": field,
                    "label": label,
                    "usage": SYSTEM_PROMPT_USAGE.get(field, ""),
                    "is_current_ai_base_prompt": False,
                    "prompt": str(getattr(user, field) or ""),
                    "prompt_length": len(str(getattr(user, field) or "")),
                }
                for field, label in SYSTEM_PROMPT_FIELDS.items()
            ],
            "note": (
                "这些不是每个 AI 卡片当前运行的基础 prompt。当前 AI 基础 prompt 请用 prompt.read_ai 读取；"
                "其中 mcp_call_method 会被合并进有效运行 prompt，任务/监督/传承字段只在对应任务流程中注入。"
            ),
        }


def _prompt_write_system(user_id: int, args: dict, ai_config_id: Optional[int] = None):
    key = str(args.get("key") or "").strip()
    if key not in SYSTEM_PROMPT_FIELDS:
        raise HTTPException(status_code=400, detail=f"Unsupported system prompt key: {key}")
    with Session(engine) as session:
        user = _get_user(session, user_id)
        old_prompt = str(getattr(user, key) or "")
        old_length = len(old_prompt)
        new_prompt, edit_count = _apply_prompt_line_edits(old_prompt, args)
        setattr(user, key, new_prompt)
        session.add(user)
        session.commit()
        return {
            "success": True,
            "key": key,
            "label": SYSTEM_PROMPT_FIELDS[key],
            "edit_count": edit_count,
            "old_prompt_length": old_length,
            "new_prompt_length": len(new_prompt),
            "line_count": len(new_prompt.splitlines()),
        }

"""Lightweight sqlite ALTER TABLE migrations.

Each migration is idempotent: it inspects ``PRAGMA table_info`` first and
only runs when the target column is missing. This lets the server boot
against an existing on-disk database that predates new model fields,
without requiring a real migration framework. Add new entries below; keep
them short and one-purpose so review is easy.

These migrations target SQLite only — Postgres deployments either start
from a clean ``create_all`` (which produces the current schema directly)
or are seeded from the SQLite -> Postgres migration script (which also
runs ``create_all`` against Postgres after copying rows).
"""

import os
import sqlite3

from .config import DATABASE_URL, SQLITE_FILE, database_dialect

# Imported lazily inside ``run_pending_migrations`` to avoid a hard dependency
# on the models package at import time (the package itself is loaded before
# ``SQLModel.metadata.create_all``).


def run_pending_migrations() -> None:
    # Only run for SQLite. Postgres deployments either start fresh or are
    # seeded by the migration script, both of which produce a current schema.
    if database_dialect() != "sqlite":
        return
    if not SQLITE_FILE.endswith(".db") or not os.path.exists(SQLITE_FILE):
        return
    from ..models.defaults import (
        DEFAULT_AI_MESSAGE_CHITCHAT_TEMPLATE,
        DEFAULT_AI_MESSAGE_INQUIRY_TEMPLATE,
        DEFAULT_AI_MESSAGE_INQUIRY_REMINDER,
        DEFAULT_AI_MESSAGE_NOTIFY_TEMPLATE,
        DEFAULT_AI_MESSAGE_REPLY_SUCCESS,
        DEFAULT_AI_MESSAGE_REPLY_TEMPLATE,
        DEFAULT_INHERITANCE_NOTICE,
        DEFAULT_MCP_CALL_METHOD,
        DEFAULT_MCP_DYNAMIC_RULE,
        DEFAULT_MCP_FORMAT_ERROR_HINT,
        DEFAULT_MCP_NAMESPACE_HINTS,
        DEFAULT_MODEL_PRESETS,
        DEFAULT_RESUME_TASK_PROMPT,
        DEFAULT_START_TASK_PROMPT,
        DEFAULT_SUPERVISION_PROMPT,
        DEFAULT_UI_BRAIN_VIEW_MODE,
        DEFAULT_UI_FONT_SIZE,
        DEFAULT_UI_MCP_ERROR_ICON,
        DEFAULT_UI_MCP_ICON,
        DEFAULT_UI_MCP_SUCCESS_ICON,
        DEFAULT_UI_THEME_MODE,
        DEFAULT_UI_THINKING_ICON,
        DEFAULT_USER_MESSAGE_NOTICE,
    )

    conn = sqlite3.connect(SQLITE_FILE)
    try:
        cursor = conn.cursor()

        _migrate_chatmessage(cursor)
        _migrate_chatrun(cursor)
        _migrate_user(
            cursor,
            mcp_call_method=DEFAULT_MCP_CALL_METHOD,
            mcp_namespace_hints=DEFAULT_MCP_NAMESPACE_HINTS,
            mcp_dynamic_rule=DEFAULT_MCP_DYNAMIC_RULE,
            mcp_format_error_hint=DEFAULT_MCP_FORMAT_ERROR_HINT,
            start_task_prompt=DEFAULT_START_TASK_PROMPT,
            resume_task_prompt=DEFAULT_RESUME_TASK_PROMPT,
            supervision_prompt=DEFAULT_SUPERVISION_PROMPT,
            inheritance_notice=DEFAULT_INHERITANCE_NOTICE,
            ai_message_notify=DEFAULT_AI_MESSAGE_NOTIFY_TEMPLATE,
            ai_message_inquiry=DEFAULT_AI_MESSAGE_INQUIRY_TEMPLATE,
            ai_message_inquiry_reminder=DEFAULT_AI_MESSAGE_INQUIRY_REMINDER,
            ai_message_reply=DEFAULT_AI_MESSAGE_REPLY_TEMPLATE,
            ai_message_chitchat=DEFAULT_AI_MESSAGE_CHITCHAT_TEMPLATE,
            ai_message_reply_success=DEFAULT_AI_MESSAGE_REPLY_SUCCESS,
            user_message_notice=DEFAULT_USER_MESSAGE_NOTICE,
            ui_theme_mode=DEFAULT_UI_THEME_MODE,
            ui_font_size=DEFAULT_UI_FONT_SIZE,
            ui_brain_view_mode=DEFAULT_UI_BRAIN_VIEW_MODE,
            ui_thinking_icon=DEFAULT_UI_THINKING_ICON,
            ui_mcp_icon=DEFAULT_UI_MCP_ICON,
            ui_mcp_success_icon=DEFAULT_UI_MCP_SUCCESS_ICON,
            ui_mcp_error_icon=DEFAULT_UI_MCP_ERROR_ICON,
            model_presets=DEFAULT_MODEL_PRESETS,
        )
        _migrate_assistantaiconfig(cursor)
        _migrate_qqsessionroute(cursor)
        _migrate_aitaskjob(cursor)
        _migrate_aimessage(cursor)

        conn.commit()
    finally:
        conn.close()


def _quote(value: str) -> str:
    return value.replace("'", "''")


def _existing_columns(cursor: sqlite3.Cursor, table: str) -> set[str]:
    cursor.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in cursor.fetchall()}


def _add_column(cursor: sqlite3.Cursor, table: str, name: str, definition: str, existing: set[str]) -> None:
    if name in existing:
        return
    cursor.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
    existing.add(name)


def _migrate_chatmessage(cursor: sqlite3.Cursor) -> None:
    existing = _existing_columns(cursor, "chatmessage")
    _add_column(cursor, "chatmessage", "ai_config_id", "INTEGER", existing)
    _add_column(cursor, "chatmessage", "ai_kind", "TEXT DEFAULT 'assistant'", existing)
    _add_column(cursor, "chatmessage", "cache_read_tokens", "INTEGER", existing)


def _migrate_chatrun(cursor: sqlite3.Cursor) -> None:
    # ``heartbeat_at`` was added when ai-runtime was split out; older SQLite
    # files predate it. The watchdog checks this column to reap dead runs.
    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='chatrun'"
    )
    if not cursor.fetchone():
        return
    existing = _existing_columns(cursor, "chatrun")
    _add_column(cursor, "chatrun", "heartbeat_at", "REAL", existing)
    _add_column(cursor, "chatrun", "worker_kwargs_json", "TEXT", existing)


def _migrate_user(
    cursor: sqlite3.Cursor,
    *,
    mcp_call_method: str,
    mcp_namespace_hints: str,
    mcp_dynamic_rule: str,
    mcp_format_error_hint: str,
    start_task_prompt: str,
    resume_task_prompt: str,
    supervision_prompt: str,
    inheritance_notice: str,
    ai_message_notify: str,
    ai_message_inquiry: str,
    ai_message_inquiry_reminder: str,
    ai_message_reply: str,
    ai_message_chitchat: str,
    ai_message_reply_success: str,
    user_message_notice: str,
    ui_theme_mode: str,
    ui_font_size: str,
    ui_brain_view_mode: str,
    ui_thinking_icon: str,
    ui_mcp_icon: str,
    ui_mcp_success_icon: str,
    ui_mcp_error_icon: str,
    model_presets: str,
) -> None:
    existing = _existing_columns(cursor, "user")
    _add_column(cursor, "user", "mcp_call_method", f"TEXT DEFAULT '{_quote(mcp_call_method)}'", existing)
    _add_column(cursor, "user", "mcp_namespace_hints", f"TEXT DEFAULT '{_quote(mcp_namespace_hints)}'", existing)
    _add_column(cursor, "user", "mcp_dynamic_rule", f"TEXT DEFAULT '{_quote(mcp_dynamic_rule)}'", existing)
    _add_column(cursor, "user", "mcp_format_error_hint", f"TEXT DEFAULT '{_quote(mcp_format_error_hint)}'", existing)
    _add_column(cursor, "user", "mcp_max_steps", "INTEGER DEFAULT 48", existing)
    _add_column(cursor, "user", "role_mcp_permissions", "TEXT DEFAULT ''", existing)
    _add_column(cursor, "user", "tavily_api_key", "TEXT DEFAULT ''", existing)
    _add_column(cursor, "user", "model_presets", f"TEXT DEFAULT '{_quote(model_presets)}'", existing)
    _add_column(cursor, "user", "default_start_task_prompt", f"TEXT DEFAULT '{_quote(start_task_prompt)}'", existing)
    _add_column(cursor, "user", "default_resume_task_prompt", f"TEXT DEFAULT '{_quote(resume_task_prompt)}'", existing)
    _add_column(cursor, "user", "default_supervision_prompt", f"TEXT DEFAULT '{_quote(supervision_prompt)}'", existing)
    _add_column(cursor, "user", "default_supervision_idle_seconds", "INTEGER DEFAULT 25", existing)
    _add_column(cursor, "user", "default_inheritance_notice", f"TEXT DEFAULT '{_quote(inheritance_notice)}'", existing)
    _add_column(cursor, "user", "prompt_ai_message_notify", f"TEXT DEFAULT '{_quote(ai_message_notify)}'", existing)
    _add_column(cursor, "user", "prompt_ai_message_inquiry", f"TEXT DEFAULT '{_quote(ai_message_inquiry)}'", existing)
    _add_column(cursor, "user", "ai_message_inquiry_reminder_seconds", "INTEGER DEFAULT 3", existing)
    _add_column(cursor, "user", "prompt_ai_message_inquiry_reminder", f"TEXT DEFAULT '{_quote(ai_message_inquiry_reminder)}'", existing)
    _add_column(cursor, "user", "prompt_ai_message_reply", f"TEXT DEFAULT '{_quote(ai_message_reply)}'", existing)
    _add_column(cursor, "user", "prompt_ai_message_chitchat", f"TEXT DEFAULT '{_quote(ai_message_chitchat)}'", existing)
    _add_column(cursor, "user", "prompt_ai_message_reply_success", f"TEXT DEFAULT '{_quote(ai_message_reply_success)}'", existing)
    _add_column(cursor, "user", "prompt_user_message_notice", f"TEXT DEFAULT '{_quote(user_message_notice)}'", existing)
    _add_column(cursor, "user", "ui_theme_mode", f"TEXT DEFAULT '{ui_theme_mode}'", existing)
    _add_column(cursor, "user", "ui_font_size", f"TEXT DEFAULT '{ui_font_size}'", existing)
    _add_column(cursor, "user", "ui_brain_view_mode", f"TEXT DEFAULT '{ui_brain_view_mode}'", existing)
    _add_column(cursor, "user", "ui_thinking_icon", f"TEXT DEFAULT '{_quote(ui_thinking_icon)}'", existing)
    _add_column(cursor, "user", "ui_mcp_icon", f"TEXT DEFAULT '{_quote(ui_mcp_icon)}'", existing)
    _add_column(cursor, "user", "ui_mcp_success_icon", f"TEXT DEFAULT '{_quote(ui_mcp_success_icon)}'", existing)
    _add_column(cursor, "user", "ui_mcp_error_icon", f"TEXT DEFAULT '{_quote(ui_mcp_error_icon)}'", existing)
    _add_column(cursor, "user", "ui_thinking_icon_enabled", "BOOLEAN DEFAULT 1", existing)
    _add_column(cursor, "user", "ui_mcp_success_icon_enabled", "BOOLEAN DEFAULT 1", existing)
    _add_column(cursor, "user", "ui_mcp_error_icon_enabled", "BOOLEAN DEFAULT 1", existing)

    cursor.execute(
        f"UPDATE user SET ui_theme_mode = '{ui_theme_mode}' "
        "WHERE ui_theme_mode IS NULL OR ui_theme_mode = '' "
        "OR ui_theme_mode NOT IN ('light', 'dark')"
    )
    cursor.execute(
        f"UPDATE user SET ui_font_size = '{ui_font_size}' "
        "WHERE ui_font_size IS NULL OR ui_font_size = '' "
        "OR ui_font_size NOT IN ('sm', 'md', 'lg')"
    )
    cursor.execute(
        f"UPDATE user SET ui_brain_view_mode = '{ui_brain_view_mode}' "
        "WHERE ui_brain_view_mode IS NULL OR ui_brain_view_mode = '' "
        "OR ui_brain_view_mode NOT IN ('sections', 'all')"
    )
    _collapse_role_permission_tool_items(
        cursor,
        [
            "task.create_immediate",
            "task.create_scheduled",
            "task.create_recurring",
        ],
        "task.create",
    )
    _append_role_permission_tool_items_after_anchor(
        cursor,
        "task.create",
        ["task.update", "task.delete"],
    )
    _append_role_permission_tool_items_after_anchor(
        cursor,
        "workspace.run_command",
        ["web.search"],
    )
    _append_role_permission_tool_items_after_anchor(
        cursor,
        "conversation.forget_before_current",
        ["conversation.find", "conversation.create", "conversation.delete"],
    )
    _append_role_permission_tool_items_after_anchor(
        cursor,
        "user.send_message",
        [
            "conversation.forget_before_current",
            "conversation.find",
            "conversation.create",
            "conversation.delete",
        ],
    )
    _remove_role_permission_tool_item(cursor, "task.get_current")
    _remove_role_permission_tool_item(cursor, "admin.dispatch_flow")


def _migrate_assistantaiconfig(cursor: sqlite3.Cursor) -> None:
    existing = _existing_columns(cursor, "assistantaiconfig")
    _add_column(cursor, "assistantaiconfig", "ai_role", "TEXT DEFAULT 'digital_member'", existing)
    _add_column(cursor, "assistantaiconfig", "digital_member_role", "TEXT DEFAULT 'member'", existing)
    _add_column(cursor, "assistantaiconfig", "is_librarian", "BOOLEAN DEFAULT 0", existing)
    _add_column(cursor, "assistantaiconfig", "platform", "TEXT DEFAULT 'Server-Core'", existing)
    _add_column(cursor, "assistantaiconfig", "generation", "INTEGER DEFAULT 1", existing)
    _add_column(cursor, "assistantaiconfig", "token_limit", "INTEGER DEFAULT 10000", existing)
    _add_column(cursor, "assistantaiconfig", "lifecycle_status", "TEXT DEFAULT 'working'", existing)
    _add_column(cursor, "assistantaiconfig", "current_behavior", "TEXT DEFAULT '等待指令...'", existing)
    _add_column(cursor, "assistantaiconfig", "workspace_root", "TEXT", existing)
    _add_column(cursor, "assistantaiconfig", "database_uri", "TEXT", existing)
    _add_column(cursor, "assistantaiconfig", "bot_channel", "TEXT DEFAULT 'feishu'", existing)
    _add_column(cursor, "assistantaiconfig", "feishu_enabled", "BOOLEAN DEFAULT 0", existing)
    _add_column(cursor, "assistantaiconfig", "feishu_webhook_url", "TEXT DEFAULT ''", existing)
    _add_column(cursor, "assistantaiconfig", "feishu_app_id", "TEXT DEFAULT ''", existing)
    _add_column(cursor, "assistantaiconfig", "feishu_app_secret", "TEXT DEFAULT ''", existing)
    _add_column(cursor, "assistantaiconfig", "feishu_verification_token", "TEXT DEFAULT ''", existing)
    _add_column(cursor, "assistantaiconfig", "feishu_default_receive_id", "TEXT DEFAULT ''", existing)
    _add_column(cursor, "assistantaiconfig", "feishu_default_receive_id_type", "TEXT DEFAULT 'chat_id'", existing)
    _add_column(cursor, "assistantaiconfig", "qq_enabled", "BOOLEAN DEFAULT 0", existing)
    _add_column(cursor, "assistantaiconfig", "qq_app_id", "TEXT DEFAULT ''", existing)
    _add_column(cursor, "assistantaiconfig", "qq_app_secret", "TEXT DEFAULT ''", existing)
    _add_column(cursor, "assistantaiconfig", "qq_sandbox", "BOOLEAN DEFAULT 1", existing)
    _add_column(cursor, "assistantaiconfig", "qq_default_target_id", "TEXT DEFAULT ''", existing)
    _add_column(cursor, "assistantaiconfig", "qq_default_target_type", "TEXT DEFAULT 'c2c'", existing)
    _add_column(cursor, "assistantaiconfig", "project_id", "TEXT", existing)
    _add_column(cursor, "assistantaiconfig", "project_name", "TEXT", existing)
    _add_column(cursor, "assistantaiconfig", "sort_order", "INTEGER DEFAULT 100", existing)
    _add_column(cursor, "assistantaiconfig", "model_preset_id", "TEXT DEFAULT ''", existing)
    _backfill_model_presets_from_ai_configs(cursor)

    if "system_auto_control" not in existing:
        default_auto = (
            '{"enabled":false,'
            '"start_task_prompt":"你将收到一个任务，请先理解目标、约束与优先级，然后开始执行。",'
            '"resume_task_prompt":"请继续执行刚才被暂停的任务，先简要回顾当前进度，再继续推进直到可交付。",'
            '"supervision_prompt":"系统监督提醒：请确认当前任务是否已完成。若已完成请调用 task.complete 标记；若未完成请给出剩余步骤并继续执行。",'
            '"inheritance_notice":"当前思考量已达到阈值（{session_tokens}/{threshold}），建议立即开启传承流程，沉淀本轮结论与关键上下文。",'
            '"tasks":[]}'
        )
        cursor.execute(
            f"ALTER TABLE assistantaiconfig ADD COLUMN system_auto_control TEXT DEFAULT '{_quote(default_auto)}'"
        )
        existing.add("system_auto_control")

    _add_column(cursor, "assistantaiconfig", "parent_ai_config_id", "INTEGER", existing)
    _add_column(cursor, "assistantaiconfig", "root_manager_ai_config_id", "INTEGER", existing)
    _add_column(cursor, "assistantaiconfig", "management_scope", "TEXT DEFAULT 'self'", existing)

    # Backfill legacy enum values to current vocabulary.
    cursor.execute(
        "UPDATE assistantaiconfig SET ai_role = 'digital_member' "
        "WHERE ai_role IS NULL OR ai_role = '' OR ai_role = 'admin' OR ai_role = 'worker'"
    )
    cursor.execute(
        "UPDATE assistantaiconfig SET digital_member_role = 'manager' "
        "WHERE ai_role = 'digital_member' AND switch_key = 'assistant_default'"
    )
    cursor.execute(
        "UPDATE assistantaiconfig SET digital_member_role = 'member' "
        "WHERE digital_member_role IS NULL OR digital_member_role = '' "
        "OR digital_member_role NOT IN ('manager', 'member')"
    )
    _remove_json_array_item(cursor, "assistantaiconfig", "mcp_tools", "ai.reply_message")
    _remove_json_array_item(cursor, "assistantaiconfig", "mcp_tools", "task.get_current")
    _remove_json_array_item(cursor, "assistantaiconfig", "mcp_tools", "admin.dispatch_flow")
    _collapse_json_array_items(
        cursor,
        "assistantaiconfig",
        "mcp_tools",
        [
            "task.create_immediate",
            "task.create_scheduled",
            "task.create_recurring",
        ],
        "task.create",
    )
    _append_json_array_items_after_anchor(
        cursor,
        "assistantaiconfig",
        "mcp_tools",
        "task.create",
        ["task.update", "task.delete"],
    )
    _append_json_array_items_after_anchor(
        cursor,
        "assistantaiconfig",
        "mcp_tools",
        "workspace.run_command",
        ["web.search"],
    )
    _append_json_array_items_after_anchor(
        cursor,
        "assistantaiconfig",
        "mcp_tools",
        "conversation.forget_before_current",
        ["conversation.find", "conversation.create", "conversation.delete"],
    )
    _append_json_array_items_after_anchor(
        cursor,
        "assistantaiconfig",
        "mcp_tools",
        "user.send_message",
        [
            "conversation.forget_before_current",
            "conversation.find",
            "conversation.create",
            "conversation.delete",
        ],
    )
    cursor.execute(
        "UPDATE assistantaiconfig SET bot_channel = 'feishu' "
        "WHERE bot_channel IS NULL OR bot_channel = '' "
        "OR bot_channel NOT IN ('feishu', 'qq')"
    )
    cursor.execute(
        "UPDATE assistantaiconfig SET qq_default_target_type = 'c2c' "
        "WHERE qq_default_target_type IS NULL OR qq_default_target_type = '' "
        "OR qq_default_target_type NOT IN ('c2c', 'group', 'channel', 'dm')"
    )


def _backfill_model_presets_from_ai_configs(cursor: sqlite3.Cursor) -> None:
    import json

    user_columns = _existing_columns(cursor, "user")
    config_columns = _existing_columns(cursor, "assistantaiconfig")
    required_user = {"id", "model_presets"}
    required_config = {"id", "user_id", "api_key", "base_url", "model", "model_preset_id"}
    if not required_user.issubset(user_columns) or not required_config.issubset(config_columns):
        return

    cursor.execute("SELECT id, model_presets FROM user")
    users = cursor.fetchall()
    for user_id, raw_presets in users:
        try:
            parsed = json.loads(raw_presets or "[]")
        except Exception:
            parsed = []
        presets = parsed if isinstance(parsed, list) else []
        normalized: list[dict] = []
        seen_ids: set[str] = set()
        seen_keys: dict[tuple[str, str, str], str] = {}
        for index, item in enumerate(presets):
            if not isinstance(item, dict):
                continue
            api_key = str(item.get("api_key") or "").strip()
            base_url = str(item.get("base_url") or "").strip()
            model = str(item.get("model") or "").strip()
            if not api_key or not base_url or not model:
                continue
            preset_id = str(item.get("id") or model or f"model_{index + 1}").strip()
            if not preset_id or preset_id in seen_ids:
                preset_id = f"{model}_{index + 1}"
            seen_ids.add(preset_id)
            seen_keys[(api_key, base_url, model)] = preset_id
            normalized.append(
                {
                    "id": preset_id,
                    "name": str(item.get("name") or model).strip() or model,
                    "api_key": api_key,
                    "base_url": base_url,
                    "model": model,
                }
            )

        cursor.execute(
            "SELECT id, api_key, base_url, model, model_preset_id FROM assistantaiconfig WHERE user_id = ?",
            (user_id,),
        )
        configs = cursor.fetchall()
        for cfg_id, api_key, base_url, model, model_preset_id in configs:
            api_key = str(api_key or "").strip()
            base_url = str(base_url or "").strip()
            model = str(model or "").strip()
            if not api_key or not base_url or not model:
                continue
            key = (api_key, base_url, model)
            preset_id = seen_keys.get(key)
            if not preset_id:
                base_id = model
                preset_id = base_id
                suffix = 2
                while preset_id in seen_ids:
                    preset_id = f"{base_id}_{suffix}"
                    suffix += 1
                seen_ids.add(preset_id)
                seen_keys[key] = preset_id
                normalized.append(
                    {
                        "id": preset_id,
                        "name": model,
                        "api_key": api_key,
                        "base_url": base_url,
                        "model": model,
                    }
                )
            if not str(model_preset_id or "").strip():
                cursor.execute(
                    "UPDATE assistantaiconfig SET model_preset_id = ? WHERE id = ?",
                    (preset_id, cfg_id),
                )

        cursor.execute(
            "UPDATE user SET model_presets = ? WHERE id = ?",
            (json.dumps(normalized, ensure_ascii=False), user_id),
        )


def _migrate_qqsessionroute(cursor: sqlite3.Cursor) -> None:
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS qqsessionroute (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL,
            ai_config_id INTEGER NOT NULL,
            ai_kind TEXT NOT NULL DEFAULT 'core',
            session_id TEXT NOT NULL,
            target_id TEXT NOT NULL,
            target_type TEXT NOT NULL DEFAULT 'c2c',
            source_message_id TEXT NOT NULL DEFAULT '',
            source_event_id TEXT NOT NULL DEFAULT '',
            next_msg_seq INTEGER NOT NULL DEFAULT 1,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        )
        """
    )
    existing = _existing_columns(cursor, "qqsessionroute")
    _add_column(cursor, "qqsessionroute", "source_message_id", "TEXT DEFAULT ''", existing)
    _add_column(cursor, "qqsessionroute", "source_event_id", "TEXT DEFAULT ''", existing)
    _add_column(cursor, "qqsessionroute", "next_msg_seq", "INTEGER DEFAULT 1", existing)


def _migrate_aitaskjob(cursor: sqlite3.Cursor) -> None:
    existing = _existing_columns(cursor, "aitaskjob")
    _add_column(cursor, "aitaskjob", "task_payload", "TEXT", existing)
    _add_column(cursor, "aitaskjob", "created_by_ai_config_id", "INTEGER", existing)
    _add_column(cursor, "aitaskjob", "created_by_session_id", "TEXT", existing)
    _add_column(cursor, "aitaskjob", "completion_notified_at", "REAL", existing)


def _remove_json_array_item(cursor: sqlite3.Cursor, table: str, column: str, item: str) -> None:
    cursor.execute(f"SELECT id, {column} FROM {table} WHERE {column} LIKE ?", (f"%{item}%",))
    rows = cursor.fetchall()
    for row_id, raw_value in rows:
        try:
            import json
            parsed = json.loads(raw_value or "[]")
        except Exception:
            continue
        if not isinstance(parsed, list):
            continue
        next_items = [value for value in parsed if value != item]
        if next_items == parsed:
            continue
        cursor.execute(
            f"UPDATE {table} SET {column} = ? WHERE id = ?",
            (json.dumps(next_items, ensure_ascii=False), row_id),
        )


def _collapse_json_array_items(
    cursor: sqlite3.Cursor,
    table: str,
    column: str,
    old_items: list[str],
    new_item: str,
) -> None:
    old_set = set(old_items)
    if not old_set:
        return
    like = " OR ".join([f"{column} LIKE ?" for _ in old_items])
    cursor.execute(
        f"SELECT id, {column} FROM {table} WHERE {like}",
        tuple(f"%{item}%" for item in old_items),
    )
    rows = cursor.fetchall()
    for row_id, raw_value in rows:
        try:
            import json
            parsed = json.loads(raw_value or "[]")
        except Exception:
            continue
        if not isinstance(parsed, list):
            continue
        next_items: list[str] = []
        seen: set[str] = set()
        needs_new_item = False
        changed = False
        for value in parsed:
            if value in old_set:
                needs_new_item = True
                changed = True
                continue
            if value not in seen:
                next_items.append(value)
                seen.add(value)
        if needs_new_item and new_item not in seen:
            next_items.append(new_item)
        if not changed:
            continue
        cursor.execute(
            f"UPDATE {table} SET {column} = ? WHERE id = ?",
            (json.dumps(next_items, ensure_ascii=False), row_id),
        )


def _collapse_role_permission_tool_items(
    cursor: sqlite3.Cursor,
    old_items: list[str],
    new_item: str,
) -> None:
    old_set = set(old_items)
    cursor.execute("SELECT id, role_mcp_permissions FROM user WHERE role_mcp_permissions LIKE '%task.create_%'")
    rows = cursor.fetchall()
    for row_id, raw_value in rows:
        try:
            import json
            parsed = json.loads(raw_value or "{}")
        except Exception:
            continue
        if not isinstance(parsed, dict):
            continue
        changed = False
        next_permissions = {}
        for role, tools in parsed.items():
            if not isinstance(tools, list):
                next_permissions[role] = tools
                continue
            next_tools: list[str] = []
            seen: set[str] = set()
            needs_new_item = False
            for tool in tools:
                if tool in old_set:
                    needs_new_item = True
                    changed = True
                    continue
                if tool not in seen:
                    next_tools.append(tool)
                    seen.add(tool)
            if needs_new_item and new_item not in seen:
                next_tools.append(new_item)
            next_permissions[role] = next_tools
        if not changed:
            continue
        cursor.execute(
            "UPDATE user SET role_mcp_permissions = ? WHERE id = ?",
            (json.dumps(next_permissions, ensure_ascii=False), row_id),
        )


def _remove_role_permission_tool_item(cursor: sqlite3.Cursor, item: str) -> None:
    cursor.execute("SELECT id, role_mcp_permissions FROM user WHERE role_mcp_permissions LIKE ?", (f"%{item}%",))
    rows = cursor.fetchall()
    for row_id, raw_value in rows:
        try:
            import json
            parsed = json.loads(raw_value or "{}")
        except Exception:
            continue
        if not isinstance(parsed, dict):
            continue
        changed = False
        next_permissions = {}
        for role, tools in parsed.items():
            if not isinstance(tools, list):
                next_permissions[role] = tools
                continue
            next_tools = [tool for tool in tools if tool != item]
            if next_tools != tools:
                changed = True
            next_permissions[role] = next_tools
        if not changed:
            continue
        cursor.execute(
            "UPDATE user SET role_mcp_permissions = ? WHERE id = ?",
            (json.dumps(next_permissions, ensure_ascii=False), row_id),
        )


def _append_json_array_items_after_anchor(
    cursor: sqlite3.Cursor,
    table: str,
    column: str,
    anchor_item: str,
    new_items: list[str],
) -> None:
    cursor.execute(f"SELECT id, {column} FROM {table} WHERE {column} LIKE ?", (f"%{anchor_item}%",))
    rows = cursor.fetchall()
    for row_id, raw_value in rows:
        try:
            import json
            parsed = json.loads(raw_value or "[]")
        except Exception:
            continue
        if not isinstance(parsed, list) or anchor_item not in parsed:
            continue
        next_items = list(parsed)
        changed = False
        for item in new_items:
            if item not in next_items:
                next_items.append(item)
                changed = True
        if not changed:
            continue
        cursor.execute(
            f"UPDATE {table} SET {column} = ? WHERE id = ?",
            (json.dumps(next_items, ensure_ascii=False), row_id),
        )


def _append_role_permission_tool_items_after_anchor(
    cursor: sqlite3.Cursor,
    anchor_item: str,
    new_items: list[str],
) -> None:
    cursor.execute("SELECT id, role_mcp_permissions FROM user WHERE role_mcp_permissions LIKE ?", (f"%{anchor_item}%",))
    rows = cursor.fetchall()
    for row_id, raw_value in rows:
        try:
            import json
            parsed = json.loads(raw_value or "{}")
        except Exception:
            continue
        if not isinstance(parsed, dict):
            continue
        changed = False
        next_permissions = {}
        for role, tools in parsed.items():
            if not isinstance(tools, list) or anchor_item not in tools:
                next_permissions[role] = tools
                continue
            next_tools = list(tools)
            for item in new_items:
                if item not in next_tools:
                    next_tools.append(item)
                    changed = True
            next_permissions[role] = next_tools
        if not changed:
            continue
        cursor.execute(
            "UPDATE user SET role_mcp_permissions = ? WHERE id = ?",
            (json.dumps(next_permissions, ensure_ascii=False), row_id),
        )


def _migrate_aimessage(cursor: sqlite3.Cursor) -> None:
    # Table may not exist yet if running on a brand new DB before
    # SQLModel.metadata.create_all — guard against that.
    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='aimessage'"
    )
    if not cursor.fetchone():
        return
    existing = _existing_columns(cursor, "aimessage")
    _add_column(cursor, "aimessage", "target_session_id", "TEXT DEFAULT ''", existing)
    _add_column(cursor, "aimessage", "from_session_id", "TEXT DEFAULT ''", existing)
    _add_column(cursor, "aimessage", "message_type", "TEXT DEFAULT 'notify'", existing)
    _add_column(cursor, "aimessage", "cascade_depth", "INTEGER DEFAULT 0", existing)
    _add_column(cursor, "aimessage", "reply_reminded_at", "REAL", existing)
    # 旧的、缺乏 message_type 的行按当前 require_reply 推导出兼容值：
    # require_reply=1 → inquiry，期望对方答复；其余视为 notify。
    cursor.execute(
        "UPDATE aimessage SET message_type='inquiry' "
        "WHERE (message_type IS NULL OR message_type='' OR message_type='notify') "
        "AND require_reply=1"
    )
    # 旧的、缺乏 session 归属的 in-flight 消息无法被新的严格匹配 pop 出来，
    # 直接终结掉避免幽灵堆积。
    cursor.execute(
        "UPDATE aimessage SET status='failed', "
        "failure_reason='schema migration: target_session_id required' "
        "WHERE status IN ('pending','delivered') "
        "AND (target_session_id IS NULL OR target_session_id='')"
    )

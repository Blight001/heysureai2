"""Lightweight sqlite ALTER TABLE migrations.

Each migration is idempotent: it inspects ``PRAGMA table_info`` first and
only runs when the target column is missing. This lets the server boot
against an existing on-disk database that predates new model fields,
without requiring a real migration framework. Add new entries below; keep
them short and one-purpose so review is easy.
"""

import sqlite3

from .config import SQLITE_FILE

# Imported lazily inside ``run_pending_migrations`` to avoid a hard dependency
# on the models package at import time (the package itself is loaded before
# ``SQLModel.metadata.create_all``).


def run_pending_migrations() -> None:
    if not SQLITE_FILE.endswith(".db"):
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
        DEFAULT_MCP_FORMAT_ERROR_HINT,
        DEFAULT_RESUME_TASK_PROMPT,
        DEFAULT_START_TASK_PROMPT,
        DEFAULT_SUPERVISION_PROMPT,
        DEFAULT_UI_FONT_SIZE,
        DEFAULT_UI_THEME_MODE,
        DEFAULT_USER_MESSAGE_NOTICE,
    )

    conn = sqlite3.connect(SQLITE_FILE)
    try:
        cursor = conn.cursor()

        _migrate_chatmessage(cursor)
        _migrate_user(
            cursor,
            mcp_call_method=DEFAULT_MCP_CALL_METHOD,
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
        )
        _migrate_assistantaiconfig(cursor)
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


def _migrate_user(
    cursor: sqlite3.Cursor,
    *,
    mcp_call_method: str,
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
) -> None:
    existing = _existing_columns(cursor, "user")
    _add_column(cursor, "user", "mcp_call_method", f"TEXT DEFAULT '{_quote(mcp_call_method)}'", existing)
    _add_column(cursor, "user", "mcp_format_error_hint", f"TEXT DEFAULT '{_quote(mcp_format_error_hint)}'", existing)
    _add_column(cursor, "user", "mcp_max_steps", "INTEGER DEFAULT 48", existing)
    _add_column(cursor, "user", "role_mcp_permissions", "TEXT DEFAULT ''", existing)
    _add_column(cursor, "user", "tavily_api_key", "TEXT DEFAULT ''", existing)
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
    _remove_role_permission_tool_item(cursor, "task.get_current")


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
    _add_column(cursor, "assistantaiconfig", "feishu_enabled", "BOOLEAN DEFAULT 0", existing)
    _add_column(cursor, "assistantaiconfig", "feishu_webhook_url", "TEXT DEFAULT ''", existing)
    _add_column(cursor, "assistantaiconfig", "feishu_app_id", "TEXT DEFAULT ''", existing)
    _add_column(cursor, "assistantaiconfig", "feishu_app_secret", "TEXT DEFAULT ''", existing)
    _add_column(cursor, "assistantaiconfig", "feishu_verification_token", "TEXT DEFAULT ''", existing)
    _add_column(cursor, "assistantaiconfig", "feishu_default_receive_id", "TEXT DEFAULT ''", existing)
    _add_column(cursor, "assistantaiconfig", "feishu_default_receive_id_type", "TEXT DEFAULT 'chat_id'", existing)
    _add_column(cursor, "assistantaiconfig", "project_id", "TEXT", existing)
    _add_column(cursor, "assistantaiconfig", "project_name", "TEXT", existing)
    _add_column(cursor, "assistantaiconfig", "sort_order", "INTEGER DEFAULT 100", existing)

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

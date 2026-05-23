from sqlmodel import create_engine, SQLModel, Session
from fastapi import Depends

import os
import sqlite3
from api.models import (
    DEFAULT_AI_MESSAGE_INBOUND_TEMPLATE,
    DEFAULT_AI_MESSAGE_REPLY_SUCCESS,
    DEFAULT_USER_MESSAGE_NOTICE,
    DEFAULT_INHERITANCE_NOTICE,
    DEFAULT_UI_FONT_SIZE,
    DEFAULT_UI_THEME_MODE,
    DEFAULT_MCP_CALL_METHOD,
    DEFAULT_MCP_FORMAT_ERROR_HINT,
    DEFAULT_RESUME_TASK_PROMPT,
    DEFAULT_START_TASK_PROMPT,
    DEFAULT_SUPERVISION_PROMPT,
)

# 获取当前文件所在目录的父目录，即 server 目录
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sqlite_file_name = os.path.join(BASE_DIR, "data", "heysure.db")
sqlite_url = f"sqlite:///{sqlite_file_name}"

connect_args = {"check_same_thread": False}
engine = create_engine(sqlite_url, connect_args=connect_args)

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)
    _ensure_legacy_columns()


def _ensure_legacy_columns():
    # Lightweight sqlite migrations for existing installations.
    if not sqlite_file_name.endswith(".db"):
        return
    conn = sqlite3.connect(sqlite_file_name)
    try:
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(chatmessage)")
        existing = {row[1] for row in cursor.fetchall()}
        if "ai_config_id" not in existing:
            cursor.execute("ALTER TABLE chatmessage ADD COLUMN ai_config_id INTEGER")
        if "ai_kind" not in existing:
            cursor.execute("ALTER TABLE chatmessage ADD COLUMN ai_kind TEXT DEFAULT 'assistant'")
        if "cache_read_tokens" not in existing:
            cursor.execute("ALTER TABLE chatmessage ADD COLUMN cache_read_tokens INTEGER")

        cursor.execute("PRAGMA table_info(user)")
        user_existing = {row[1] for row in cursor.fetchall()}
        if "mcp_call_method" not in user_existing:
            escaped = DEFAULT_MCP_CALL_METHOD.replace("'", "''")
            cursor.execute(f"ALTER TABLE user ADD COLUMN mcp_call_method TEXT DEFAULT '{escaped}'")
        if "mcp_format_error_hint" not in user_existing:
            escaped = DEFAULT_MCP_FORMAT_ERROR_HINT.replace("'", "''")
            cursor.execute(f"ALTER TABLE user ADD COLUMN mcp_format_error_hint TEXT DEFAULT '{escaped}'")
        if "mcp_max_steps" not in user_existing:
            cursor.execute("ALTER TABLE user ADD COLUMN mcp_max_steps INTEGER DEFAULT 48")
        if "role_mcp_permissions" not in user_existing:
            cursor.execute("ALTER TABLE user ADD COLUMN role_mcp_permissions TEXT DEFAULT ''")
        if "default_start_task_prompt" not in user_existing:
            escaped = DEFAULT_START_TASK_PROMPT.replace("'", "''")
            cursor.execute(f"ALTER TABLE user ADD COLUMN default_start_task_prompt TEXT DEFAULT '{escaped}'")
        if "default_resume_task_prompt" not in user_existing:
            escaped = DEFAULT_RESUME_TASK_PROMPT.replace("'", "''")
            cursor.execute(f"ALTER TABLE user ADD COLUMN default_resume_task_prompt TEXT DEFAULT '{escaped}'")
        if "default_supervision_prompt" not in user_existing:
            escaped = DEFAULT_SUPERVISION_PROMPT.replace("'", "''")
            cursor.execute(f"ALTER TABLE user ADD COLUMN default_supervision_prompt TEXT DEFAULT '{escaped}'")
        if "default_supervision_idle_seconds" not in user_existing:
            cursor.execute("ALTER TABLE user ADD COLUMN default_supervision_idle_seconds INTEGER DEFAULT 25")
        if "default_inheritance_notice" not in user_existing:
            escaped = DEFAULT_INHERITANCE_NOTICE.replace("'", "''")
            cursor.execute(f"ALTER TABLE user ADD COLUMN default_inheritance_notice TEXT DEFAULT '{escaped}'")
        if "prompt_ai_message_inbound" not in user_existing:
            escaped = DEFAULT_AI_MESSAGE_INBOUND_TEMPLATE.replace("'", "''")
            cursor.execute(f"ALTER TABLE user ADD COLUMN prompt_ai_message_inbound TEXT DEFAULT '{escaped}'")
        if "prompt_ai_message_reply_success" not in user_existing:
            escaped = DEFAULT_AI_MESSAGE_REPLY_SUCCESS.replace("'", "''")
            cursor.execute(f"ALTER TABLE user ADD COLUMN prompt_ai_message_reply_success TEXT DEFAULT '{escaped}'")
        if "prompt_user_message_notice" not in user_existing:
            escaped = DEFAULT_USER_MESSAGE_NOTICE.replace("'", "''")
            cursor.execute(f"ALTER TABLE user ADD COLUMN prompt_user_message_notice TEXT DEFAULT '{escaped}'")
        if "ui_theme_mode" not in user_existing:
            cursor.execute(f"ALTER TABLE user ADD COLUMN ui_theme_mode TEXT DEFAULT '{DEFAULT_UI_THEME_MODE}'")
        if "ui_font_size" not in user_existing:
            cursor.execute(f"ALTER TABLE user ADD COLUMN ui_font_size TEXT DEFAULT '{DEFAULT_UI_FONT_SIZE}'")
        cursor.execute(
            f"UPDATE user SET ui_theme_mode = '{DEFAULT_UI_THEME_MODE}' "
            "WHERE ui_theme_mode IS NULL OR ui_theme_mode = '' OR ui_theme_mode NOT IN ('light', 'dark')"
        )
        cursor.execute(
            f"UPDATE user SET ui_font_size = '{DEFAULT_UI_FONT_SIZE}' "
            "WHERE ui_font_size IS NULL OR ui_font_size = '' OR ui_font_size NOT IN ('sm', 'md', 'lg')"
        )

        cursor.execute("PRAGMA table_info(assistantaiconfig)")
        cfg_existing = {row[1] for row in cursor.fetchall()}
        if "ai_role" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN ai_role TEXT DEFAULT 'digital_member'")
        if "digital_member_role" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN digital_member_role TEXT DEFAULT 'member'")
        if "is_librarian" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN is_librarian BOOLEAN DEFAULT 0")
        if "platform" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN platform TEXT DEFAULT 'Server-Core'")
        if "generation" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN generation INTEGER DEFAULT 1")
        if "token_limit" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN token_limit INTEGER DEFAULT 10000")
        if "lifecycle_status" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN lifecycle_status TEXT DEFAULT 'working'")
        if "current_behavior" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN current_behavior TEXT DEFAULT '等待指令...'")
        if "workspace_root" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN workspace_root TEXT")
        if "database_uri" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN database_uri TEXT")
        if "feishu_enabled" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN feishu_enabled BOOLEAN DEFAULT 0")
        if "feishu_webhook_url" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN feishu_webhook_url TEXT DEFAULT ''")
        if "feishu_app_id" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN feishu_app_id TEXT DEFAULT ''")
        if "feishu_app_secret" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN feishu_app_secret TEXT DEFAULT ''")
        if "feishu_verification_token" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN feishu_verification_token TEXT DEFAULT ''")
        if "feishu_default_receive_id" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN feishu_default_receive_id TEXT DEFAULT ''")
        if "feishu_default_receive_id_type" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN feishu_default_receive_id_type TEXT DEFAULT 'chat_id'")
        if "project_id" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN project_id TEXT")
        if "project_name" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN project_name TEXT")
        if "sort_order" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN sort_order INTEGER DEFAULT 100")
        if "system_auto_control" not in cfg_existing:
            cursor.execute(
                "ALTER TABLE assistantaiconfig ADD COLUMN system_auto_control TEXT "
                "DEFAULT '{\"enabled\":false,"
                "\"start_task_prompt\":\"你将收到一个任务，请先理解目标、约束与优先级，然后开始执行。\","
                "\"resume_task_prompt\":\"请继续执行刚才被暂停的任务，先简要回顾当前进度，再继续推进直到可交付。\","
                "\"supervision_prompt\":\"系统监督提醒：请确认当前任务是否已完成。若已完成请调用 task.complete 标记；若未完成请给出剩余步骤并继续执行。\","
                "\"inheritance_notice\":\"当前思考量已达到阈值（{session_tokens}/{threshold}），建议立即开启传承流程，沉淀本轮结论与关键上下文。\","
                "\"tasks\":[]}'"
            )
        if "auto_last_trigger_at" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN auto_last_trigger_at REAL")
        if "parent_ai_config_id" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN parent_ai_config_id INTEGER")
        if "root_manager_ai_config_id" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN root_manager_ai_config_id INTEGER")
        if "management_scope" not in cfg_existing:
            cursor.execute("ALTER TABLE assistantaiconfig ADD COLUMN management_scope TEXT DEFAULT 'self'")
        # ai_role normalization: old values admin/worker -> digital_member
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
            "WHERE digital_member_role IS NULL OR digital_member_role = '' OR digital_member_role NOT IN ('manager', 'member')"
        )

        cursor.execute("PRAGMA table_info(aitaskjob)")
        task_existing = {row[1] for row in cursor.fetchall()}
        if "task_payload" not in task_existing:
            cursor.execute("ALTER TABLE aitaskjob ADD COLUMN task_payload TEXT")
        if "created_by_ai_config_id" not in task_existing:
            cursor.execute("ALTER TABLE aitaskjob ADD COLUMN created_by_ai_config_id INTEGER")
        conn.commit()
    finally:
        conn.close()

def get_session():
    with Session(engine) as session:
        yield session

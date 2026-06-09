"""Legacy one-time database adoption shim (pre-Alembic).

⚠️ This module is no longer part of the steady-state boot path. Alembic is the
single source of schema truth now (see ``api.db`` / ``migrations/`` /
``doc/db-migrations.md``). It is invoked **at most once per database**, by
``api.db._legacy_adopt``, to bring a pre-Alembic database fully current the
exact way the old boot did — adding missing columns and consolidating legacy
data — after which the database is stamped at Alembic head and this code never
runs again for it.

It is kept (rather than deleted) so existing deployments adopt Alembic without
manual intervention. Once every deployment has been adopted, this module can be
removed (tracked in doc/db-migrations.md). New schema/data changes must be
authored as Alembic revisions, never added here.

Each migration is idempotent: it inspects ``PRAGMA table_info`` first and only
runs when the target column is missing.
"""

import json
import logging
import os
import sqlite3

from .config import SQLITE_FILE, database_dialect


logger = logging.getLogger(__name__)

# Imported lazily inside ``run_pending_migrations`` to avoid a hard dependency
# on the models package at import time (the package itself is loaded before
# ``SQLModel.metadata.create_all``).


def run_data_consolidations(engine) -> None:
    """Dialect-agnostic data migrations executed via SQLAlchemy engine.

    Unlike ``run_pending_migrations`` (legacy SQLite-only ALTER TABLE
    patches) these run on every backend — copying rows out of deprecated
    per-bot tables into ``botsessionroute`` etc.
    """
    _consolidate_bot_session_routes(engine)
    _consolidate_assistantaiconfig_bot_configs(engine)
    _consolidate_valhalla_files_to_db(engine)
    _consolidate_prompts_to_files(engine)
    _cleanup_dead_workspace_folders(engine)


# 已迁出数据库、真相源改为 KnowledgeBase 文件的文本列。
_USER_PROMPT_COLS = (
    "admin_prompt",
    "mcp_call_method",
    "mcp_namespace_hints",
    "mcp_dynamic_rule",
    "mcp_format_error_hint",
    "default_start_task_prompt",
    "default_resume_task_prompt",
    "default_supervision_prompt",
    "default_inheritance_notice",
    "prompt_ai_message_notify",
    "prompt_ai_message_inquiry",
    "prompt_ai_message_inquiry_reminder",
    "prompt_ai_message_reply",
    "prompt_ai_message_chitchat",
    "prompt_ai_message_reply_success",
    "prompt_user_message_notice",
)


def _consolidate_prompts_to_files(engine) -> None:
    """把人格 / 系统提示从数据库迁到 KnowledgeBase 文件，然后物理删除冗余列。

    顺序严格"先迁库再删"：对每个用户/AI 先把现有列值导出成 ``system/*.md`` /
    ``personas/*.md``（文件已存在则跳过，绝不覆盖用户已编辑的文件），全部导出
    完成后才 ``DROP COLUMN``。幂等：列已删后整段跳过；导出失败则不删该用户的列。
    """
    from sqlalchemy import inspect, text

    from api.services import kb_store

    insp = inspect(engine)
    tables = set(insp.get_table_names())
    if "user" not in tables or "assistantaiconfig" not in tables:
        return

    user_cols = {c["name"] for c in insp.get_columns("user")}
    cfg_cols = {c["name"] for c in insp.get_columns("assistantaiconfig")}
    present_user_prompt_cols = [c for c in _USER_PROMPT_COLS if c in user_cols]
    cfg_has_prompt = "prompt" in cfg_cols

    # 已经没有任何待迁列 → 迁移早已完成。
    if not present_user_prompt_cols and not cfg_has_prompt:
        return

    exported_ok = True

    # 1) 导出用户系统提示 → system/*.md
    if present_user_prompt_cols:
        select_cols = ", ".join(["id", *present_user_prompt_cols])
        try:
            with engine.begin() as conn:
                rows = conn.execute(text(f"SELECT {select_cols} FROM \"user\"")).mappings().all()
            for row in rows:
                uid = int(row["id"])
                try:
                    kb_store._ensure_layout(uid)
                    for col in present_user_prompt_cols:
                        value = row.get(col)
                        if value is None or str(value) == "":
                            continue
                        if kb_store.read_system_prompt(uid, col) is None:
                            kb_store.write_system_prompt(uid, col, value)
                except Exception as exc:
                    exported_ok = False
                    logger.exception(f"export system prompts for user {uid} failed: {exc}")
        except Exception as exc:
            exported_ok = False
            logger.exception(f"read user prompt columns failed: {exc}")

    # 2) 导出 AI 人格 prompt → personas/*.md（system_auto_control 列保留，
    #    其中的 4 个 prompt 段一并写入 persona 文件）。
    if cfg_has_prompt:
        sac = "system_auto_control" if "system_auto_control" in cfg_cols else None
        sel = ["id", "user_id", "name", "ai_role", "prompt"] + ([sac] if sac else [])
        try:
            with engine.begin() as conn:
                rows = conn.execute(
                    text(f"SELECT {', '.join(sel)} FROM assistantaiconfig")
                ).mappings().all()
            for row in rows:
                try:
                    kb_store.seed_persona_raw(
                        int(row["user_id"]),
                        row["id"],
                        str(row.get("name") or ""),
                        str(row.get("ai_role") or ""),
                        str(row.get("prompt") or ""),
                        str(row.get(sac) or "{}") if sac else "{}",
                    )
                except Exception as exc:
                    exported_ok = False
                    logger.exception(f"export persona for ai {row.get('id')} failed: {exc}")
        except Exception as exc:
            exported_ok = False
            logger.exception(f"read assistantaiconfig.prompt failed: {exc}")

    if not exported_ok:
        logger.warning("prompt->file export had failures; skipping DROP COLUMN this boot")
        return

    # 3) 全部导出成功后，物理删除冗余列（best-effort，逐列）。
    for col in present_user_prompt_cols:
        try:
            with engine.begin() as conn:
                conn.execute(text(f'ALTER TABLE "user" DROP COLUMN {col}'))
        except Exception as exc:
            logger.exception(f"drop user.{col} failed: {exc}")
    if cfg_has_prompt:
        try:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE assistantaiconfig DROP COLUMN prompt"))
        except Exception as exc:
            logger.exception(f"drop assistantaiconfig.prompt failed: {exc}")


_LEGACY_FEISHU_COLS = (
    "feishu_enabled",
    "feishu_webhook_url",
    "feishu_app_id",
    "feishu_app_secret",
    "feishu_verification_token",
    "feishu_default_receive_id",
    "feishu_default_receive_id_type",
)
_LEGACY_QQ_COLS = (
    "qq_enabled",
    "qq_app_id",
    "qq_app_secret",
    "qq_sandbox",
    "qq_default_target_id",
    "qq_default_target_type",
)


def _consolidate_assistantaiconfig_bot_configs(engine) -> None:
    """Backfill ``assistantaiconfig.bot_configs`` from the deprecated flat
    columns, then drop those columns.

    The flat columns (``feishu_*`` / ``qq_*``) were the original storage
    for per-bot credentials. We're moving them into a single ``bot_configs``
    JSON column keyed by channel so adding a new bot doesn't require a
    schema migration each time.

    The migration is idempotent:
    - If ``bot_configs`` is missing it's added.
    - For rows whose ``bot_configs`` is empty (``{}`` / NULL) we build the
      JSON from whatever flat columns still exist and write it.
    - Flat columns are dropped at the end via ``ALTER TABLE DROP COLUMN``
      (works on Postgres + SQLite ≥ 3.35). Drops that fail are logged but
      do not abort the migration.
    """
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    if "assistantaiconfig" not in set(insp.get_table_names()):
        return
    columns = {col["name"] for col in insp.get_columns("assistantaiconfig")}

    # 1. Ensure bot_configs exists.
    if "bot_configs" not in columns:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE assistantaiconfig ADD COLUMN bot_configs TEXT NOT NULL DEFAULT '{}'"
                )
            )
        columns.add("bot_configs")

    # 2. Backfill any row whose bot_configs is empty.
    flat_present = [c for c in (*_LEGACY_FEISHU_COLS, *_LEGACY_QQ_COLS) if c in columns]
    if flat_present:
        select_cols = ", ".join(["id", "bot_configs", *flat_present])
        with engine.begin() as conn:
            rows = conn.execute(
                text(f"SELECT {select_cols} FROM assistantaiconfig")
            ).mappings().all()
            for row in rows:
                current = str(row.get("bot_configs") or "").strip() or "{}"
                try:
                    parsed = json.loads(current)
                except Exception:
                    parsed = {}
                if not isinstance(parsed, dict):
                    parsed = {}
                if parsed:
                    continue  # already migrated for this row
                feishu_slice = {
                    "enabled": bool(row.get("feishu_enabled")) if "feishu_enabled" in columns else False,
                    "webhook_url": row.get("feishu_webhook_url") or "" if "feishu_webhook_url" in columns else "",
                    "app_id": row.get("feishu_app_id") or "" if "feishu_app_id" in columns else "",
                    "app_secret": row.get("feishu_app_secret") or "" if "feishu_app_secret" in columns else "",
                    "verification_token": row.get("feishu_verification_token") or "" if "feishu_verification_token" in columns else "",
                    "default_receive_id": row.get("feishu_default_receive_id") or "" if "feishu_default_receive_id" in columns else "",
                    "default_receive_id_type": row.get("feishu_default_receive_id_type") or "chat_id" if "feishu_default_receive_id_type" in columns else "chat_id",
                }
                raw_target_type = (
                    row.get("qq_default_target_type") or ""
                    if "qq_default_target_type" in columns
                    else ""
                )
                if raw_target_type not in {"c2c", "group", "channel", "dm"}:
                    raw_target_type = "c2c"
                qq_slice = {
                    "enabled": bool(row.get("qq_enabled")) if "qq_enabled" in columns else False,
                    "app_id": row.get("qq_app_id") or "" if "qq_app_id" in columns else "",
                    "app_secret": row.get("qq_app_secret") or "" if "qq_app_secret" in columns else "",
                    "sandbox": bool(row.get("qq_sandbox")) if "qq_sandbox" in columns else False,
                    "default_target_id": row.get("qq_default_target_id") or "" if "qq_default_target_id" in columns else "",
                    "default_target_type": raw_target_type,
                }
                payload = json.dumps(
                    {"feishu": feishu_slice, "qq": qq_slice}, ensure_ascii=False
                )
                conn.execute(
                    text("UPDATE assistantaiconfig SET bot_configs = :p WHERE id = :id"),
                    {"p": payload, "id": row["id"]},
                )

    # 3. Drop the legacy columns. Best-effort per-column so a partial
    #    failure (older SQLite, missing column) doesn't strand the rest.
    for col in (*_LEGACY_FEISHU_COLS, *_LEGACY_QQ_COLS):
        if col not in columns:
            continue
        try:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE assistantaiconfig DROP COLUMN {col}"))
        except Exception as exc:
            # Surface but do not raise: production may need a manual rebuild
            # on very old SQLite that predates DROP COLUMN.
            logger.exception(f"drop column {col} failed: {exc}")


def _consolidate_valhalla_files_to_db(engine) -> None:
    """Import legacy Valhalla file content into ``valhallaentry`` columns.

    Old generational handoffs stored their full markdown (``last_words.md`` /
    ``final_words.md``) plus sidecar JSON on disk, keyed by ``file_path``. We
    now keep everything in the database. For every row whose ``content`` is
    still empty we read the file from the user workspace and back-fill
    ``content`` + the ``*_json`` sidecar columns. Best-effort and idempotent:
    once ``content`` is populated the row is skipped on later boots.
    """
    import os

    from sqlalchemy import inspect, text

    from .config import user_workspace_dir

    insp = inspect(engine)
    if "valhallaentry" not in set(insp.get_table_names()):
        return
    columns = {col["name"] for col in insp.get_columns("valhallaentry")}
    if "content" not in columns:
        return  # column migration hasn't run yet

    imported = 0
    with engine.begin() as conn:
        rows = conn.execute(
            text(
                "SELECT id, user_id, file_path FROM valhallaentry "
                "WHERE (content IS NULL OR content = '') AND file_path != ''"
            )
        ).mappings().all()
        for row in rows:
            file_path = str(row.get("file_path") or "").strip()
            if not file_path:
                continue
            # Legacy layout: <user_workspace>/Valhalla/<file_path>
            abs_path = os.path.join(
                user_workspace_dir(int(row["user_id"])), "Valhalla", file_path.replace("/", os.sep)
            )
            content = _read_text_file(abs_path)
            if not content:
                continue
            gen_dir = os.path.dirname(abs_path)
            unfinished = _read_json_file(os.path.join(gen_dir, "unfinished.json"))
            artifacts = _read_json_file(os.path.join(gen_dir, "artifacts.json"))
            token_report = _read_json_file(os.path.join(gen_dir, "token_report.json"))
            conn.execute(
                text(
                    "UPDATE valhallaentry SET content = :content, "
                    "unfinished_json = :unfinished, artifacts_json = :artifacts, "
                    "token_report_json = :token_report WHERE id = :id"
                ),
                {
                    "content": content,
                    "unfinished": json.dumps(
                        (unfinished or {}).get("items", []) if isinstance(unfinished, dict) else [],
                        ensure_ascii=False,
                    ),
                    "artifacts": json.dumps(
                        (artifacts or {}).get("items", []) if isinstance(artifacts, dict) else [],
                        ensure_ascii=False,
                    ),
                    "token_report": json.dumps(token_report or {}, ensure_ascii=False),
                    "id": row["id"],
                },
            )
            imported += 1
    if imported:
        logger.info(f"Valhalla: imported {imported} legacy file entries into the database")


def _cleanup_dead_workspace_folders(engine) -> None:
    """Remove workspace subfolders that no longer back any feature.

    - ``BrainCore`` / ``EvolutionArena`` / ``SystemSetting``: never (or no
      longer) file-backed — evolution and settings live in the database.
    - ``Valhalla``: removed per user only once every one of that user's
      ``valhallaentry`` rows has its ``content`` imported, so we never delete
      a file whose body hasn't made it into the DB yet ("先迁库再删").

    Best-effort: failures are logged and never abort startup.
    """
    import os

    from sqlalchemy import inspect, text

    from .config import WORKSPACE_DIR, user_workspace_dir

    if not os.path.isdir(WORKSPACE_DIR):
        return

    # Users whose Valhalla content is fully migrated (no rows left with an
    # on-disk file_path but empty content).
    valhalla_safe_users: set[int] = set()
    valhalla_table_present = False
    insp = inspect(engine)
    if "valhallaentry" in set(insp.get_table_names()):
        valhalla_table_present = True
        with engine.begin() as conn:
            pending = {
                int(r[0])
                for r in conn.execute(
                    text(
                        "SELECT DISTINCT user_id FROM valhallaentry "
                        "WHERE (content IS NULL OR content = '') AND file_path != ''"
                    )
                ).all()
            }
        all_users = {
            int(name) for name in os.listdir(WORKSPACE_DIR) if name.isdigit()
        }
        valhalla_safe_users = all_users - pending

    for name in os.listdir(WORKSPACE_DIR):
        if not name.isdigit():
            continue
        user_id = int(name)
        user_dir = user_workspace_dir(user_id)
        for dead in ("BrainCore", "EvolutionArena", "SystemSetting"):
            _rmtree_quiet(os.path.join(user_dir, dead))
        if valhalla_table_present and user_id in valhalla_safe_users:
            _rmtree_quiet(os.path.join(user_dir, "Valhalla"))


def _rmtree_quiet(path: str) -> None:
    import os
    import shutil

    try:
        if os.path.isdir(path):
            shutil.rmtree(path, ignore_errors=True)
    except Exception as exc:
        logger.exception(f"failed to remove legacy workspace folder {path}: {exc}")


def _read_text_file(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""


def _read_json_file(path: str):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _consolidate_bot_session_routes(engine) -> None:
    """Copy legacy ``feishusessionroute`` + ``qqsessionroute`` rows into the
    unified ``botsessionroute`` table.

    Idempotent: rows whose (channel, user, ai_config, ai_kind, session_id)
    already exist in the new table are skipped, so repeat boots do not
    duplicate. The legacy tables are NOT dropped — they stay as a safety
    net until a separate cleanup pass removes them.
    """
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    existing_tables = set(insp.get_table_names())
    if "botsessionroute" not in existing_tables:
        return  # create_all hasn't materialized the new table yet

    def _copy(channel: str, src_table: str, build_target: callable) -> None:
        if src_table not in existing_tables:
            return
        with engine.begin() as conn:
            rows = conn.execute(text(f"SELECT * FROM {src_table}")).mappings().all()
            for row in rows:
                exists = conn.execute(
                    text(
                        "SELECT id FROM botsessionroute "
                        "WHERE channel = :channel AND user_id = :uid "
                        "AND ai_config_id = :cid AND ai_kind = :kind "
                        "AND session_id = :sid LIMIT 1"
                    ),
                    {
                        "channel": channel,
                        "uid": row["user_id"],
                        "cid": row["ai_config_id"],
                        "kind": row["ai_kind"],
                        "sid": row["session_id"],
                    },
                ).first()
                if exists:
                    continue
                target_json, extras = build_target(row)
                conn.execute(
                    text(
                        "INSERT INTO botsessionroute "
                        "(channel, user_id, ai_config_id, ai_kind, session_id, target_json, "
                        " source_message_id, source_event_id, next_msg_seq, created_at, updated_at) "
                        "VALUES (:channel, :uid, :cid, :kind, :sid, :tj, "
                        " :smid, :seid, :seq, :ca, :ua)"
                    ),
                    {
                        "channel": channel,
                        "uid": row["user_id"],
                        "cid": row["ai_config_id"],
                        "kind": row["ai_kind"],
                        "sid": row["session_id"],
                        "tj": target_json,
                        "smid": extras.get("source_message_id", ""),
                        "seid": extras.get("source_event_id", ""),
                        "seq": extras.get("next_msg_seq", 1),
                        "ca": row.get("created_at"),
                        "ua": row.get("updated_at"),
                    },
                )

    def _build_feishu(row) -> tuple[str, dict]:
        return (
            json.dumps(
                {
                    "receive_id": row.get("receive_id", "") or "",
                    "receive_id_type": row.get("receive_id_type", "chat_id") or "chat_id",
                },
                ensure_ascii=False,
            ),
            {},
        )

    def _build_qq(row) -> tuple[str, dict]:
        return (
            json.dumps(
                {
                    "target_id": row.get("target_id", "") or "",
                    "target_type": row.get("target_type", "c2c") or "c2c",
                },
                ensure_ascii=False,
            ),
            {
                "source_message_id": row.get("source_message_id", "") or "",
                "source_event_id": row.get("source_event_id", "") or "",
                "next_msg_seq": int(row.get("next_msg_seq", 1) or 1),
            },
        )

    _copy("feishu", "feishusessionroute", _build_feishu)
    _copy("qq", "qqsessionroute", _build_qq)


def run_pending_migrations() -> None:
    _migrate_assistantaiconfig_strip_markdown_symbols()
    _migrate_user_ui_plain_text_output_enabled()
    _migrate_user_role()
    _migrate_endpointagentpresence_tool_defs()
    _migrate_agenttypemcppermission_agent_id()
    _migrate_agenttypemcppermission_nullable_ai_config()
    _migrate_assistantaiconfig_strip_endpoint_mcp_tools()
    _migrate_assistantaiconfig_prune_unknown_mcp_tools()
    _migrate_valhallaentry_content()
    _migrate_chatmessagemedia_message_cascade()
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


def _migrate_assistantaiconfig_strip_markdown_symbols() -> None:
    # Add the column on every supported backend so existing databases keep
    # working after the schema bump.
    from ..database import engine

    if database_dialect() == "sqlite":
        with engine.begin() as conn:
            result = conn.exec_driver_sql("PRAGMA table_info(assistantaiconfig)")
            existing = {row[1] for row in result.fetchall()}
            if "strip_markdown_symbols" not in existing:
                conn.exec_driver_sql(
                    "ALTER TABLE assistantaiconfig ADD COLUMN strip_markdown_symbols BOOLEAN DEFAULT 0"
                )
            conn.exec_driver_sql(
                "UPDATE assistantaiconfig SET strip_markdown_symbols = 0 "
                "WHERE strip_markdown_symbols IS NULL"
            )
        return

    with engine.begin() as conn:
        conn.exec_driver_sql(
            "ALTER TABLE assistantaiconfig "
            "ADD COLUMN IF NOT EXISTS strip_markdown_symbols BOOLEAN DEFAULT FALSE"
        )
        conn.exec_driver_sql(
            "UPDATE assistantaiconfig SET strip_markdown_symbols = FALSE "
            "WHERE strip_markdown_symbols IS NULL"
        )


def _migrate_chatmessagemedia_message_cascade() -> None:
    """Ensure deleting a chat message also deletes DB-backed screenshot media."""
    from ..database import engine
    from sqlalchemy import inspect

    insp = inspect(engine)
    if "chatmessagemedia" not in set(insp.get_table_names()):
        return

    if database_dialect() != "postgresql":
        return

    with engine.begin() as conn:
        conn.exec_driver_sql(
            "ALTER TABLE chatmessagemedia "
            "DROP CONSTRAINT IF EXISTS chatmessagemedia_message_id_fkey"
        )
        conn.exec_driver_sql(
            "ALTER TABLE chatmessagemedia "
            "ADD CONSTRAINT chatmessagemedia_message_id_fkey "
            "FOREIGN KEY (message_id) REFERENCES chatmessage(id) ON DELETE CASCADE"
        )


def _migrate_user_ui_plain_text_output_enabled() -> None:
    from ..database import engine

    if database_dialect() == "sqlite":
        with engine.begin() as conn:
            result = conn.exec_driver_sql("PRAGMA table_info(user)")
            existing = {row[1] for row in result.fetchall()}
            if "ui_plain_text_output_enabled" not in existing:
                conn.exec_driver_sql(
                    "ALTER TABLE user ADD COLUMN ui_plain_text_output_enabled BOOLEAN DEFAULT 0"
                )
            conn.exec_driver_sql(
                "UPDATE user SET ui_plain_text_output_enabled = 0 "
                "WHERE ui_plain_text_output_enabled IS NULL"
            )
        return

    with engine.begin() as conn:
        conn.exec_driver_sql(
            'ALTER TABLE "user" '
            "ADD COLUMN IF NOT EXISTS ui_plain_text_output_enabled BOOLEAN DEFAULT FALSE"
        )
        conn.exec_driver_sql(
            'UPDATE "user" SET ui_plain_text_output_enabled = FALSE '
            "WHERE ui_plain_text_output_enabled IS NULL"
        )


def _migrate_endpointagentpresence_tool_defs() -> None:
    """Add ``tool_defs_json`` to the endpoint presence snapshot.

    Endpoint agents now ship their own tool schemas at register time; the
    server stores them here so it never hardcodes per-tool schemas. Existing
    databases that predate this column get it back-filled to ``{}`` (legacy
    rows simply fall back to a generic schema until the agent reconnects).
    Runs on every backend.
    """
    from ..database import engine
    from sqlalchemy import inspect

    insp = inspect(engine)
    if "endpointagentpresence" not in set(insp.get_table_names()):
        return
    columns = {col["name"] for col in insp.get_columns("endpointagentpresence")}
    if "tool_defs_json" in columns:
        return
    if database_dialect() == "sqlite":
        with engine.begin() as conn:
            conn.exec_driver_sql(
                "ALTER TABLE endpointagentpresence ADD COLUMN tool_defs_json TEXT DEFAULT '{}'"
            )
    else:
        with engine.begin() as conn:
            conn.exec_driver_sql(
                "ALTER TABLE endpointagentpresence "
                "ADD COLUMN IF NOT EXISTS tool_defs_json TEXT DEFAULT '{}'"
            )


def _migrate_agenttypemcppermission_agent_id() -> None:
    """Add ``agent_id`` to the endpoint MCP permission table.

    Scope moved from per-(AI, agent-type) to per-individual-agent. Existing rows
    keyed only by type can't be safely remapped to a specific agent id, so they
    back-fill ``agent_id=''`` and are simply ignored by the new per-agent lookup
    (the agent starts closed until rescoped in the Workshop). Runs on every
    backend.
    """
    from ..database import engine
    from sqlalchemy import inspect

    insp = inspect(engine)
    if "agenttypemcppermission" not in set(insp.get_table_names()):
        return
    columns = {col["name"] for col in insp.get_columns("agenttypemcppermission")}
    if "agent_id" in columns:
        return
    if database_dialect() == "sqlite":
        with engine.begin() as conn:
            conn.exec_driver_sql(
                "ALTER TABLE agenttypemcppermission ADD COLUMN agent_id TEXT DEFAULT ''"
            )
    else:
        with engine.begin() as conn:
            conn.exec_driver_sql(
                "ALTER TABLE agenttypemcppermission ADD COLUMN IF NOT EXISTS agent_id TEXT DEFAULT ''"
            )


def _migrate_agenttypemcppermission_nullable_ai_config() -> None:
    """Allow endpoint MCP scopes to be saved before an agent is assigned.

    The permission scope is keyed by ``(user_id, agent_id)`` now; ``ai_config_id``
    is only informational. Older Postgres databases still have a NOT NULL
    constraint from the previous per-(AI, type) schema, which breaks saving MCP
    permissions for an unassigned Workshop agent.
    """
    from ..database import engine
    from sqlalchemy import inspect

    insp = inspect(engine)
    if "agenttypemcppermission" not in set(insp.get_table_names()):
        return
    columns = {
        col["name"]: col
        for col in insp.get_columns("agenttypemcppermission")
    }
    column = columns.get("ai_config_id")
    if not column or column.get("nullable", True):
        return

    if database_dialect() == "postgresql":
        with engine.begin() as conn:
            conn.exec_driver_sql(
                "ALTER TABLE agenttypemcppermission ALTER COLUMN ai_config_id DROP NOT NULL"
            )


def _migrate_assistantaiconfig_strip_endpoint_mcp_tools() -> None:
    """Remove legacy endpoint-agent tools from AI ``mcp_tools`` JSON.

    Desktop/browser tools used to be stored directly on the AI config in some
    old rows. They are now controlled only by per-agent Workshop scope; leaving
    stale names here makes ``mcp.list_tools`` expose them even after the AI's
    visible MCP list is unchecked.
    """
    from ..database import engine
    from sqlalchemy import inspect, text
    from connector_runtime.dispatch.desktop_agent_tools import is_endpoint_tool_config_name

    insp = inspect(engine)
    if "assistantaiconfig" not in set(insp.get_table_names()):
        return
    columns = {col["name"] for col in insp.get_columns("assistantaiconfig")}
    if "mcp_tools" not in columns:
        return

    with engine.begin() as conn:
        rows = conn.execute(text("SELECT id, mcp_tools FROM assistantaiconfig")).mappings().all()
        for row in rows:
            try:
                parsed = json.loads(row.get("mcp_tools") or "[]")
            except Exception:
                continue
            if not isinstance(parsed, list):
                continue
            next_tools = []
            seen = set()
            changed = False
            for item in parsed:
                tool = str(item or "").strip() if isinstance(item, str) else ""
                if not tool:
                    changed = True
                    continue
                if is_endpoint_tool_config_name(tool):
                    changed = True
                    continue
                if tool in seen:
                    changed = True
                    continue
                next_tools.append(tool)
                seen.add(tool)
            if not changed:
                continue
            conn.execute(
                text("UPDATE assistantaiconfig SET mcp_tools = :tools WHERE id = :id"),
                {"tools": json.dumps(next_tools, ensure_ascii=False), "id": row["id"]},
            )


def _live_registered_tool_names() -> set:
    """Authoritative set of currently-valid MCP tool names.

    Builtin registry tools (plugins included) plus the self-inspection tools.
    Returns an empty set if the registry cannot be loaded so callers can refuse
    to prune rather than risk mass-deleting a still-valid config.
    """
    try:
        # Plugins register into the same live registry singleton; make sure
        # they are loaded before snapshotting so plugin tools are not pruned.
        from mcp_runtime.mcp.loader import load_plugins_on_startup

        try:
            load_plugins_on_startup()
        except Exception:
            pass
        from mcp_runtime.mcp.registry import registry as _registry
        from mcp_runtime.mcp.core import MCP_INTROSPECTION_TOOLS

        names = {str(t.get("name") or "").strip() for t in _registry.list_tools() if t.get("name")}
        names |= set(MCP_INTROSPECTION_TOOLS)
        return names
    except Exception:
        return set()


def _migrate_assistantaiconfig_prune_unknown_mcp_tools() -> None:
    """Drop stale tool names from AI ``mcp_tools`` that no longer map to any
    registered MCP tool.

    Tools removed in earlier refactors (e.g. ``admin.dispatch_task``,
    ``feishu.send_message``, ``human.ask``) used to linger in persisted config
    allow-lists. They can never be called, but they polluted the prompt tool
    catalog and ``mcp.list_tools``. This prunes them once so they stop being
    retained. Endpoint-config names stay handled by the dedicated strip above.
    """
    from ..database import engine
    from sqlalchemy import inspect, text
    from connector_runtime.dispatch.desktop_agent_tools import is_endpoint_tool_config_name

    valid = _live_registered_tool_names()
    # Safety guard: a degraded / empty registry must never wipe every config.
    if len(valid) < 10:
        return

    insp = inspect(engine)
    if "assistantaiconfig" not in set(insp.get_table_names()):
        return
    columns = {col["name"] for col in insp.get_columns("assistantaiconfig")}
    if "mcp_tools" not in columns:
        return

    with engine.begin() as conn:
        rows = conn.execute(text("SELECT id, mcp_tools FROM assistantaiconfig")).mappings().all()
        for row in rows:
            try:
                parsed = json.loads(row.get("mcp_tools") or "[]")
            except Exception:
                continue
            if not isinstance(parsed, list):
                continue
            next_tools = []
            seen = set()
            changed = False
            for item in parsed:
                tool = str(item or "").strip() if isinstance(item, str) else ""
                if not tool:
                    changed = True
                    continue
                # Endpoint tools are governed by per-agent scope, not stored here.
                if is_endpoint_tool_config_name(tool):
                    changed = True
                    continue
                if tool not in valid:
                    changed = True
                    continue
                if tool in seen:
                    changed = True
                    continue
                next_tools.append(tool)
                seen.add(tool)
            if not changed:
                continue
            conn.execute(
                text("UPDATE assistantaiconfig SET mcp_tools = :tools WHERE id = :id"),
                {"tools": json.dumps(next_tools, ensure_ascii=False), "id": row["id"]},
            )


def _migrate_valhallaentry_content() -> None:
    """Add the in-DB content columns to ``valhallaentry``.

    Valhalla generational handoffs used to keep their full body in files
    (``last_words.md`` etc.) with only an excerpt in the DB. They now live
    entirely in the database, so existing rows get these columns back-filled
    to empty defaults and the file content is imported separately by
    ``_consolidate_valhalla_files_to_db``. Runs on every backend.
    """
    from ..database import engine
    from sqlalchemy import inspect

    insp = inspect(engine)
    if "valhallaentry" not in set(insp.get_table_names()):
        return
    columns = {col["name"] for col in insp.get_columns("valhallaentry")}
    additions = (
        ("content", "TEXT DEFAULT ''"),
        ("unfinished_json", "TEXT DEFAULT '[]'"),
        ("artifacts_json", "TEXT DEFAULT '[]'"),
        ("token_report_json", "TEXT DEFAULT '{}'"),
    )
    is_sqlite = database_dialect() == "sqlite"
    with engine.begin() as conn:
        for name, definition in additions:
            if name in columns:
                continue
            if is_sqlite:
                conn.exec_driver_sql(
                    f"ALTER TABLE valhallaentry ADD COLUMN {name} {definition}"
                )
            else:
                conn.exec_driver_sql(
                    f"ALTER TABLE valhallaentry ADD COLUMN IF NOT EXISTS {name} {definition}"
                )


def _migrate_user_role() -> None:
    """Add the platform-level ``role`` (+ ``created_at``) columns and make
    sure exactly one ``owner`` exists.

    Runs on every backend. Existing rows backfill to ``member``; the
    lowest-id user is promoted to ``owner`` when no owner is present yet so
    pre-existing single-user installs keep full admin access after the
    upgrade. New installs get their owner assigned at registration time.
    """
    import time as _time

    from ..database import engine

    if database_dialect() == "sqlite":
        table = "user"
        with engine.begin() as conn:
            existing = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(user)").fetchall()}
            if "role" not in existing:
                conn.exec_driver_sql("ALTER TABLE user ADD COLUMN role TEXT DEFAULT 'member'")
            if "created_at" not in existing:
                conn.exec_driver_sql("ALTER TABLE user ADD COLUMN created_at REAL")
            conn.exec_driver_sql(
                "UPDATE user SET role = 'member' "
                "WHERE role IS NULL OR role = '' OR role NOT IN ('owner', 'admin', 'member')"
            )
            conn.exec_driver_sql(
                f"UPDATE user SET created_at = {_time.time()} WHERE created_at IS NULL"
            )
    else:
        table = '"user"'
        with engine.begin() as conn:
            conn.exec_driver_sql('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS role TEXT DEFAULT \'member\'')
            conn.exec_driver_sql('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS created_at DOUBLE PRECISION')
            conn.exec_driver_sql(
                'UPDATE "user" SET role = \'member\' '
                "WHERE role IS NULL OR role = '' OR role NOT IN ('owner', 'admin', 'member')"
            )
            conn.exec_driver_sql(
                f'UPDATE "user" SET created_at = {_time.time()} WHERE created_at IS NULL'
            )

    # Bootstrap an owner from the oldest account when none exists yet.
    with engine.begin() as conn:
        has_owner = conn.exec_driver_sql(
            f"SELECT 1 FROM {table} WHERE role = 'owner' LIMIT 1"
        ).first()
        if not has_owner:
            min_id = conn.exec_driver_sql(f"SELECT MIN(id) FROM {table}").scalar()
            if min_id is not None:
                conn.exec_driver_sql(
                    f"UPDATE {table} SET role = 'owner' WHERE id = {int(min_id)}"
                )


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
    # Rename the send-message tools out of the ambiguous user./ai. prefixes into
    # a dedicated message.* namespace (UI now groups them under 「发消息」).
    _rename_role_permission_tool_item(cursor, "user.send_message", "message.send_to_user")
    _rename_role_permission_tool_item(cursor, "ai.send_message", "message.send_to_ai")
    # web.search 并入 workspace 命名空间；project/memory MCP 工具组已下线。
    _rename_role_permission_tool_item(cursor, "web.search", "workspace.search")
    for _tool in (
        "project.list_projects",
        "project.create_project",
        "project.update_project",
        "project.delete_project",
        "memory.write",
        "memory.search",
        "memory.list",
        "memory.update",
        "memory.archive",
        "debug.ping",
    ):
        _remove_role_permission_tool_item(cursor, _tool)


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
    # The legacy ``feishu_*`` / ``qq_*`` flat columns are consolidated into
    # ``bot_configs`` JSON by ``_consolidate_assistantaiconfig_bot_configs``.
    # The add-column calls used to live here; they're intentionally gone so
    # we don't re-add columns we drop in the dialect-agnostic migration.
    _add_column(cursor, "assistantaiconfig", "project_id", "TEXT", existing)
    _add_column(cursor, "assistantaiconfig", "project_name", "TEXT", existing)
    _add_column(cursor, "assistantaiconfig", "sort_order", "INTEGER DEFAULT 100", existing)
    _add_column(cursor, "assistantaiconfig", "model_preset_id", "TEXT DEFAULT ''", existing)
    _add_column(cursor, "assistantaiconfig", "strip_markdown_symbols", "BOOLEAN DEFAULT 0", existing)
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
    cursor.execute(
        "UPDATE assistantaiconfig SET strip_markdown_symbols = 0 "
        "WHERE strip_markdown_symbols IS NULL"
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
    # Rename the send-message tools out of the ambiguous user./ai. prefixes into
    # a dedicated message.* namespace (UI now groups them under 「发消息」). Runs
    # after the anchor-based appends above so existing scopes migrate cleanly.
    _collapse_json_array_items(
        cursor, "assistantaiconfig", "mcp_tools", ["user.send_message"], "message.send_to_user"
    )
    _collapse_json_array_items(
        cursor, "assistantaiconfig", "mcp_tools", ["ai.send_message"], "message.send_to_ai"
    )
    # web.search 并入 workspace 命名空间；project/memory MCP 工具组已下线。
    _collapse_json_array_items(
        cursor, "assistantaiconfig", "mcp_tools", ["web.search"], "workspace.search"
    )
    for _tool in (
        "project.list_projects",
        "project.create_project",
        "project.update_project",
        "project.delete_project",
        "memory.write",
        "memory.search",
        "memory.list",
        "memory.update",
        "memory.archive",
        "debug.ping",
    ):
        _remove_json_array_item(cursor, "assistantaiconfig", "mcp_tools", _tool)
    cursor.execute(
        "UPDATE assistantaiconfig SET bot_channel = 'feishu' "
        "WHERE bot_channel IS NULL OR bot_channel = '' "
        "OR bot_channel NOT IN ('feishu', 'qq')"
    )
    # Normalize qq_default_target_type only while the legacy column still
    # exists; once the bot_configs consolidation drops it, this is a no-op.
    if "qq_default_target_type" in _existing_columns(cursor, "assistantaiconfig"):
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


def _rename_role_permission_tool_item(cursor: sqlite3.Cursor, old_item: str, new_item: str) -> None:
    """Rename a single tool name inside every user's role_mcp_permissions map,
    preserving its position within each role's list and de-duplicating."""
    cursor.execute(
        "SELECT id, role_mcp_permissions FROM user WHERE role_mcp_permissions LIKE ?",
        (f"%{old_item}%",),
    )
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
            for tool in tools:
                mapped = new_item if tool == old_item else tool
                if mapped != tool:
                    changed = True
                if mapped not in seen:
                    next_tools.append(mapped)
                    seen.add(mapped)
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

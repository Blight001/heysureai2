"""Path constants + legacy aliases for env-driven settings.

Env vars live in :mod:`api.core.settings` now. This module re-exports the
historical constant names (``DATABASE_URL`` / ``INTERNAL_TOKEN`` / …)
so existing callers keep working — new code should import ``settings``
from ``api.core.settings`` directly.
"""

import os

from .settings import SERVER_DIR, SQLITE_FILE, SQLITE_URL, settings


# ---------- Paths (no env, no migration needed) ----------
DATA_DIR = os.path.join(SERVER_DIR, "data")
WORKSPACE_DIR = os.path.join(DATA_DIR, "workspace")

USER_WORKSPACE_SUBFOLDERS = (
    "Valhalla",
    "BrainCore",
    "KnowledgeBase",
    "EvolutionArena",
    "SystemSetting",
)


def user_workspace_dir(user_id: int) -> str:
    return os.path.join(WORKSPACE_DIR, str(user_id))


# ---------- Legacy aliases (delegate to settings) ----------
DATABASE_URL = settings.database_url
INTERNAL_TOKEN = settings.internal_token
MCP_RUNTIME_URL = settings.mcp_runtime_url
CONNECTOR_RUNTIME_URL = settings.connector_runtime_url
JWT_SECRET_KEY = settings.jwt_secret
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 1 day
AGENT_TOKEN = settings.agent_token
DEFAULT_CHAT_MAX_STEPS = settings.chat_max_steps


def database_dialect() -> str:
    return settings.database_dialect


def psycopg_dsn() -> str:
    return settings.psycopg_dsn

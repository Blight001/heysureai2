"""Centralized configuration.

Everything that previously read environment variables or hard-coded paths
inline lives here. Other modules should import the constants below instead
of touching ``os.environ`` directly so the surface area is reviewable.
"""

import os

# ---------- Paths ----------
# server/ directory (parent of the api/ package).
SERVER_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(SERVER_DIR, "data")
WORKSPACE_DIR = os.path.join(DATA_DIR, "workspace")
SQLITE_FILE = os.path.join(DATA_DIR, "heysure.db")
SQLITE_URL = f"sqlite:///{SQLITE_FILE}"

# ---------- Database ----------
# DATABASE_URL overrides SQLITE_URL. Supports both sqlite:// and postgresql://.
# Default keeps the historical SQLite path so single-machine dev keeps working
# without any env setup.
DATABASE_URL = os.environ.get("DATABASE_URL", SQLITE_URL).strip() or SQLITE_URL


def database_dialect() -> str:
    """Return 'sqlite' or 'postgresql' based on DATABASE_URL scheme."""
    url = DATABASE_URL.lower()
    if url.startswith("postgres"):
        return "postgresql"
    return "sqlite"


def psycopg_dsn() -> str:
    """Return a libpq-compatible Postgres URL for psycopg.

    SQLAlchemy accepts URLs like ``postgresql+psycopg://...``. psycopg's own
    connect API does not, so we normalize the driver suffix away here.
    """
    if DATABASE_URL.lower().startswith("postgresql+"):
        return "postgresql://" + DATABASE_URL.split("://", 1)[1]
    if DATABASE_URL.lower().startswith("postgres+"):
        return "postgresql://" + DATABASE_URL.split("://", 1)[1]
    return DATABASE_URL

USER_WORKSPACE_SUBFOLDERS = (
    "Valhalla",
    "BrainCore",
    "KnowledgeBase",
    "EvolutionArena",
    "SystemSetting",
)


def user_workspace_dir(user_id: int) -> str:
    return os.path.join(WORKSPACE_DIR, str(user_id))


# ---------- Auth ----------
JWT_SECRET_KEY = os.environ.get(
    "HEYSURE_JWT_SECRET",
    "heysure-ai-secret-key-change-this-in-production",
)
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 1 day


# ---------- Socket.IO ----------
AGENT_TOKEN = os.environ.get("AGENT_TOKEN", "").strip()


# ---------- Internal service mesh ----------
# Shared Bearer secret for /internal/* endpoints across split services.
# Empty value means "monolith deployment" — internal endpoints stay reachable
# in-process and the network token check is skipped only for in-process
# callers. External HTTP calls always require the token.
INTERNAL_TOKEN = os.environ.get("HEYSURE_INTERNAL_TOKEN", "").strip()

# When set, ``ai-runtime`` / ``api-gateway`` forward MCP tool execution and
# tool-catalog reads to the mcp-runtime service over HTTP instead of using
# the in-process registry. Leave unset for the monolith deployment.
MCP_RUNTIME_URL = os.environ.get("MCP_RUNTIME_URL", "").strip()

# When set, ``ai-runtime`` / ``api-gateway`` forward agent task dispatch and
# outbound connector messages to connector-runtime. Leave unset for the
# monolith deployment.
CONNECTOR_RUNTIME_URL = os.environ.get("CONNECTOR_RUNTIME_URL", "").strip()


# ---------- Chat worker tunables ----------
def _coerce_max_steps(value: object, default: int) -> int:
    try:
        return max(1, min(999, int(value or default)))
    except Exception:
        return max(1, min(999, int(default)))


DEFAULT_CHAT_MAX_STEPS = _coerce_max_steps(os.getenv("HEYSURE_CHAT_MAX_STEPS"), 48)

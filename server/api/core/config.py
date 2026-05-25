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


# ---------- Chat worker tunables ----------
def _coerce_max_steps(value: object, default: int) -> int:
    try:
        return max(1, min(999, int(value or default)))
    except Exception:
        return max(1, min(999, int(default)))


DEFAULT_CHAT_MAX_STEPS = _coerce_max_steps(os.getenv("HEYSURE_CHAT_MAX_STEPS"), 48)

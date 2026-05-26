from typing import Optional, Tuple

import socketio
from sqlmodel import Session, select

from .auth import decode_access_token
from .core.config import AGENT_TOKEN
from .database import engine

# Socket.IO Server
# Browser screenshots are transported as base64 data URLs before the server
# persists them to the workspace. Complex pages can exceed Socket.IO's small
# default payload limit, which makes the agent result disappear and leaves the
# caller waiting until the dispatch timeout.
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins='*',
    max_http_buffer_size=20_000_000,
)

# Connected desktop/browser agents: sid -> agent info dict.
agents = {}


def agent_token_required() -> bool:
    # Agent registration always requires a logged-in user JWT now.
    # The AGENT_TOKEN env var is an optional shared-secret bypass for
    # server-trusted internal agents.
    return True


def is_agent_shared_secret(token: str) -> bool:
    """Return True if ``token`` matches the shared AGENT_TOKEN env var.

    Empty AGENT_TOKEN disables this bypass (the default in dev).
    """
    if not AGENT_TOKEN:
        return False
    return str(token or "").strip() == AGENT_TOKEN


def resolve_agent_user(token: str) -> Optional[Tuple[int, str]]:
    """Validate a token as a user JWT and return ``(user_id, account)``.

    The agent client sends the same user JWT it received from ``/api/auth/login``
    as its ``token``. We decode it here so the server can refuse registration
    for agents whose user hasn't logged in (or whose token has expired).
    Returns ``None`` if the token is missing, malformed, expired, or maps to
    no user.
    """
    raw = str(token or "").strip()
    if not raw:
        return None
    if raw.startswith("Bearer "):
        raw = raw.split(" ", 1)[1].strip()
    payload = decode_access_token(raw)
    if not payload:
        return None
    account = payload.get("sub")
    if not account:
        return None
    # Lazy import to avoid a circular dependency between sio and models.
    from .models import User

    with Session(engine) as session:
        user = session.exec(select(User).where(User.account == account)).first()
        if user is None:
            return None
        return int(user.id), str(user.account)


def is_agent_token_valid(token: str) -> bool:
    """Backwards-compatible boolean variant of the new auth check."""
    if is_agent_shared_secret(token):
        return True
    return resolve_agent_user(token) is not None

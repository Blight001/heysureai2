import socketio

from .core.config import AGENT_TOKEN

# Socket.IO Server
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')

# Connected desktop/browser agents: sid -> agent info dict.
agents = {}


def agent_token_required() -> bool:
    return bool(AGENT_TOKEN)


def is_agent_token_valid(token: str) -> bool:
    if not AGENT_TOKEN:
        return True
    return str(token or "").strip() == AGENT_TOKEN

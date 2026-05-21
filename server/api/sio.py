import os

import socketio

# Socket.IO Server
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')

# Store agents: sid -> agent info dict
agents = {}

# Optional shared secret. When set (via env), desktop agents must present a
# matching token in agent:register, otherwise registration is rejected. When
# empty, registration is open (backward compatible with existing setups).
AGENT_TOKEN = os.environ.get("AGENT_TOKEN", "").strip()


def agent_token_required() -> bool:
    return bool(AGENT_TOKEN)


def is_agent_token_valid(token: str) -> bool:
    if not AGENT_TOKEN:
        return True
    return str(token or "").strip() == AGENT_TOKEN

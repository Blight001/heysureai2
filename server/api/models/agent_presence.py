"""Live presence snapshot of connected endpoint (desktop / browser) agents.

The in-memory ``agents`` registry only exists in the process that owns the
agent socket server (api-gateway). ai-runtime / mcp-runtime — and even a
separate worker process inside the same container — cannot see it, so they
could not tell which endpoint tools an AI may use. This table mirrors the live
registry into the shared DB so *every* process can resolve and classify
endpoint tools the same way.

One row per logical ``agent_id``. ``online`` is flipped on register / disconnect
(and reset on a fresh gateway boot); ``ai_config_id`` tracks the current
Workshop assignment; ``capabilities_json`` is the agent's type-filtered tool
list. Discovery reads ``online`` rows; dispatch still uses the live socket on
the gateway, so a stale ``online`` row at worst offers a tool whose dispatch
then fails gracefully.
"""

import time
from typing import Optional

from sqlmodel import Field, SQLModel


class EndpointAgentPresence(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(default=0, index=True)
    agent_id: str = Field(index=True)
    ai_config_id: Optional[int] = Field(default=None, index=True)
    # "desktop" | "browser"
    agent_type: str = Field(default="")
    # JSON array of the agent's (type-filtered) endpoint tool names.
    capabilities_json: str = Field(default="[]")
    online: bool = Field(default=True, index=True)
    updated_at: float = Field(default_factory=time.time)

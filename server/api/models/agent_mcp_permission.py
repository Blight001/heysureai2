"""Per-(AI, agent-type) endpoint MCP permission scope.

Endpoint (desktop / browser) agents advertise their full tool surface in the
``capabilities`` array of ``agent:register``. Which of those tools a given AI is
actually allowed to drive is stored here, keyed by ``(user_id, ai_config_id,
agent_type)`` where ``agent_type`` is ``"desktop"`` or ``"browser"``.

Keying by type (not by a volatile socket id) is what lets a reconnecting — or
swapped — agent of the same type inherit the previously configured scope
without re-configuration. ``tools_json`` is a JSON array of allowed tool names;
no row means "no restriction yet" → the AI may use every tool the connected
agent reports (see ``connector_runtime.dispatch.desktop_agent_tools``).
"""

import time
from typing import Optional

from sqlmodel import Field, SQLModel


class AgentTypeMcpPermission(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    ai_config_id: int = Field(foreign_key="assistantaiconfig.id", index=True)
    # "desktop" | "browser"
    agent_type: str = Field(index=True)
    # JSON-encoded list of allowed endpoint tool names.
    tools_json: str = Field(default="[]")
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)

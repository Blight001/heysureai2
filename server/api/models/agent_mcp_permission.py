"""Per-agent endpoint MCP permission scope.

Endpoint agents (Linux / desktop / browser) advertise their full tool surface
in the ``capabilities`` array of ``agent:register``. Which of those tools the
agent's bound AI may actually drive is stored here, keyed by ``(user_id,
agent_id)`` — i.e. **per individual agent**, so each connected device has its
own independent scope (set in the Workshop panel).

``tools_json`` is a JSON array of allowed tool names; no row means "no
restriction yet" → the bound AI may use every tool the agent reports (see
``connector_runtime.dispatch.desktop_agent_tools``). ``ai_config_id`` and
``agent_type`` are kept as informational columns (which AI the agent was bound
to / its kind when the scope was last saved) but are not part of the key, so the
scope follows the physical agent even if it is reassigned to a different AI.

The class name ``AgentTypeMcpPermission`` and table are retained from the
earlier per-type model to avoid a destructive rename; the keying is now
per-agent.
"""

import time
from typing import Optional

from sqlmodel import Field, SQLModel


class AgentTypeMcpPermission(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    # Stable logical agent id (from agent:register). The scope key.
    agent_id: str = Field(default="", index=True)
    # Informational: the AI the agent was bound to when the scope was saved.
    ai_config_id: Optional[int] = Field(default=None, index=True)
    # Informational: "linux" | "desktop" | "browser".
    agent_type: str = Field(default="", index=True)
    # JSON-encoded list of allowed endpoint tool names.
    tools_json: str = Field(default="[]")
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)

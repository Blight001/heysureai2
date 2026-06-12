"""Persistent AI → workshop-agent binding (知识与进化工坊).

The knowledge & evolution workshop is an endpoint agent (``agent/workshop/``)
that serves *many* AIs at once — unlike desktop/browser devices which are
bound 1:1 from the device side (``AgentAiBinding``), workshop binding is
declared from the AI side: each row says "this AI may use that workshop
agent's tools". An AI with no row cannot see or call any workshop tool.
"""

import time
from typing import Optional

from sqlmodel import Field, SQLModel


class WorkshopAiBinding(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    agent_id: str = Field(index=True)
    ai_config_id: int = Field(foreign_key="assistantaiconfig.id", index=True)
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)

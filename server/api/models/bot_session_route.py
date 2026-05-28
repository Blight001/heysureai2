"""Unified session-route table covering every bot channel.

Replaces the per-bot ``FeishuSessionRoute`` / ``QQSessionRoute`` tables.
A single row binds ``(channel, user, ai_config, ai_kind, session_id)`` to a
JSON-encoded addressing payload (``target_json``) plus a few QQ-specific
columns kept hot for atomic ``msg_seq`` updates.

Adding a new bot does not require a new table — the adapter just stores
its addressing payload under its own ``channel`` value.
"""

import time
from typing import Optional

from sqlmodel import Field, SQLModel


class BotSessionRoute(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    channel: str = Field(index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    ai_config_id: int = Field(foreign_key="assistantaiconfig.id", index=True)
    ai_kind: str = Field(default="core", index=True)
    session_id: str = Field(index=True)
    # JSON-encoded bot-specific addressing payload, e.g.
    #   Feishu: {"receive_id": "...", "receive_id_type": "..."}
    #   QQ:     {"target_id": "...", "target_type": "..."}
    target_json: str = Field(default="{}")
    # QQ requires the source message id + an in-order msg_seq for each
    # outbound reply; kept as columns so we can bump them atomically without
    # parsing target_json on every send. Feishu rows leave them empty.
    source_message_id: str = Field(default="")
    source_event_id: str = Field(default="")
    next_msg_seq: int = Field(default=1)
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)

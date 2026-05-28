"""DB models specific to the QQ bot."""

import time
from typing import Optional

from sqlmodel import Field, SQLModel


class QQSessionRoute(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    ai_config_id: int = Field(foreign_key="assistantaiconfig.id", index=True)
    ai_kind: str = Field(default="core", index=True)
    session_id: str = Field(index=True)
    target_id: str = Field(index=True)
    target_type: str = Field(default="c2c", index=True)
    source_message_id: str = Field(default="")
    source_event_id: str = Field(default="")
    next_msg_seq: int = Field(default=1)
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)

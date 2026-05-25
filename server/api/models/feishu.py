import time
from typing import Optional

from sqlmodel import Field, SQLModel


class FeishuSessionRoute(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    ai_config_id: int = Field(foreign_key="assistantaiconfig.id", index=True)
    ai_kind: str = Field(default="core", index=True)
    session_id: str = Field(index=True)
    receive_id: str = Field(index=True)
    receive_id_type: str = Field(default="chat_id", index=True)
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)

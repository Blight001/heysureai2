import time
from typing import Optional

from sqlmodel import Field, SQLModel


class TokenUsageSnapshot(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    ai_config_id: Optional[int] = Field(default=None, index=True)
    ai_kind: str = Field(default="assistant", index=True)
    bucket: str = Field(index=True)  # YYYY-MM-DD
    prompt_tokens: int = Field(default=0)
    completion_tokens: int = Field(default=0)
    total_tokens: int = Field(default=0)
    updated_at: float = Field(default_factory=time.time)


class AIRuntimeStatus(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    ai_config_id: Optional[int] = Field(default=None, index=True)
    ai_kind: str = Field(default="assistant", index=True)
    running: bool = Field(default=True)
    mcp_enabled: bool = Field(default=True)
    current_status: str = Field(default="idle")
    current_mcp_tool: str = Field(default="")
    updated_at: float = Field(default_factory=time.time)


class AITaskJob(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    job_id: str = Field(index=True, unique=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    ai_config_id: int = Field(foreign_key="assistantaiconfig.id", index=True)
    created_by_ai_config_id: Optional[int] = Field(default=None, index=True)  # dispatcher's AI config id
    created_by_session_id: Optional[str] = Field(default=None, index=True)  # dispatcher's chat session id
    completion_notified_at: Optional[float] = None
    ai_kind: str = Field(default="core", index=True)
    template_id: Optional[str] = Field(default=None, index=True)
    title: str
    instruction: str
    task_payload: Optional[str] = None
    priority: int = Field(default=5, index=True)
    status: str = Field(default="queued", index=True)  # queued/running/paused/completed/cancelled
    session_id: Optional[str] = Field(default=None, index=True)
    trigger_type: str = Field(default="manual", index=True)  # manual/schedule/preempt/resume/supervision
    last_run_id: Optional[str] = Field(default=None, index=True)
    last_supervised_at: Optional[float] = None
    supervision_count: int = Field(default=0)
    created_at: float = Field(default_factory=time.time, index=True)
    updated_at: float = Field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None

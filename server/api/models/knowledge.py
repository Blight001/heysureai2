import time
from typing import Optional

from sqlmodel import Field, SQLModel


class Memory(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    memory_id: str = Field(index=True, unique=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    ai_config_id: Optional[int] = Field(default=None, index=True)
    project_id: Optional[str] = Field(default=None, index=True)
    job_id: Optional[str] = Field(default=None, index=True)
    generation: int = Field(default=1)
    kind: str = Field(default="fact", index=True)  # fact/decision/lesson/todo/risk/template
    tags: str = Field(default="")  # comma-separated
    content: str = Field(default="")
    source: str = Field(default="{}")  # JSON: {chat_message_id, file_path,...}
    confidence: float = Field(default=0.6)
    archived: bool = Field(default=False, index=True)
    created_at: float = Field(default_factory=time.time, index=True)
    updated_at: float = Field(default_factory=time.time)


class EvolutionInput(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    evolution_input_id: str = Field(index=True, unique=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    source_ai_config_id: Optional[int] = Field(default=None, index=True)
    type: str = Field(default="lesson", index=True)  # prompt_rule/tool_rule/workflow_rule/memory/failure_case/success_case
    target_scope: str = Field(default="{}")  # JSON
    evidence: str = Field(default="[]")  # JSON array
    proposal: str = Field(default="")
    risk: str = Field(default="")
    review_status: str = Field(default="queued", index=True)  # queued/accepted/rejected/applied
    applied_to: str = Field(default="")
    created_at: float = Field(default_factory=time.time, index=True)
    updated_at: float = Field(default_factory=time.time)


class KnowledgeEntry(SQLModel, table=True):
    """传承知识库索引。真相在文件（KnowledgeBase/topics/<slug>.md），
    DB 仅做检索加速。

    与 Memory 表的关系：KnowledgeEntry 是面向"程序性记忆（怎么做某事）"
    的 superset。Memory 表保留兼容旧 memory.* MCP 调用，不在此重建。
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    memory_id: str = Field(index=True, unique=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    title: str = Field(default="")
    triggers: str = Field(default="")  # 逗号分隔的触发关键词
    scope: str = Field(default="global", index=True)  # global / ai:<id> / project:<id>
    scope_target: Optional[str] = Field(default=None)
    file_path: str = Field(default="")  # 相对 KnowledgeBase/ 根目录
    summary: str = Field(default="")  # 检索摘要，1-2 句
    status: str = Field(default="pending", index=True)  # pending / active / archived / rejected
    confidence: float = Field(default=0.6)
    use_count: int = Field(default=0)
    last_used_at: Optional[float] = Field(default=None)
    source_job_id: Optional[str] = Field(default=None, index=True)
    source_generation: Optional[int] = Field(default=None)
    source_ai_config_id: Optional[int] = Field(default=None, index=True)
    source_message_id: Optional[int] = Field(default=None)
    librarian_ai_config_id: Optional[int] = Field(default=None, index=True)  # 由哪个图书管理员负责
    created_at: float = Field(default_factory=time.time, index=True)
    updated_at: float = Field(default_factory=time.time)


class ValhallaEntry(SQLModel, table=True):
    """英灵殿事件索引。真相在文件，DB 仅做检索加速；删表可从文件重建。"""

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    ai_config_id: int = Field(foreign_key="assistantaiconfig.id", index=True)
    ai_name: str = Field(default="")
    job_id: str = Field(index=True)
    job_title: str = Field(default="")
    generation: int = Field(default=1)
    kind: str = Field(default="inherit", index=True)  # inherit / complete / aborted
    session_id: Optional[str] = Field(default=None, index=True)
    file_path: str = Field(default="")  # 相对 Valhalla/ 根目录的 markdown 路径
    summary_excerpt: str = Field(default="")  # 列表展示用，最多 ~280 字符
    token_used: int = Field(default=0)
    token_limit: int = Field(default=0)
    artifacts_count: int = Field(default=0)
    unfinished_count: int = Field(default=0)
    reason: Optional[str] = Field(default=None)  # aborted 才填
    created_at: float = Field(default_factory=time.time, index=True)

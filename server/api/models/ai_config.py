import time
from typing import Any, Dict, Optional

from sqlmodel import Field, SQLModel

_DEFAULT_MCP_TOOLS = (
    '["mcp.describe_tool","workspace.search","workspace.run_command",'
    '"admin.list_agents","admin.get_overview",'
    '"task.create","task.update","task.delete","task.list",'
    '"task.inherit","task.complete",'
    '"prompt.list_targets","prompt.read_ai","prompt.write_ai","prompt.read_system",'
    '"prompt.write_system","message.send_to_user","conversation.forget_before_current",'
    '"conversation.find","conversation.create","conversation.delete","message.send_to_ai"]'
)

_DEFAULT_SYSTEM_AUTO_CONTROL = (
    '{"enabled":false,'
    '"start_task_prompt":"你将收到一个任务，请先理解目标、约束与优先级，然后开始执行。",'
    '"resume_task_prompt":"请继续执行刚才被暂停的任务，先简要回顾当前进度，再继续推进直到可交付。",'
    '"supervision_prompt":"系统监督提醒：请确认当前任务是否已完成。若已完成请调用 task.complete 标记；若未完成请给出剩余步骤并继续执行。",'
    '"inheritance_notice":"当前思考量已达到阈值（{session_tokens}/{threshold}），建议立即开启传承流程，沉淀本轮结论与关键上下文。",'
    '"tasks":[]}'
)


class AssistantAIConfig(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    name: str = Field(index=True)
    description: str = Field(default="")
    api_key: str = Field(default="")
    base_url: str = Field(default="")
    model: str = Field(default="")
    model_preset_id: str = Field(default="", index=True)
    # 人格 Prompt 已迁出数据库，真相源为 KnowledgeBase/personas/<id>-<名>.md
    # （见 api.services.kb_store）。Create/Update 仍接收 prompt 字段，落盘到文件。
    strip_markdown_symbols: bool = Field(default=False)

    ai_role: str = Field(default="digital_member", index=True)  # assistant_admin / digital_member
    digital_member_role: str = Field(default="member")  # manager / member
    is_librarian: bool = Field(default=False, index=True)  # 图书管理员标志（同 user 下最多 1 个）

    platform: str = Field(default="Server-Core")
    generation: int = Field(default=1)
    token_limit: int = Field(default=10000)
    lifecycle_status: str = Field(default="working")  # learning / working / reproducing / dead
    current_behavior: str = Field(default="等待指令...")
    workspace_root: Optional[str] = Field(default=None)
    database_uri: Optional[str] = Field(default=None)

    # Bot integrations
    # ``bot_channel`` still picks the active channel; channel-specific
    # credentials and addressing live in the ``bot_configs`` JSON column so
    # adding a new bot doesn't require a schema migration.
    #
    # Shape:
    #   {"feishu": {"enabled": bool, "webhook_url": str, "app_id": str,
    #               "app_secret": str, "verification_token": str,
    #               "default_receive_id": str, "default_receive_id_type": str},
    #    "qq":     {"enabled": bool, "app_id": str, "app_secret": str,
    #               "sandbox": bool, "default_target_id": str,
    #               "default_target_type": str},
    #    ...      }
    bot_channel: str = Field(default="feishu", index=True)
    bot_configs: str = Field(default="{}")

    project_id: Optional[str] = Field(default=None, index=True)
    project_name: Optional[str] = None
    parent_ai_config_id: Optional[int] = Field(default=None, index=True)  # 直属上级 AI
    root_manager_ai_config_id: Optional[int] = Field(default=None, index=True)  # 治理树根节点
    management_scope: str = Field(default="self")  # self / children / project / global
    sort_order: int = Field(default=100)

    enabled: bool = Field(default=True)
    mcp_enabled: bool = Field(default=True)
    switch_key: str = Field(default="assistant_default")
    mcp_tools: str = Field(default=_DEFAULT_MCP_TOOLS)
    system_auto_control: str = Field(default=_DEFAULT_SYSTEM_AUTO_CONTROL)

    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)


class AssistantAIConfigCreate(SQLModel):
    name: str
    description: Optional[str] = ""
    api_key: Optional[str] = ""
    base_url: Optional[str] = ""
    model: Optional[str] = ""
    model_preset_id: Optional[str] = ""
    prompt: Optional[str] = ""
    strip_markdown_symbols: Optional[bool] = False
    ai_role: Optional[str] = "digital_member"
    digital_member_role: Optional[str] = "member"
    is_librarian: Optional[bool] = False
    platform: Optional[str] = "Server-Core"
    generation: Optional[int] = 1
    token_limit: Optional[int] = 10000
    lifecycle_status: Optional[str] = "working"
    current_behavior: Optional[str] = "等待指令..."
    database_uri: Optional[str] = None
    bot_channel: Optional[str] = "feishu"
    # ``bot_configs`` carries per-channel credentials and addressing.
    # Adapters normalize / validate; routes don't introspect channel keys.
    bot_configs: Optional[Dict[str, Dict[str, Any]]] = None
    project_id: Optional[str] = None
    project_name: Optional[str] = None
    parent_ai_config_id: Optional[int] = None
    root_manager_ai_config_id: Optional[int] = None
    management_scope: Optional[str] = "self"
    sort_order: Optional[int] = 100
    enabled: Optional[bool] = True
    mcp_enabled: Optional[bool] = True
    switch_key: Optional[str] = ""
    mcp_tools: Optional[str] = ""
    system_auto_control: Optional[str] = ""


class AssistantAIConfigUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model: Optional[str] = None
    model_preset_id: Optional[str] = None
    prompt: Optional[str] = None
    strip_markdown_symbols: Optional[bool] = None
    ai_role: Optional[str] = None
    digital_member_role: Optional[str] = None
    is_librarian: Optional[bool] = None
    platform: Optional[str] = None
    generation: Optional[int] = None
    token_limit: Optional[int] = None
    lifecycle_status: Optional[str] = None
    current_behavior: Optional[str] = None
    database_uri: Optional[str] = None
    bot_channel: Optional[str] = None
    bot_configs: Optional[Dict[str, Dict[str, Any]]] = None
    project_id: Optional[str] = None
    project_name: Optional[str] = None
    parent_ai_config_id: Optional[int] = None
    root_manager_ai_config_id: Optional[int] = None
    management_scope: Optional[str] = None
    sort_order: Optional[int] = None
    enabled: Optional[bool] = None
    mcp_enabled: Optional[bool] = None
    switch_key: Optional[str] = None
    mcp_tools: Optional[str] = None
    system_auto_control: Optional[str] = None

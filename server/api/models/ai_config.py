import time
from typing import Optional

from sqlmodel import Field, SQLModel

_DEFAULT_MCP_TOOLS = (
    '["workspace.list_files","workspace.get_file_tree","workspace.read_files",'
    '"workspace.read_file_by_name","workspace.write_file","workspace.edit_file",'
    '"workspace.delete_path","workspace.run_command","workspace.git_diff",'
    '"admin.list_agents","admin.get_overview","admin.dispatch_flow",'
    '"project.list_projects","project.create_project","project.update_project",'
    '"project.delete_project","task.create_immediate","task.create_scheduled",'
    '"task.create_recurring","task.create","task.list","task.wait_all",'
    '"task.get_current","task.inherit","task.complete","human.ask",'
    '"prompt.list_targets","prompt.read_ai","prompt.write_ai","prompt.read_system",'
    '"prompt.write_system","memory.write","memory.search","memory.list","memory.update",'
    '"memory.archive","evolution.input","evolution.list","evolution.review",'
    '"librarian.propose","librarian.consult","librarian.list_topics","librarian.read",'
    '"librarian.archive","user.send_message","ai.send_message","ai.reply_message",'
    '"ai.list_inbox"]'
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
    prompt: str = Field(default="")

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

    # Feishu integration
    feishu_enabled: bool = Field(default=False)
    feishu_webhook_url: str = Field(default="")
    feishu_app_id: str = Field(default="")
    feishu_app_secret: str = Field(default="")
    feishu_verification_token: str = Field(default="")
    feishu_default_receive_id: str = Field(default="")
    feishu_default_receive_id_type: str = Field(default="chat_id")

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
    auto_last_trigger_at: Optional[float] = Field(default=None)

    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)


class AssistantAIConfigCreate(SQLModel):
    name: str
    description: Optional[str] = ""
    api_key: Optional[str] = ""
    base_url: Optional[str] = ""
    model: Optional[str] = ""
    prompt: Optional[str] = ""
    ai_role: Optional[str] = "digital_member"
    digital_member_role: Optional[str] = "member"
    is_librarian: Optional[bool] = False
    platform: Optional[str] = "Server-Core"
    generation: Optional[int] = 1
    token_limit: Optional[int] = 10000
    lifecycle_status: Optional[str] = "working"
    current_behavior: Optional[str] = "等待指令..."
    workspace_root: Optional[str] = None
    database_uri: Optional[str] = None
    feishu_enabled: Optional[bool] = False
    feishu_webhook_url: Optional[str] = ""
    feishu_app_id: Optional[str] = ""
    feishu_app_secret: Optional[str] = ""
    feishu_verification_token: Optional[str] = ""
    feishu_default_receive_id: Optional[str] = ""
    feishu_default_receive_id_type: Optional[str] = "chat_id"
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
    prompt: Optional[str] = None
    ai_role: Optional[str] = None
    digital_member_role: Optional[str] = None
    is_librarian: Optional[bool] = None
    platform: Optional[str] = None
    generation: Optional[int] = None
    token_limit: Optional[int] = None
    lifecycle_status: Optional[str] = None
    current_behavior: Optional[str] = None
    workspace_root: Optional[str] = None
    database_uri: Optional[str] = None
    feishu_enabled: Optional[bool] = None
    feishu_webhook_url: Optional[str] = None
    feishu_app_id: Optional[str] = None
    feishu_app_secret: Optional[str] = None
    feishu_verification_token: Optional[str] = None
    feishu_default_receive_id: Optional[str] = None
    feishu_default_receive_id_type: Optional[str] = None
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

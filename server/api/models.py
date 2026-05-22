from typing import List, Optional
from sqlmodel import Field, SQLModel

DEFAULT_START_TASK_PROMPT = "你将收到一个任务，请先理解目标、约束与优先级，然后开始执行。"
DEFAULT_RESUME_TASK_PROMPT = "请继续执行刚才被暂停的任务，先简要回顾当前进度，再继续推进直到可交付。"
DEFAULT_SUPERVISION_PROMPT = "系统监督提醒：请确认当前任务是否已完成。若已完成请调用 task.complete 标记；若未完成请给出剩余步骤并继续执行。"
DEFAULT_INHERITANCE_NOTICE = "当前思考量已达到阈值（{session_tokens}/{threshold}），建议立即开启传承流程，沉淀本轮结论与关键上下文。"
DEFAULT_UI_THEME_MODE = "dark"
DEFAULT_UI_FONT_SIZE = "md"
DEFAULT_MCP_CALL_METHOD = """When you want to call a tool, output one or more blocks using EXACTLY this format and do not wrap them in markdown code fences:
<mcp-call>
{"tool":"workspace.read_files","arguments":{"paths":["README.md"]}}
</mcp-call>

Available MCP tools include:
{MCP}

Rules:
- Explain your intent in normal text first when helpful, then emit the MCP call block.
- For workspace.write_file and workspace.edit_file, prefer structured arguments: target + content/edits + options.
- Use workspace.edit_file for targeted edits to existing files.
- Use workspace.write_file for new files or full rewrites.
- Use admin.* tools when managing connected agents.
- Call exactly one tool per <mcp-call> block; never join two tool names into one name.
- Only fall back to legacy File/Create File/Delete File/Run Command formats if MCP is unavailable."""
DEFAULT_MCP_FORMAT_ERROR_HINT = """[系统提示] 检测到你正在尝试调用 MCP，但调用格式未通过校验，因此本次没有执行任何工具。

请改用以下标准格式（任选其一）：
1) JSON 方式（推荐）
<mcp-call>
{"tool":"workspace.read_files","arguments":{"paths":["README.md"]}}
</mcp-call>

2) XML-like 方式
<mcp-call>
<tool>workspace.read_files</tool>
<arguments>{"paths":["README.md"]}</arguments>
</mcp-call>

注意：
- <arguments> 标签内必须是 JSON 对象字符串。
- 不要写成 <arguments><paths>...</paths></arguments> 这种嵌套标签格式。
- 一次只调用一个工具，等待 MCP 返回后再继续。
{details}"""

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    account: str = Field(unique=True, index=True)
    hashed_password: str
    avatar: Optional[str] = None
    
    # AI 配置信息
    system_reply: str = Field(default="主脑·阿尔法：已收到指引...")
    admin_token_limit: int = Field(default=2000)
    worker_token_limit: int = Field(default=1000)
    
    # 主脑 AI 配置
    admin_api_key: str = Field(default="sk-cb40bc0b0b894934919907913e337927")
    admin_base_url: str = Field(default="https://api.deepseek.com/chat/completions")
    admin_model: str = Field(default="deepseek-chat")
    admin_prompt: str = Field(default="你是一个全能的管理员，负责管理和协调整个项目。")
    mcp_call_method: str = Field(default=DEFAULT_MCP_CALL_METHOD)
    mcp_format_error_hint: str = Field(default=DEFAULT_MCP_FORMAT_ERROR_HINT)
    # Per-role MCP allow-list configured by the admin. JSON object mapping a role
    # tier (assistant_admin / digital_member_manager / digital_member_member) to a
    # list of allowed tool names. Empty string means "use the per-role default".
    role_mcp_permissions: str = Field(default="")
    default_start_task_prompt: str = Field(default=DEFAULT_START_TASK_PROMPT)
    default_resume_task_prompt: str = Field(default=DEFAULT_RESUME_TASK_PROMPT)
    default_supervision_prompt: str = Field(default=DEFAULT_SUPERVISION_PROMPT)
    default_supervision_idle_seconds: int = Field(default=25)
    default_inheritance_notice: str = Field(default=DEFAULT_INHERITANCE_NOTICE)
    ui_theme_mode: str = Field(default=DEFAULT_UI_THEME_MODE)
    ui_font_size: str = Field(default=DEFAULT_UI_FONT_SIZE)
    
    # 普通 AI 配置
    worker_api_key: str = Field(default="")
    worker_base_url: str = Field(default="https://api.deepseek.com/chat/completions")
    worker_model: str = Field(default="deepseek-chat")
    worker_prompt: str = Field(default="你是一个高效的工作人员，负责执行具体的任务。")

class UserCreate(SQLModel):
    name: str
    account: str
    password: str
    avatar: Optional[str] = None

class UserLogin(SQLModel):
    account: str
    password: str

class UserRead(SQLModel):
    id: int
    name: str
    account: str
    avatar: Optional[str] = None
    system_reply: str
    admin_token_limit: int
    worker_token_limit: int
    admin_api_key: str
    admin_base_url: str
    admin_model: str
    admin_prompt: str
    mcp_call_method: str
    mcp_format_error_hint: str
    role_mcp_permissions: str
    default_start_task_prompt: str
    default_resume_task_prompt: str
    default_supervision_prompt: str
    default_supervision_idle_seconds: int
    default_inheritance_notice: str
    ui_theme_mode: str
    ui_font_size: str
    worker_api_key: str
    worker_base_url: str
    worker_model: str
    worker_prompt: str

class UserUpdate(SQLModel):
    name: Optional[str] = None
    password: Optional[str] = None
    avatar: Optional[str] = None
    system_reply: Optional[str] = None
    admin_token_limit: Optional[int] = None
    worker_token_limit: Optional[int] = None
    admin_api_key: Optional[str] = None
    admin_base_url: Optional[str] = None
    admin_model: Optional[str] = None
    admin_prompt: Optional[str] = None
    mcp_call_method: Optional[str] = None
    mcp_format_error_hint: Optional[str] = None
    role_mcp_permissions: Optional[str] = None
    default_start_task_prompt: Optional[str] = None
    default_resume_task_prompt: Optional[str] = None
    default_supervision_prompt: Optional[str] = None
    default_supervision_idle_seconds: Optional[int] = None
    default_inheritance_notice: Optional[str] = None
    ui_theme_mode: Optional[str] = None
    ui_font_size: Optional[str] = None
    worker_api_key: Optional[str] = None
    worker_base_url: Optional[str] = None
    worker_model: Optional[str] = None
    worker_prompt: Optional[str] = None

class Token(SQLModel):
    access_token: str
    token_type: str
    user: UserRead

class ChatMessage(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    ai_config_id: Optional[int] = Field(default=None, index=True)
    ai_kind: str = Field(default="assistant", index=True)  # assistant / core
    session_id: str = Field(default="default", index=True) # 会话 ID
    session_name: Optional[str] = Field(default=None) # 会话名称（通常是第一条消息）
    role: str  # "user" or "assistant"
    content: str
    think: Optional[str] = None
    tags: str = Field(default="") # 逗号分隔的标签
    
    # 新增字段：Token 使用量和模型信息
    model: Optional[str] = None
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    cache_read_tokens: Optional[int] = None
    system_prompt: Optional[str] = None
    finish_reason: Optional[str] = None
    latency: Optional[float] = None # 延迟，单位秒

    created_at: float = Field(default_factory=lambda: __import__("time").time())

class ChatMessageCreate(SQLModel):
    role: str
    content: str
    ai_config_id: Optional[int] = None
    ai_kind: str = "assistant"
    session_id: Optional[str] = "default"
    session_name: Optional[str] = None
    think: Optional[str] = None
    tags: Optional[str] = ""

    # 新增字段
    model: Optional[str] = None
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    cache_read_tokens: Optional[int] = None
    system_prompt: Optional[str] = None
    finish_reason: Optional[str] = None
    latency: Optional[float] = None

class ChatMessageUpdate(SQLModel):
    tags: Optional[str] = None


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
    platform: str = Field(default="Server-Core")
    generation: int = Field(default=1)
    token_limit: int = Field(default=10000)
    lifecycle_status: str = Field(default="working")  # learning / working / reproducing / dead
    current_behavior: str = Field(default="等待指令...")
    workspace_root: Optional[str] = Field(default=None)
    database_uri: Optional[str] = Field(default=None)
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
    mcp_tools: str = Field(
        default='["workspace.list_files","workspace.get_file_tree","workspace.read_files","workspace.read_file_by_name","workspace.write_file","workspace.edit_file","workspace.delete_path","workspace.run_command","workspace.git_diff","admin.list_agents","admin.get_overview","admin.dispatch_flow","project.list_projects","project.create_project","project.update_project","project.delete_project","task.create_immediate","task.create_scheduled","task.create_recurring","task.create","task.list","task.wait_all","task.get_current","task.inherit","task.complete","human.ask","prompt.list_targets","prompt.read_ai","prompt.write_ai","prompt.read_system","prompt.write_system","memory.write","memory.search","memory.list","memory.update","memory.archive","evolution.input","evolution.list","evolution.review"]'
    )
    system_auto_control: str = Field(
        default='{"enabled":false,"start_task_prompt":"你将收到一个任务，请先理解目标、约束与优先级，然后开始执行。","resume_task_prompt":"请继续执行刚才被暂停的任务，先简要回顾当前进度，再继续推进直到可交付。","supervision_prompt":"系统监督提醒：请确认当前任务是否已完成。若已完成请调用 task.complete 标记；若未完成请给出剩余步骤并继续执行。","inheritance_notice":"当前思考量已达到阈值（{session_tokens}/{threshold}），建议立即开启传承流程，沉淀本轮结论与关键上下文。","tasks":[]}'
    )
    auto_last_trigger_at: Optional[float] = Field(default=None)
    created_at: float = Field(default_factory=lambda: __import__("time").time())
    updated_at: float = Field(default_factory=lambda: __import__("time").time())


class AssistantAIConfigCreate(SQLModel):
    name: str
    description: Optional[str] = ""
    api_key: Optional[str] = ""
    base_url: Optional[str] = ""
    model: Optional[str] = ""
    prompt: Optional[str] = ""
    ai_role: Optional[str] = "digital_member"
    digital_member_role: Optional[str] = "member"
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


class EvolutionProject(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    project_id: str = Field(index=True)
    name: str = Field(index=True)
    description: str = Field(default="")
    status: str = Field(default="running", index=True)  # running / ended
    ai_member_ids: str = Field(default="[]")  # JSON array, e.g. [1,2,3]
    created_at: float = Field(default_factory=lambda: __import__("time").time())
    updated_at: float = Field(default_factory=lambda: __import__("time").time())


class EvolutionProjectCreate(SQLModel):
    name: str
    description: Optional[str] = ""
    status: Optional[str] = "running"
    ai_member_ids: Optional[List[int]] = None


class EvolutionProjectUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    ai_member_ids: Optional[List[int]] = None


class ChatSession(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    ai_config_id: Optional[int] = Field(default=None, index=True)
    ai_kind: str = Field(default="assistant", index=True)
    session_id: str = Field(index=True)
    session_name: str
    created_at: float = Field(default_factory=lambda: __import__("time").time())
    updated_at: float = Field(default_factory=lambda: __import__("time").time())


class ChatSessionCreate(SQLModel):
    ai_config_id: Optional[int] = None
    ai_kind: str = "assistant"
    session_name: str


class TokenUsageSnapshot(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    ai_config_id: Optional[int] = Field(default=None, index=True)
    ai_kind: str = Field(default="assistant", index=True)
    bucket: str = Field(index=True)  # YYYY-MM-DD
    prompt_tokens: int = Field(default=0)
    completion_tokens: int = Field(default=0)
    total_tokens: int = Field(default=0)
    updated_at: float = Field(default_factory=lambda: __import__("time").time())


class AIRuntimeStatus(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    ai_config_id: Optional[int] = Field(default=None, index=True)
    ai_kind: str = Field(default="assistant", index=True)
    running: bool = Field(default=True)
    mcp_enabled: bool = Field(default=True)
    current_status: str = Field(default="idle")
    current_mcp_tool: str = Field(default="")
    updated_at: float = Field(default_factory=lambda: __import__("time").time())


class ChatRun(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: str = Field(index=True, unique=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    ai_config_id: Optional[int] = Field(default=None, index=True)
    ai_kind: str = Field(default="assistant", index=True)
    session_id: str = Field(default="default", index=True)
    session_name: Optional[str] = None
    status: str = Field(default="queued", index=True)  # queued/running/completed/error/stopped
    stop_requested: bool = Field(default=False)
    error_message: Optional[str] = None
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    created_at: float = Field(default_factory=lambda: __import__("time").time())
    updated_at: float = Field(default_factory=lambda: __import__("time").time())


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
    created_at: float = Field(default_factory=lambda: __import__("time").time(), index=True)
    updated_at: float = Field(default_factory=lambda: __import__("time").time())


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
    created_at: float = Field(default_factory=lambda: __import__("time").time(), index=True)
    updated_at: float = Field(default_factory=lambda: __import__("time").time())


class HumanRequest(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    request_id: str = Field(index=True, unique=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    ai_config_id: Optional[int] = Field(default=None, index=True)
    session_id: Optional[str] = Field(default=None, index=True)
    job_id: Optional[str] = Field(default=None, index=True)
    kind: str = Field(default="text")  # confirm / select / text
    prompt: str = Field(default="")
    options: str = Field(default="[]")  # JSON array for select/confirm
    status: str = Field(default="pending", index=True)  # pending / answered / timeout / cancelled
    answer: Optional[str] = Field(default=None)
    created_at: float = Field(default_factory=lambda: __import__("time").time(), index=True)
    answered_at: Optional[float] = None


class AITaskJob(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    job_id: str = Field(index=True, unique=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    ai_config_id: int = Field(foreign_key="assistantaiconfig.id", index=True)
    created_by_ai_config_id: Optional[int] = Field(default=None, index=True)  # dispatcher's AI config id
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
    created_at: float = Field(default_factory=lambda: __import__("time").time(), index=True)
    updated_at: float = Field(default_factory=lambda: __import__("time").time())
    started_at: Optional[float] = None
    finished_at: Optional[float] = None

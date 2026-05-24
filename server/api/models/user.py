from typing import Optional

from sqlmodel import Field, SQLModel

from .defaults import (
    DEFAULT_AI_MESSAGE_INBOUND_TEMPLATE,
    DEFAULT_AI_MESSAGE_NOTIFY_TEMPLATE,
    DEFAULT_AI_MESSAGE_REPLY_SUCCESS,
    DEFAULT_INHERITANCE_NOTICE,
    DEFAULT_MCP_CALL_METHOD,
    DEFAULT_MCP_FORMAT_ERROR_HINT,
    DEFAULT_RESUME_TASK_PROMPT,
    DEFAULT_START_TASK_PROMPT,
    DEFAULT_SUPERVISION_PROMPT,
    DEFAULT_UI_FONT_SIZE,
    DEFAULT_UI_THEME_MODE,
    DEFAULT_USER_MESSAGE_NOTICE,
)


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
    mcp_max_steps: int = Field(default=48)
    # Per-role MCP allow-list configured by the admin. JSON object mapping a role
    # tier (assistant_admin / digital_member_manager / digital_member_member) to a
    # list of allowed tool names. Empty string means "use the per-role default".
    role_mcp_permissions: str = Field(default="")

    default_start_task_prompt: str = Field(default=DEFAULT_START_TASK_PROMPT)
    default_resume_task_prompt: str = Field(default=DEFAULT_RESUME_TASK_PROMPT)
    default_supervision_prompt: str = Field(default=DEFAULT_SUPERVISION_PROMPT)
    default_supervision_idle_seconds: int = Field(default=25)
    default_inheritance_notice: str = Field(default=DEFAULT_INHERITANCE_NOTICE)

    prompt_ai_message_inbound: str = Field(default=DEFAULT_AI_MESSAGE_INBOUND_TEMPLATE)
    prompt_ai_message_notify: str = Field(default=DEFAULT_AI_MESSAGE_NOTIFY_TEMPLATE)
    prompt_ai_message_reply_success: str = Field(default=DEFAULT_AI_MESSAGE_REPLY_SUCCESS)
    prompt_user_message_notice: str = Field(default=DEFAULT_USER_MESSAGE_NOTICE)

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
    mcp_max_steps: int
    role_mcp_permissions: str
    default_start_task_prompt: str
    default_resume_task_prompt: str
    default_supervision_prompt: str
    default_supervision_idle_seconds: int
    default_inheritance_notice: str
    prompt_ai_message_inbound: str
    prompt_ai_message_notify: str
    prompt_ai_message_reply_success: str
    prompt_user_message_notice: str
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
    mcp_max_steps: Optional[int] = None
    role_mcp_permissions: Optional[str] = None
    default_start_task_prompt: Optional[str] = None
    default_resume_task_prompt: Optional[str] = None
    default_supervision_prompt: Optional[str] = None
    default_supervision_idle_seconds: Optional[int] = None
    default_inheritance_notice: Optional[str] = None
    prompt_ai_message_inbound: Optional[str] = None
    prompt_ai_message_notify: Optional[str] = None
    prompt_ai_message_reply_success: Optional[str] = None
    prompt_user_message_notice: Optional[str] = None
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

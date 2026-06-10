"""SQLModel tables and Pydantic schemas, grouped by domain.

The public surface kept stable: callers continue to do
``from api.models import User, ChatMessage, ...``. Each domain lives in its
own sub-module so editing one set of tables (e.g. chat) does not force
re-reading hundreds of lines of unrelated definitions.

Sub-modules:
- defaults     — prompt template / UI default constants
- user         — User account + auth schemas
- chat         — ChatMessage / ChatSession / ChatRun
- ai_config    — AssistantAIConfig (per-AI configuration)
- ai_runtime   — AITaskJob / AIRuntimeStatus / TokenUsageSnapshot
- project      — EvolutionProject (multi-AI collaboration containers)
- knowledge    — Memory / KnowledgeEntry / ValhallaEntry / EvolutionInput
- communication — AIMessage
"""

from .ai_config import (
    AssistantAIConfig,
    AssistantAIConfigCreate,
    AssistantAIConfigUpdate,
)
from .ai_runtime import AgentDispatchTask, AIRuntimeStatus, AITaskJob, TokenUsageSnapshot
from .chat import (
    ChatMessage,
    ChatMessageCreate,
    ChatMessageMedia,
    ChatMessageUpdate,
    ChatRun,
    ChatSession,
    ChatSessionCreate,
)
from .communication import AIMessage
from .defaults import (
    CHITCHAT_MAX_DEPTH,
    DEFAULT_AI_MESSAGE_CHITCHAT_TEMPLATE,
    DEFAULT_AI_MESSAGE_INQUIRY_TEMPLATE,
    DEFAULT_AI_MESSAGE_INQUIRY_REMINDER,
    DEFAULT_AI_MESSAGE_NOTIFY_TEMPLATE,
    DEFAULT_AI_MESSAGE_REPLY_SUCCESS,
    DEFAULT_AI_MESSAGE_REPLY_TEMPLATE,
    DEFAULT_INHERITANCE_NOTICE,
    DEFAULT_MCP_CALL_METHOD,
    DEFAULT_MCP_FORMAT_ERROR_HINT,
    DEFAULT_MCP_NAMESPACE_HINTS,
    DEFAULT_RESUME_TASK_PROMPT,
    DEFAULT_START_TASK_PROMPT,
    DEFAULT_SUPERVISION_PROMPT,
    DEFAULT_UI_FONT_SIZE,
    DEFAULT_UI_THEME_MODE,
    DEFAULT_USER_MESSAGE_NOTICE,
)
from .admin_audit import AdminAuditLog
from .agent_binding import AgentAiBinding
from .agent_mcp_permission import AgentTypeMcpPermission
from .agent_presence import EndpointAgentPresence
from .bot_session_route import BotSessionRoute, BotUserCursor
from .knowledge import EvolutionInput, KnowledgeEntry, Memory, ValhallaEntry
from .project import EvolutionProject, EvolutionProjectCreate, EvolutionProjectUpdate
from .system import EmailVerificationCode, SystemSetting
from .user import Token, User, UserCreate, UserLogin, UserRead, UserUpdate

__all__ = [
    # defaults
    "CHITCHAT_MAX_DEPTH",
    "DEFAULT_AI_MESSAGE_CHITCHAT_TEMPLATE",
    "DEFAULT_AI_MESSAGE_INQUIRY_TEMPLATE",
    "DEFAULT_AI_MESSAGE_INQUIRY_REMINDER",
    "DEFAULT_AI_MESSAGE_NOTIFY_TEMPLATE",
    "DEFAULT_AI_MESSAGE_REPLY_SUCCESS",
    "DEFAULT_AI_MESSAGE_REPLY_TEMPLATE",
    "DEFAULT_INHERITANCE_NOTICE",
    "DEFAULT_MCP_CALL_METHOD",
    "DEFAULT_MCP_FORMAT_ERROR_HINT",
    "DEFAULT_MCP_NAMESPACE_HINTS",
    "DEFAULT_RESUME_TASK_PROMPT",
    "DEFAULT_START_TASK_PROMPT",
    "DEFAULT_SUPERVISION_PROMPT",
    "DEFAULT_UI_FONT_SIZE",
    "DEFAULT_UI_THEME_MODE",
    "DEFAULT_USER_MESSAGE_NOTICE",
    # user
    "Token",
    "User",
    "UserCreate",
    "UserLogin",
    "UserRead",
    "UserUpdate",
    # admin
    "AdminAuditLog",
    # system-wide settings + email verification
    "SystemSetting",
    "EmailVerificationCode",
    # agent device bindings
    "AgentAiBinding",
    "AgentTypeMcpPermission",
    "EndpointAgentPresence",
    # chat
    "ChatMessage",
    "ChatMessageCreate",
    "ChatMessageMedia",
    "ChatMessageUpdate",
    "ChatRun",
    "ChatSession",
    "ChatSessionCreate",
    # ai config + runtime
    "AssistantAIConfig",
    "AssistantAIConfigCreate",
    "AssistantAIConfigUpdate",
    "AgentDispatchTask",
    "AIRuntimeStatus",
    "AITaskJob",
    "TokenUsageSnapshot",
    # project
    "EvolutionProject",
    "EvolutionProjectCreate",
    "EvolutionProjectUpdate",
    # knowledge
    "EvolutionInput",
    "KnowledgeEntry",
    "Memory",
    "ValhallaEntry",
    # communication
    "AIMessage",
    # bots (unified session route, channel-keyed)
    "BotSessionRoute",
    "BotUserCursor",
]

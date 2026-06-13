"""Role-based MCP permission scoping.

Defines the default MCP tool set per AI role tier and resolves the effective
allow-set for an AI config. The human admin (主脑) may configure a per-role
allow-list in system settings; an individual member's MCP config can then only
narrow within the set permitted for its role.

Role tiers, from lowest to highest authority:
    digital_member_member   数字成员·普通成员
    digital_member_manager  数字成员·管理者
    assistant_admin         辅助管理员
    admin                   管理员（主脑 / 用户本人）
"""

import json
from typing import Dict, Iterable, List, Optional, Set

ROLE_MEMBER = "digital_member_member"
ROLE_MANAGER = "digital_member_manager"
ROLE_ASSISTANT_ADMIN = "assistant_admin"
ROLE_ADMIN = "admin"

# Lowest authority first.
ROLE_ORDER: List[str] = [ROLE_MEMBER, ROLE_MANAGER, ROLE_ASSISTANT_ADMIN, ROLE_ADMIN]
ROLE_RANK: Dict[str, int] = {role: index for index, role in enumerate(ROLE_ORDER)}

ROLE_LABELS_ZH: Dict[str, str] = {
    ROLE_MEMBER: "数字成员·普通成员",
    ROLE_MANAGER: "数字成员·管理者",
    ROLE_ASSISTANT_ADMIN: "辅助管理员",
    ROLE_ADMIN: "管理员（主脑）",
}

# Roles the admin can configure permissions for in settings (admin/主脑 always
# has every tool, so it is not listed here).
CONFIGURABLE_ROLES: List[str] = [ROLE_ASSISTANT_ADMIN, ROLE_MANAGER, ROLE_MEMBER]

DEFAULT_MIN_ROLE = ROLE_MEMBER

# Minimum role tier required to ever use each MCP tool. Tools absent from this
# map default to DEFAULT_MIN_ROLE (available to everyone). Sensitive tools are
# raised so they can only be granted to the appropriate tiers.
MCP_TOOL_MIN_ROLE: Dict[str, str] = {
    # MCP self-inspection — available to every tier and forced into runtime allow-lists.
    "mcp.describe_tool": ROLE_MEMBER,
    # Web search — external read-only lookup, available to every tier by default.
    "workspace.search": ROLE_MEMBER,
    # Workspace access is command-only. AI should use shell commands for file operations.
    "workspace.run_command": ROLE_MANAGER,
    # Task — members run their own task; orchestration is manager+.
    "task.complete": ROLE_MEMBER,
    "task.inherit": ROLE_MEMBER,
    "task.list": ROLE_MEMBER,
    "task.create": ROLE_MANAGER,
    "task.update": ROLE_MANAGER,
    "task.delete": ROLE_MANAGER,
    # Prompt — read own prompt is member; editing AI prompts is manager+;
    # global/system prompt templates are assistant_admin+.
    "prompt.list_targets": ROLE_MEMBER,
    "prompt.read_ai": ROLE_MEMBER,
    "prompt.write_ai": ROLE_MANAGER,
    "prompt.read_system": ROLE_MANAGER,
    "prompt.write_system": ROLE_ASSISTANT_ADMIN,
    # Knowledge workshop package installation writes user-level global skills.
    "librarian.install_skill_package": ROLE_MANAGER,
    "librarian.edit_inheritance_thought": ROLE_MANAGER,
    "librarian.delete_inheritance_thought": ROLE_MANAGER,
    # Knowledge workshop — read built-in knowledge categories (read-only for everyone).
    "librarian.read_inheritance_skills": ROLE_MEMBER,
    "librarian.read_intrinsic_skills": ROLE_MEMBER,
    "librarian.read_intrinsic_personas": ROLE_MEMBER,
    "librarian.read_system_prompts": ROLE_MANAGER,
    # Editing built-in categories changes global/system config — raise to higher tiers.
    "librarian.update_intrinsic_skills": ROLE_ASSISTANT_ADMIN,
    "librarian.update_intrinsic_persona": ROLE_MANAGER,
    "librarian.update_system_prompts": ROLE_ASSISTANT_ADMIN,
    # Send message — outbound to the human user; every tier by default.
    "message.send_to_user": ROLE_MEMBER,
    # Conversation maintenance — every tier can manage its own scoped sessions.
    "conversation.forget_before_current": ROLE_MEMBER,
    "conversation.find": ROLE_MEMBER,
    "conversation.create": ROLE_MEMBER,
    "conversation.delete": ROLE_MEMBER,
    "conversation.list": ROLE_MEMBER,
    "conversation.switch": ROLE_MEMBER,
    "conversation.new": ROLE_MEMBER,
    # Admin / governance — assistant_admin only.
    "admin.list_agents": ROLE_ASSISTANT_ADMIN,
    "admin.get_overview": ROLE_ASSISTANT_ADMIN,
}


def tool_min_role(tool_name: str) -> str:
    return MCP_TOOL_MIN_ROLE.get(tool_name, DEFAULT_MIN_ROLE)


def all_registry_tool_names() -> Set[str]:
    from .registry import registry

    return {
        str(tool.get("name") or "").strip()
        for tool in registry.list_tools()
        if tool.get("name")
    }


def config_role_tier(cfg) -> str:
    """Map an AssistantAIConfig to its permission tier."""
    role = str(getattr(cfg, "ai_role", "") or "").strip()
    if role == "assistant_admin":
        return ROLE_ASSISTANT_ADMIN
    member_role = str(getattr(cfg, "digital_member_role", "") or "").strip()
    if member_role == "manager":
        return ROLE_MANAGER
    return ROLE_MEMBER


def role_ceiling_tools(tier: str, all_tool_names: Iterable[str]) -> Set[str]:
    """Configurable tools for a role. Admin settings may show every known tool."""
    return set(all_tool_names)


def role_default_tools(tier: str, all_tool_names: Iterable[str]) -> Set[str]:
    """Default checked tools: all tools whose default minimum tier is at or below ``tier``."""
    rank = ROLE_RANK.get(tier, 0)
    return {
        name
        for name in all_tool_names
        if ROLE_RANK.get(tool_min_role(name), 0) <= rank
    }


def parse_role_permissions(user) -> Dict[str, List[str]]:
    """Parse the admin-configured per-role allow-list stored on the user."""
    raw = getattr(user, "role_mcp_permissions", "") or ""
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    out: Dict[str, List[str]] = {}
    for role, tools in data.items():
        if role in ROLE_RANK and isinstance(tools, list):
            out[role] = [
                str(item).strip()
                for item in tools
                if isinstance(item, str) and str(item).strip()
            ]
    return out


def effective_allowed_for_tier(user, tier: str, all_tool_names: Iterable[str]) -> Set[str]:
    """Tools a given role tier may use.

    If the admin has saved an explicit per-role policy it is honoured (the role
    system stays in force). Otherwise every known tool is allowed — the curated
    ``role_default_tools`` set is only a *default checked* hint for the UI, not a
    hard ceiling, so an operator can grant any MCP tool to any AI from its own
    config without first widening the role policy in System Settings."""
    names = set(all_tool_names)
    ceiling = role_ceiling_tools(tier, names)
    policy = parse_role_permissions(user)
    if tier in policy:
        return {tool for tool in policy[tier] if tool in ceiling}
    return ceiling


def effective_allowed_for_config(user, cfg, all_tool_names: Optional[Iterable[str]] = None) -> Set[str]:
    names = set(all_tool_names) if all_tool_names is not None else all_registry_tool_names()
    return effective_allowed_for_tier(user, config_role_tier(cfg), names)


def clamp_tools_json(user, tier: str, mcp_tools_json: Optional[str]) -> str:
    """Narrow a stored mcp_tools JSON array to what ``tier`` is allowed to use."""
    from connector_runtime.dispatch.desktop_agent_tools import is_endpoint_tool_config_name

    names = all_registry_tool_names()
    allowed = effective_allowed_for_tier(user, tier, names)
    try:
        parsed = json.loads(mcp_tools_json or "[]")
    except Exception:
        parsed = []
    if not isinstance(parsed, list):
        parsed = []
    requested = [
        str(item).strip()
        for item in parsed
        if isinstance(item, str) and str(item).strip()
    ]
    clamped: List[str] = []
    seen: Set[str] = set()
    for tool in requested:
        if tool.startswith("workspace.") and tool != "workspace.run_command":
            continue
        # Endpoint desktop/browser tools are governed exclusively by
        # AgentMcpPermission, not by AssistantAIConfig.mcp_tools.
        if is_endpoint_tool_config_name(tool):
            continue
        # Unknown non-endpoint tools are governed elsewhere; keep them as-is.
        if tool not in names or tool in allowed:
            if tool not in seen:
                clamped.append(tool)
                seen.add(tool)
    return json.dumps(clamped, ensure_ascii=False)


def default_role_permissions(all_tool_names: Optional[Iterable[str]] = None) -> Dict[str, List[str]]:
    """Default per-role allow-lists, for settings UI checked state."""
    names = set(all_tool_names) if all_tool_names is not None else all_registry_tool_names()
    return {
        role: sorted(role_default_tools(role, names))
        for role in CONFIGURABLE_ROLES
    }


def role_tool_options(all_tool_names: Optional[Iterable[str]] = None) -> Dict[str, List[str]]:
    """Per-role configurable tool options, for settings UI display."""
    names = set(all_tool_names) if all_tool_names is not None else all_registry_tool_names()
    return {
        role: sorted(role_ceiling_tools(role, names))
        for role in CONFIGURABLE_ROLES
    }

import time
from typing import Any, Dict, List, Optional, Set, Tuple

from api.sio import agents

# The live ``agents`` registry only exists in the process that owns the agent
# socket server (api-gateway). To let every process (ai-runtime / mcp-runtime /
# connector) discover and classify endpoint tools identically, connected agents
# are mirrored into a shared DB presence snapshot (see ``api.agent_presence``).
# Classification (``is_desktop_tool`` / ``is_browser_tool``) consults a short
# TTL cache of that snapshot so it stays context-free and cheap across
# processes.
_TOOLNAME_CACHE: Dict[str, Any] = {"expiry": 0.0, "desktop": set(), "browser": set()}
_TOOLDEFS_CACHE: Dict[str, Any] = {"expiry": 0.0, "defs": {}}
_TOOLNAME_TTL_SECONDS = 3.0


def _presence_tool_names() -> Tuple[Set[str], Set[str]]:
    now = time.time()
    if _TOOLNAME_CACHE["expiry"] > now:
        return _TOOLNAME_CACHE["desktop"], _TOOLNAME_CACHE["browser"]
    try:
        from api.agent_presence import online_tool_names
        desktop, browser = online_tool_names()
    except Exception:
        desktop, browser = set(), set()
    _TOOLNAME_CACHE.update(expiry=now + _TOOLNAME_TTL_SECONDS, desktop=desktop, browser=browser)
    return desktop, browser


def _presence_tool_defs() -> Dict[str, Dict[str, Any]]:
    """Short-TTL cache of every online agent's self-described tool schemas.
    The agent owns its schemas; the server reads them here so it never
    hardcodes per-tool descriptions / input schemas."""
    now = time.time()
    if _TOOLDEFS_CACHE["expiry"] > now:
        return _TOOLDEFS_CACHE["defs"]
    try:
        from api.agent_presence import online_tool_defs
        defs = online_tool_defs()
    except Exception:
        defs = {}
    _TOOLDEFS_CACHE.update(expiry=now + _TOOLNAME_TTL_SECONDS, defs=defs)
    return defs



# ``admin.list_agents`` is a *server* bridge tool surfaced whenever any endpoint
# agent is connected — not a device-side tool — so it stays a fixed set.
ENDPOINT_BRIDGE_MCP_TOOLS = {"admin.list_agents"}

# The endpoint (desktop / browser) tool surface is no longer a hardcoded
# whitelist. Each connected agent advertises its own tools in the
# ``capabilities`` array of ``agent:register`` (see ``api/socket_events.py``),
# and the server derives everything below from that live list. A tool a
# Windows agent gains at runtime (``speech.*``, ``vision.*``, ``hands.*`` …)
# therefore becomes dispatchable with no server redeploy. Browser tools are
# recognised by their ``browser_`` / ``card_`` namespace; everything else a
# desktop agent reports is a desktop tool.

ENDPOINT_TOOL_PREFIXES = (
    "browser_",
    "card_",
    "fs.",
    "shell.",
    "git.",
    "keyboard.",
    "mouse.",
    "screen.",
    "ui.",
    "clipboard.",
    "window.",
    "process.",
    "display.",
    "ear.",
    "hands.",
    # 知识与进化工坊（agent/workshop/）：这两个域已从内置 MCP 迁出，运行时
    # 可用性只由"AI ↔ 工坊绑定 + per-agent scope"决定，持久化配置里的残留
    # 条目一律剥离，避免绕过绑定门槛。
    "librarian.",
    "evolution.",
)


def _is_browser_namespaced(name: str) -> bool:
    tool = str(name or "").strip()
    return tool.startswith("browser_") or tool.startswith("card_")


def is_endpoint_tool_config_name(name: str) -> bool:
    """Static guard for endpoint tools accidentally stored in AI ``mcp_tools``.

    Runtime availability still comes from live agent capabilities + per-agent
    scope. This prefix test only strips legacy endpoint entries from persisted
    AI config / task override allow-lists, where dynamic presence lookups are
    the wrong source of truth.
    """
    tool = str(name or "").strip()
    return bool(tool) and tool.startswith(ENDPOINT_TOOL_PREFIXES)


def strip_endpoint_tool_config_names(names: Set[str]) -> Set[str]:
    return {name for name in names if not is_endpoint_tool_config_name(name)}


# 知识与进化工坊（agent/workshop/）注册的工具统一走这两个命名空间。前缀是
# 稳定契约：分类不依赖在线状态，离线时这些名字也不会被误判为桌面工具。
WORKSHOP_TOOL_PREFIXES = ("librarian.", "evolution.")


def is_workshop_tool(name: str) -> bool:
    tool = str(name or "").strip()
    return bool(tool) and tool.startswith(WORKSHOP_TOOL_PREFIXES)


def agent_type_of(agent: Optional[Dict[str, Any]]) -> Optional[str]:
    """Classify a connected-agent record as ``"desktop"`` / ``"browser"`` /
    ``"workshop"`` (知识与进化工坊)."""
    if not isinstance(agent, dict):
        return None
    platform = str(agent.get("platform") or "").lower()
    if bool(agent.get("isWorkshop")) or "workshop" in platform:
        return "workshop"
    if bool(agent.get("isBrowserExtension")) or "browser-extension" in platform:
        return "browser"
    if bool(agent.get("isWindowsDesktop")) or "desktop" in platform or "windows" in platform:
        return "desktop"
    return None


def _agent_capabilities(agent: Dict[str, Any], agent_type: str) -> Set[str]:
    """Tool names of the given type that ``agent`` reports. Browser-namespaced
    names only ever count as browser tools；workshop agent 只允许上报工坊命名
    空间的工具（防止借工坊通道注册桌面执行类工具）；the rest as desktop tools."""
    names: Set[str] = set()
    for cap in agent.get("capabilities") or []:
        name = str(cap or "").strip()
        if not name:
            continue
        if agent_type == "workshop":
            if is_workshop_tool(name):
                names.add(name)
        elif agent_type == "browser":
            if _is_browser_namespaced(name):
                names.add(name)
        else:
            if not _is_browser_namespaced(name) and not is_workshop_tool(name):
                names.add(name)
    return names


def agent_endpoint_tools(agent: Optional[Dict[str, Any]]) -> Set[str]:
    """Endpoint tool names a single connected agent reports, classified by its
    own type. Used by the per-agent permission editor."""
    atype = agent_type_of(agent)
    if not atype or not isinstance(agent, dict):
        return set()
    return _agent_capabilities(agent, atype)


def agent_endpoint_tool_defs(agent: Optional[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """``{name: {description, input_schema}}`` self-described by a single agent
    (via the ``toolDefs`` it ships in ``agent:register``), restricted to the
    tools of its own type. The agent is the source of truth for its own tool
    schemas, so the server stores these verbatim instead of hardcoding them.
    A tool reported without a def simply gets no entry (generic fallback)."""
    atype = agent_type_of(agent)
    if not atype or not isinstance(agent, dict):
        return {}
    allowed = _agent_capabilities(agent, atype)
    out: Dict[str, Dict[str, Any]] = {}
    for raw in agent.get("toolDefs") or []:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        if not name or name not in allowed:
            continue
        schema = raw.get("input_schema")
        if not isinstance(schema, dict):
            schema = raw.get("inputSchema") if isinstance(raw.get("inputSchema"), dict) else {}
        out[name] = {
            "description": str(raw.get("description") or "").strip(),
            "input_schema": schema,
        }
    return out


def _reported_endpoint_tools(*, want_desktop: bool) -> Set[str]:
    """Every tool name advertised by currently-connected agents of one kind."""
    target = "desktop" if want_desktop else "browser"
    names: Set[str] = set()
    for agent in list(agents.values()):
        if agent_type_of(agent) != target:
            continue
        names.update(_agent_capabilities(agent, target))
    return names


def desktop_tool_names() -> Set[str]:
    """All desktop tool names currently advertised by connected desktop agents."""
    return _reported_endpoint_tools(want_desktop=True)


def browser_tool_names() -> Set[str]:
    """All browser tool names currently advertised by connected browser agents."""
    return _reported_endpoint_tools(want_desktop=False)


def is_desktop_tool(name: str) -> bool:
    tool = str(name or "").strip()
    if is_workshop_tool(tool):
        return False
    if tool in desktop_tool_names():
        return True
    return tool in _presence_tool_names()[0]


def is_browser_tool(name: str) -> bool:
    tool = str(name or "").strip()
    if _is_browser_namespaced(tool):
        return True
    if tool in _reported_endpoint_tools(want_desktop=False):
        return True
    return tool in _presence_tool_names()[1]


def is_endpoint_agent_tool(name: str) -> bool:
    return is_workshop_tool(name) or is_desktop_tool(name) or is_browser_tool(name)


def connected_endpoint_tool_catalog() -> List[Dict[str, str]]:
    """Live endpoint tool catalog: every tool an online desktop / browser agent
    currently advertises (from the shared presence snapshot), tagged by
    ``mcpSource``."""
    desktop, browser = _presence_tool_names()
    catalog: Dict[str, str] = {}
    for name in desktop:
        catalog[name] = "desktop"
    for name in browser:
        catalog.setdefault(name, "browser")
    return [
        {"name": name, "mcpSource": catalog[name]}
        for name in sorted(catalog)
    ]


# A tool reported by an agent that ships no schema (legacy clients) gets this
# permissive object schema so the model can still pass arbitrary arguments.
_GENERIC_ENDPOINT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {},
    "required": [],
    "additionalProperties": True,
}


def endpoint_tool_description(name: str) -> str:
    """Description for an endpoint tool.

    The agent is the source of truth. If it does not report a description, the
    backend returns an empty string instead of inventing one.
    """
    tool = str(name or "").strip()
    reported = _presence_tool_defs().get(tool)
    if reported and reported.get("description"):
        return str(reported["description"]).strip()
    return ""


def endpoint_tool_input_schema(name: str) -> Dict[str, Any]:
    """Input schema for an endpoint tool, taken verbatim from the agent."""
    tool = str(name or "").strip()
    reported = _presence_tool_defs().get(tool)
    schema = reported.get("input_schema") if reported else None
    if isinstance(schema, dict) and schema:
        return schema
    return {}


def build_endpoint_tools_payload(allowed_tools: Optional[Set[str]] = None) -> List[Dict[str, Any]]:
    allowed = {str(item).strip() for item in (allowed_tools or set()) if str(item).strip()}
    names = sorted(name for name in allowed if is_endpoint_agent_tool(name))
    return [
        {
            "type": "function",
            "function": {
                "name": name,
                "description": endpoint_tool_description(name),
                "parameters": endpoint_tool_input_schema(name),
            },
        }
        for name in names
    ]


def _parse_int(value: Any) -> Optional[int]:
    try:
        parsed = int(value)
        return parsed if parsed > 0 else None
    except Exception:
        return None


def _iter_agents_for_config(ai_config_id: Optional[int], user_id: Optional[int] = None):
    config_id = _parse_int(ai_config_id)
    if not config_id:
        return
    expected_user_id = _parse_int(user_id)

    for agent in list(agents.values()):
        if not isinstance(agent, dict):
            continue
        agent_config_id = _parse_int(agent.get("aiConfigId") or agent.get("ai_config_id"))
        if agent_config_id != config_id:
            continue
        agent_user_id = _parse_int(agent.get("userId") or agent.get("user_id"))
        if expected_user_id and agent_user_id and agent_user_id != expected_user_id:
            continue
        yield agent


def get_connected_desktop_agent(ai_config_id: Optional[int], user_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
    for agent in _iter_agents_for_config(ai_config_id, user_id) or []:
        platform = str(agent.get("platform") or "").lower()
        is_desktop = bool(agent.get("isWindowsDesktop")) or "desktop" in platform
        if is_desktop:
            return agent
    return None


def get_connected_browser_agent(ai_config_id: Optional[int], user_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
    for agent in _iter_agents_for_config(ai_config_id, user_id) or []:
        platform = str(agent.get("platform") or "").lower()
        is_browser = bool(agent.get("isBrowserExtension")) or "browser-extension" in platform
        if is_browser:
            return agent
    return None


def get_connected_endpoint_agent(ai_config_id: Optional[int], user_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
    return get_connected_desktop_agent(ai_config_id, user_id) or get_connected_browser_agent(ai_config_id, user_id)


def endpoint_bridge_tools_for_config(ai_config_id: Optional[int], user_id: Optional[int] = None) -> Set[str]:
    if get_connected_endpoint_agent(ai_config_id, user_id):
        return set(ENDPOINT_BRIDGE_MCP_TOOLS)
    return set()


def get_connected_workshop_agent(ai_config_id: Optional[int], user_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
    """First live workshop agent this AI is bound to (AI 侧多对一绑定)。

    与桌面/浏览器不同：工坊绑定存在 ``WorkshopAiBinding``（一个工坊服务多个
    AI），而非设备 1:1 的 ``AgentAiBinding``。"""
    config_id = _parse_int(ai_config_id)
    if not config_id:
        return None
    from api.workshop_bindings import workshop_agent_ids_for_config

    bound_ids = set(workshop_agent_ids_for_config(user_id, config_id))
    if not bound_ids:
        return None
    for agent in list(agents.values()):
        if not isinstance(agent, dict):
            continue
        if agent_type_of(agent) != "workshop":
            continue
        if str(agent.get("id") or "").strip() not in bound_ids:
            continue
        agent_user_id = _parse_int(agent.get("userId") or agent.get("user_id"))
        expected_user_id = _parse_int(user_id)
        if expected_user_id and agent_user_id and agent_user_id != expected_user_id:
            continue
        return agent
    return None


def workshop_tools_for_config(ai_config_id: Optional[int], user_id: Optional[int] = None) -> Set[str]:
    """Workshop MCP tools available to an AI right now: the union of what its
    bound online workshop agents advertise, each narrowed by that agent's
    per-agent permission scope. 未绑定 → 空集（绑定是知识/进化工具的唯一门槛）。"""
    config_id = _parse_int(ai_config_id)
    if not config_id:
        return set()
    from api.agent_mcp_permissions import get_scope
    from api.agent_presence import online_workshop_agents_for_user
    from api.workshop_bindings import workshop_agent_ids_for_config

    bound_ids = set(workshop_agent_ids_for_config(user_id, config_id))
    if not bound_ids:
        return set()
    tools: Set[str] = set()
    for agent_id, caps in online_workshop_agents_for_user(user_id):
        if agent_id not in bound_ids:
            continue
        scope = get_scope(user_id, agent_id) if agent_id else None
        if scope is None:
            continue
        tools |= {name for name in (caps & scope) if is_workshop_tool(name)}
    return tools


def endpoint_tools_for_config(ai_config_id: Optional[int], user_id: Optional[int] = None) -> Set[str]:
    """Endpoint MCP tools available to an AI right now: the union of what its
    online endpoint agents (Linux / desktop / browser) advertise, each narrowed
    by that individual agent's saved per-agent permission scope. No saved scope
    row → no endpoint tools are allowed.

    Resolved from the shared DB presence snapshot (``api.agent_presence``) so
    every process — gateway, ai-runtime, mcp-runtime, connector — gets the same
    answer without the in-memory agent registry. Endpoint tools are
    intentionally decoupled from ``cfg.mcp_tools`` (which governs server-side
    MCP tools). A disconnected agent contributes nothing, so its tools disappear
    from the AI's reach until it returns."""
    config_id = _parse_int(ai_config_id)
    if not config_id:
        return set()
    from api.agent_presence import online_agents_for_config
    from api.agent_mcp_permissions import get_scope

    tools: Set[str] = set()
    for agent_id, _agent_type, caps in online_agents_for_config(user_id, config_id):
        # Each individual agent has its own MCP scope. No saved row → closed.
        scope = get_scope(user_id, agent_id) if agent_id else None
        if scope is None:
            continue
        tools |= caps & scope
    # 知识与进化工坊走 AI 侧绑定（WorkshopAiBinding），与设备 1:1 绑定并集。
    tools |= workshop_tools_for_config(config_id, user_id)
    return tools

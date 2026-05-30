from typing import Any, Dict, List, Optional, Set

from api.sio import agents


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


def _is_browser_namespaced(name: str) -> bool:
    tool = str(name or "").strip()
    return tool.startswith("browser_") or tool.startswith("card_")


def agent_type_of(agent: Optional[Dict[str, Any]]) -> Optional[str]:
    """Classify a connected-agent record as ``"desktop"`` / ``"browser"``."""
    if not isinstance(agent, dict):
        return None
    platform = str(agent.get("platform") or "").lower()
    if bool(agent.get("isBrowserExtension")) or "browser-extension" in platform:
        return "browser"
    if bool(agent.get("isWindowsDesktop")) or "desktop" in platform or "windows" in platform:
        return "desktop"
    return None


def _agent_capabilities(agent: Dict[str, Any], agent_type: str) -> Set[str]:
    """Tool names of the given type that ``agent`` reports. Browser-namespaced
    names only ever count as browser tools, the rest as desktop tools."""
    names: Set[str] = set()
    for cap in agent.get("capabilities") or []:
        name = str(cap or "").strip()
        if not name:
            continue
        if agent_type == "browser":
            if _is_browser_namespaced(name):
                names.add(name)
        else:
            if not _is_browser_namespaced(name):
                names.add(name)
    return names


def agent_endpoint_tools(agent: Optional[Dict[str, Any]]) -> Set[str]:
    """Endpoint tool names a single connected agent reports, classified by its
    own type. Used by the per-agent permission editor."""
    atype = agent_type_of(agent)
    if not atype or not isinstance(agent, dict):
        return set()
    return _agent_capabilities(agent, atype)


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
    return str(name or "").strip() in desktop_tool_names()


def is_browser_tool(name: str) -> bool:
    tool = str(name or "").strip()
    if _is_browser_namespaced(tool):
        return True
    return tool in _reported_endpoint_tools(want_desktop=False)


def is_endpoint_agent_tool(name: str) -> bool:
    return is_desktop_tool(name) or is_browser_tool(name)


def connected_endpoint_tool_catalog() -> List[Dict[str, str]]:
    """Live endpoint tool catalog: every tool a connected desktop / browser
    agent currently advertises, tagged by ``mcpSource``."""
    catalog: Dict[str, str] = {}
    for name in desktop_tool_names():
        catalog[name] = "desktop"
    for name in browser_tool_names():
        catalog.setdefault(name, "browser")
    return [
        {"name": name, "mcpSource": catalog[name]}
        for name in sorted(catalog)
    ]


def endpoint_tool_description(name: str) -> str:
    tool = str(name or "").strip()
    if is_browser_tool(tool):
        return (
            f"Run browser MCP tool `{tool}` on the connected browser extension bound to this AI. "
            "Pass the tool's normal arguments directly as this function's JSON arguments. "
            "The server waits for the browser result and returns it to the conversation."
        )
    if is_desktop_tool(tool):
        return (
            f"Run desktop/software MCP tool `{tool}` on the connected desktop agent bound to this AI. "
            "Pass the tool's normal arguments directly as this function's JSON arguments. "
            "The server waits for the desktop result and returns it to the conversation."
        )
    return f"Run endpoint MCP tool `{tool}` on the connected endpoint agent."


def endpoint_tool_input_schema(name: str) -> Dict[str, Any]:
    tool = str(name or "").strip()
    properties: Dict[str, Any] = {}
    required: List[str] = []
    if tool == "browser_navigate":
        properties = {
            "url": {"type": "string", "description": "Absolute URL to open."},
            "new_tab": {"type": "boolean", "description": "Open in a new tab."},
        }
        required = ["url"]
    elif tool == "browser_search":
        properties = {
            "query": {"type": "string", "description": "Search query."},
            "engine": {"type": "string", "description": "Search engine, e.g. google, bing, baidu."},
        }
        required = ["query"]
    elif tool in {"browser_click", "browser_right_click", "browser_double_click", "mouse.click", "mouse.double_click", "mouse.right_click"}:
        properties = {
            "selector": {"type": "string"},
            "text": {"type": "string"},
            "x": {"type": "number"},
            "y": {"type": "number"},
            "button": {"type": "string"},
        }
    elif tool in {"browser_type", "keyboard.type"}:
        properties = {
            "selector": {"type": "string"},
            "text": {"type": "string"},
            "clear_first": {"type": "boolean"},
            "submit": {"type": "boolean"},
        }
        required = ["text"]
    elif tool in {"browser_get_content", "browser_extract", "browser_find_text", "fs.read", "fs.list"}:
        properties = {
            "path": {"type": "string"},
            "selector": {"type": "string"},
            "text": {"type": "string"},
            "include_html": {"type": "boolean"},
            "limit": {"type": "number"},
        }
    elif tool in {"browser_screenshot", "screen.capture"}:
        properties = {
            "display": {"type": "number", "description": "Desktop display index for screen.capture."},
            "screen": {"type": "number", "description": "Alias of display."},
            "selector": {"type": "string", "description": "browser_screenshot: CSS selector of an element to capture."},
            "text": {"type": "string", "description": "browser_screenshot: visible text used to find an element to capture."},
            "full_page": {"type": "boolean", "description": "browser_screenshot: capture the full scrollable page."},
            "x": {"type": "number", "description": "browser_screenshot: region left coordinate."},
            "y": {"type": "number", "description": "browser_screenshot: region top coordinate."},
            "width": {"type": "number", "description": "browser_screenshot: region width in CSS pixels."},
            "height": {"type": "number", "description": "browser_screenshot: region height in CSS pixels."},
            "clip": {"type": "object", "description": "browser_screenshot: region object {x,y,width,height,coordinate_space?}."},
            "coordinate_space": {"type": "string", "description": "browser_screenshot: viewport or page. Default viewport."},
            "margin": {"type": "number", "description": "browser_screenshot: extra CSS pixels around an element capture."},
            "scroll_into_view": {"type": "boolean", "description": "browser_screenshot: scroll element target into view before capture. Default true."},
            "format": {"type": "string", "description": "browser_screenshot: png, jpeg, or webp. Default png."},
            "quality": {"type": "number", "description": "browser_screenshot: JPEG/WebP quality, 0-100."},
            "scale": {"type": "number", "description": "browser_screenshot: CDP clip scale. Default 1."},
            "max_area": {"type": "number", "description": "browser_screenshot: maximum screenshot area in CSS pixels. Default 25000000."},
            "retries": {"type": "number", "description": "browser_screenshot: retry count for simple visible-tab capture. Default 1."},
            "timeout_ms": {"type": "number", "description": "browser_screenshot: per-stage screenshot timeout in milliseconds."},
            "timeout_seconds": {"type": "number", "description": "browser_screenshot: server-side wait timeout for the endpoint result."},
            "visible_timeout_ms": {"type": "number", "description": "browser_screenshot: timeout for visible-tab capture. Default 8000."},
            "cdp_timeout_ms": {"type": "number", "description": "browser_screenshot: timeout for each Chrome DevTools Protocol screenshot command. Default 12000."},
            "content_timeout_ms": {"type": "number", "description": "browser_screenshot: timeout for selector/text measurement. Default 5000."},
            "max_data_url_chars": {"type": "number", "description": "browser_screenshot: maximum returned data URL length. Default 8000000."},
            "allow_large_data_url": {"type": "boolean", "description": "browser_screenshot: allow returning payloads larger than max_data_url_chars. Default false."},
            "task_timeout_ms": {"type": "number", "description": "browser_screenshot: endpoint agent hard timeout for this task. Default 35000."},
            "fallback_visible": {"type": "boolean", "description": "browser_screenshot: fall back to visible-tab capture if precise capture fails. Default false."},
            "upload_to_server": {
                "type": "boolean",
                "description": "Defaults true. The server stores the screenshot under the user's Screenshots workspace folder and returns server_path/workspace_path.",
            },
        }
    elif tool == "screen.capture_region":
        properties = {
            "x": {"type": "number"},
            "y": {"type": "number"},
            "width": {"type": "number"},
            "height": {"type": "number"},
            "upload_to_server": {
                "type": "boolean",
                "description": "Defaults true. The server stores the screenshot under the user's Screenshots workspace folder and returns server_path/workspace_path.",
            },
        }
        required = ["width", "height"]
    elif tool == "browser_find_popups":
        properties = {
            "limit": {"type": "number", "description": "Maximum popups to return."},
        }
    elif tool == "browser_close_popup":
        properties = {
            "selector": {"type": "string", "description": "Optional CSS selector of the popup to close."},
            "text": {"type": "string", "description": "Optional text inside the popup to identify it."},
            "index": {"type": "number", "description": "Popup index returned by browser_find_popups."},
            "strategy": {"type": "string", "description": "auto, close_button, escape, or backdrop."},
            "force_remove": {"type": "boolean", "description": "Remove the popup DOM node as a last resort."},
        }
    elif tool in {"fs.write"}:
        properties = {
            "path": {"type": "string"},
            "content": {"type": "string"},
        }
        required = ["path", "content"]
    elif tool == "shell.run":
        properties = {
            "command": {"type": "string", "description": "Command to run."},
            "timeout": {"type": "number"},
        }
        required = ["command"]
    elif tool in {"keyboard.press", "browser_press_key"}:
        properties = {
            "key": {"type": "string"},
            "selector": {"type": "string"},
            "ctrl": {"type": "boolean"},
            "shift": {"type": "boolean"},
            "alt": {"type": "boolean"},
            "meta": {"type": "boolean"},
        }
        required = ["key"]
    elif tool in {"card_get", "card_run", "card_delete"}:
        properties = {
            "id": {"type": "string"},
            "name": {"type": "string"},
        }
    elif tool == "card_save":
        properties = {
            "name": {"type": "string"},
            "description": {"type": "string"},
            "steps": {"type": "array", "items": {"type": "object"}},
            "mode": {"type": "string"},
        }
        required = ["name", "steps"]
    elif tool == "card_update_step":
        properties = {
            "id": {"type": "string"},
            "name": {"type": "string"},
            "index": {"type": "number"},
            "tool": {"type": "string"},
            "args": {"type": "object"},
            "note": {"type": "string"},
        }
        required = ["index"]
    return {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": True,
    }


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
    expected_id = f"win-desktop-{config_id}"
    expected_user_id = _parse_int(user_id)

    for agent in list(agents.values()):
        if not isinstance(agent, dict):
            continue
        agent_config_id = _parse_int(agent.get("aiConfigId") or agent.get("ai_config_id"))
        if agent_config_id is None and str(agent.get("id") or "") == expected_id:
            agent_config_id = config_id
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


def _scoped_tools(agent: Optional[Dict[str, Any]], agent_type: str,
                  ai_config_id: Optional[int], user_id: Optional[int]) -> Set[str]:
    """Tools the AI may drive on ``agent``: its reported capabilities narrowed
    by the saved per-(AI, type) scope. No saved row → no restriction (all
    reported tools are allowed)."""
    if not agent:
        return set()
    caps = _agent_capabilities(agent, agent_type)
    # Lazy import keeps this dispatch module free of a hard DB dependency at
    # import time (and avoids an import cycle through api.models).
    from api.agent_mcp_permissions import get_scope

    scope = get_scope(user_id, ai_config_id, agent_type)
    if scope is None:
        return caps
    return caps & scope


def endpoint_tools_for_config(ai_config_id: Optional[int], user_id: Optional[int] = None) -> Set[str]:
    """Endpoint MCP tools available to an AI right now: the union of what its
    connected desktop and browser agents report, each narrowed by the saved
    per-(AI, agent-type) permission scope.

    This is the source of truth for endpoint tools in the AI's allow-list —
    they are intentionally decoupled from ``cfg.mcp_tools`` (which governs
    server-side MCP tools). A disconnected agent contributes nothing, so its
    tools simply disappear from the AI's reach until it returns."""
    tools: Set[str] = set()
    tools |= _scoped_tools(
        get_connected_desktop_agent(ai_config_id, user_id), "desktop", ai_config_id, user_id
    )
    tools |= _scoped_tools(
        get_connected_browser_agent(ai_config_id, user_id), "browser", ai_config_id, user_id
    )
    return tools

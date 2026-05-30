from typing import Any, Dict, List, Optional, Set

from api.sio import agents


ENDPOINT_BRIDGE_MCP_TOOLS = {"admin.list_agents"}
DESKTOP_AGENT_MCP_TOOLS = {
    "fs.list",
    "fs.read",
    "fs.write",
    "shell.run",
    "git.diff",
    "keyboard.type",
    "keyboard.press",
    "mouse.move",
    "mouse.click",
    "mouse.double_click",
    "mouse.right_click",
    "mouse.scroll",
    "mouse.drag",
    "screen.capture",
    "screen.capture_region",
    "screen.info",
    "clipboard.get",
    "clipboard.set",
    "window.list",
    "window.focus",
    "window.close",
    "process.list",
    "process.kill",
}
BROWSER_AGENT_MCP_TOOLS = {
    "browser_navigate",
    "browser_screenshot",
    "browser_click",
    "browser_type",
    "browser_get_content",
    "browser_search",
    "browser_scroll",
    "browser_wait",
    "browser_evaluate",
    "browser_extract",
    "browser_find_text",
    "browser_find_popups",
    "browser_close_popup",
    "browser_fill_form",
    "browser_select",
    "browser_tab_list",
    "browser_tab_open",
    "browser_tab_close",
    "browser_history_back",
    "browser_history_forward",
    "browser_clipboard_write",
    "browser_storage_get",
    "browser_hover",
    "browser_page_info",
    "browser_right_click",
    "browser_double_click",
    "browser_drag",
    "browser_press_key",
    "card_list",
    "card_get",
    "card_save",
    "card_update_step",
    "card_run",
    "card_delete",
}


def _is_browser_namespaced(name: str) -> bool:
    tool = str(name or "").strip()
    return tool in BROWSER_AGENT_MCP_TOOLS or tool.startswith("browser_") or tool.startswith("card_")


def _reported_endpoint_tools(*, want_desktop: bool) -> Set[str]:
    """Tool names advertised by currently-connected endpoint agents.

    A desktop / browser agent sends its full tool surface in the
    ``capabilities`` array of ``agent:register`` (see ``api/socket_events.py``).
    Surfacing them here lets the server recognise and dispatch tools an agent
    gained at runtime — e.g. a Windows desktop agent extended with new MCP
    tools (``speech.*``, ``vision.*``, ``hands.*``, ``ear.*`` …) — without
    editing the static built-in sets above or redeploying the server.

    Browser-namespaced names always count as browser tools (they route to the
    browser extension); everything else a desktop agent reports counts as a
    desktop tool.
    """
    names: Set[str] = set()
    for agent in list(agents.values()):
        if not isinstance(agent, dict):
            continue
        platform = str(agent.get("platform") or "").lower()
        is_desktop = bool(agent.get("isWindowsDesktop")) or "desktop" in platform
        is_browser = bool(agent.get("isBrowserExtension")) or "browser-extension" in platform
        if want_desktop and not is_desktop:
            continue
        if not want_desktop and not is_browser:
            continue
        for cap in agent.get("capabilities") or []:
            name = str(cap or "").strip()
            if not name:
                continue
            if want_desktop and _is_browser_namespaced(name):
                continue
            if not want_desktop and not _is_browser_namespaced(name):
                continue
            names.add(name)
    return names


def desktop_tool_names() -> Set[str]:
    """Static built-in desktop tools unioned with those reported live by a
    connected desktop agent."""
    return set(DESKTOP_AGENT_MCP_TOOLS) | _reported_endpoint_tools(want_desktop=True)


def browser_tool_names() -> Set[str]:
    """Static built-in browser tools unioned with those reported live by a
    connected browser agent."""
    return set(BROWSER_AGENT_MCP_TOOLS) | _reported_endpoint_tools(want_desktop=False)


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
    """Live endpoint tool catalog for the Workshop tool picker.

    Returns every tool a connected desktop / browser agent currently
    advertises, tagged by ``mcpSource`` so the web UI can list runtime-extended
    tools alongside the static built-ins. Desktop wins when a name appears for
    both sources (it never should — namespaces are disjoint)."""
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

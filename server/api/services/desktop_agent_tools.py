from typing import Any, Dict, List, Optional, Set

from ..sio import agents


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


def is_desktop_tool(name: str) -> bool:
    return str(name or "").strip() in DESKTOP_AGENT_MCP_TOOLS


def is_browser_tool(name: str) -> bool:
    tool = str(name or "").strip()
    return tool in BROWSER_AGENT_MCP_TOOLS or tool.startswith("browser_") or tool.startswith("card_")


def is_endpoint_agent_tool(name: str) -> bool:
    return is_desktop_tool(name) or is_browser_tool(name)


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

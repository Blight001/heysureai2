from typing import Any, Dict, Optional, Set

from .sio import agents


ENDPOINT_BRIDGE_MCP_TOOLS = {"admin.list_agents", "admin.dispatch_task"}


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


def desktop_bridge_tools_for_config(ai_config_id: Optional[int], user_id: Optional[int] = None) -> Set[str]:
    return endpoint_bridge_tools_for_config(ai_config_id, user_id)

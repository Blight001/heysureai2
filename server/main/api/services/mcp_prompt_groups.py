"""Group MCP tools for front-prompt preview: workspace (server) vs per-device."""

from typing import Any, Dict, List, Optional, Set

from api.device_live import connected_agent_rows_for_user
from api.device_mcp_permissions import get_scope
from connector_runtime.dispatch.desktop_device_tools import (
    _config_selected_tool_names,
    _iter_agents_for_config,
    _parse_int,
    agent_endpoint_tools,
    device_type_of,
    is_endpoint_agent_tool,
)


def _is_workspace_tool(tool: Dict[str, Any]) -> bool:
    return str(tool.get("mcpSource") or "server").strip() == "server"


def _agent_display_name(agent: Dict[str, Any]) -> str:
    name = str(agent.get("name") or agent.get("deviceName") or agent.get("id") or "").strip()
    if name:
        return name
    device_type = device_type_of(agent)
    if device_type == "browser":
        return "浏览器端"
    if device_type == "workshop":
        return "知识工坊"
    return "桌面端"


def _agents_for_prompt_groups(user_id: int, ai_config_id: Optional[int]) -> List[Dict[str, Any]]:
    if ai_config_id is not None:
        agents = [agent for agent in _iter_agents_for_config(ai_config_id, user_id) if isinstance(agent, dict)]
        seen = {str(agent.get("id") or "").strip() for agent in agents if str(agent.get("id") or "").strip()}
        for agent in connected_agent_rows_for_user(user_id):
            if not isinstance(agent, dict) or device_type_of(agent) != "workshop":
                continue
            bound_cfg = _parse_int(agent.get("aiConfigId") or agent.get("ai_config_id"))
            if bound_cfg != ai_config_id:
                continue
            device_id = str(agent.get("id") or "").strip()
            if device_id and device_id not in seen:
                agents.append(agent)
                seen.add(device_id)
        return agents
    return [
        agent for agent in connected_agent_rows_for_user(user_id)
        if isinstance(agent, dict) and device_type_of(agent) in {"desktop", "browser", "workshop"}
    ]


def _tool_names_for_agent(
    agent: Dict[str, Any],
    *,
    user_id: int,
    ai_config_id: Optional[int],
    allowed_tools: Optional[Set[str]],
) -> Set[str]:
    device_id = str(agent.get("id") or "").strip()
    caps = agent_endpoint_tools(agent)
    scope = get_scope(user_id, device_id) if device_id else None
    names: Set[str] = set()
    if scope is not None:
        names |= caps & scope
    if ai_config_id is not None:
        names |= _config_selected_tool_names(ai_config_id, user_id) & caps
    if allowed_tools is not None:
        names &= allowed_tools
    return {name for name in names if is_endpoint_agent_tool(name)}


def build_prompt_tool_groups(
    *,
    user_id: int,
    ai_config_id: Optional[int],
    prompt_tools: List[Dict[str, Any]],
    allowed_tools: Optional[Set[str]],
) -> List[Dict[str, Any]]:
    by_name: Dict[str, Dict[str, Any]] = {}
    for tool in prompt_tools:
        name = str(tool.get("name") or "").strip()
        if name:
            by_name[name] = tool

    workspace_names: Set[str] = set()
    if allowed_tools is None:
        workspace_names = {name for name, tool in by_name.items() if _is_workspace_tool(tool)}
    else:
        workspace_names = {
            name for name in allowed_tools
            if name in by_name and _is_workspace_tool(by_name[name])
        }

    workspace_tools = [by_name[name] for name in sorted(workspace_names) if name in by_name]
    groups: List[Dict[str, Any]] = [{
        "groupKey": "workspace",
        "groupLabel": "工作区 MCP",
        "groupKind": "workspace",
        "tools": workspace_tools,
    }]

    agents = _agents_for_prompt_groups(user_id, ai_config_id)
    for agent in agents:
        device_id = str(agent.get("id") or "").strip()
        if not device_id:
            continue
        names = _tool_names_for_agent(
            agent,
            user_id=user_id,
            ai_config_id=ai_config_id,
            allowed_tools=allowed_tools,
        )
        device_tools: List[Dict[str, Any]] = []
        for name in sorted(names):
            tool = by_name.get(name)
            if tool:
                device_tools.append(tool)
                continue
            device_tools.append({
                "name": name,
                "description": "",
                "inputSchema": {},
                "destructive": True,
                "mcpSource": str(device_type_of(agent) or "desktop"),
                "deviceId": device_id,
                "allowedForCurrentAi": True,
            })
        groups.append({
            "groupKey": f"device:{device_id}",
            "groupLabel": f"{_agent_display_name(agent)} MCP",
            "groupKind": "device",
            "deviceId": device_id,
            "deviceType": str(device_type_of(agent) or ""),
            "tools": device_tools,
        })

    if not agents:
        groups.append({
            "groupKey": "device:none",
            "groupLabel": "端侧设备 MCP",
            "groupKind": "device",
            "deviceId": "",
            "deviceType": "",
            "tools": [],
        })

    return groups
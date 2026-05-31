from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from api.database import engine
from api.models import AssistantAIConfig, User
from api.models.defaults import DEFAULT_MCP_NAMESPACE_HINTS
from ..core import MCP_INTROSPECTION_TOOLS


def _tool_namespace(name: str) -> str:
    if "." in name:
        return name.split(".", 1)[0]
    if "_" in name:
        return name.split("_", 1)[0]
    return "other"


def _namespace_hints(user_id: int) -> dict[str, str]:
    import json

    try:
        with Session(engine) as session:
            user = session.get(User, user_id)
            raw = str(getattr(user, "mcp_namespace_hints", "") or "").strip() if user else ""
        parsed = json.loads(raw or DEFAULT_MCP_NAMESPACE_HINTS)
        if not isinstance(parsed, dict):
            raise ValueError()
    except Exception:
        parsed = json.loads(DEFAULT_MCP_NAMESPACE_HINTS)
    return {str(k).strip(): str(v).strip() for k, v in parsed.items() if str(k).strip() and str(v).strip()}


def _allowed_tool_names(user_id: int, ai_config_id: Optional[int]) -> set[str]:
    from connector_runtime.dispatch.desktop_agent_tools import (
        endpoint_bridge_tools_for_config,
        endpoint_tools_for_config,
        strip_endpoint_tool_config_names,
    )
    from api.services.task_system import with_workspace_read_by_name_compat
    import json

    allowed: set[str] = set(MCP_INTROSPECTION_TOOLS)
    if not ai_config_id:
        from ..registry import registry

        return {str(item.get("name") or "").strip() for item in registry.list_tools() if item.get("name")}

    with Session(engine) as session:
        cfg = session.exec(
            select(AssistantAIConfig).where(
                AssistantAIConfig.id == ai_config_id,
                AssistantAIConfig.user_id == user_id,
            )
        ).first()
    if not cfg or not cfg.mcp_enabled:
        return allowed
    try:
        parsed = json.loads(cfg.mcp_tools or "[]")
        if isinstance(parsed, list):
            allowed.update(str(item).strip() for item in parsed if isinstance(item, str) and str(item).strip())
    except Exception:
        pass
    allowed = strip_endpoint_tool_config_names(allowed)
    allowed = with_workspace_read_by_name_compat(allowed)
    allowed.update(endpoint_bridge_tools_for_config(getattr(cfg, "id", None), getattr(cfg, "user_id", None)))
    allowed.update(endpoint_tools_for_config(getattr(cfg, "id", None), getattr(cfg, "user_id", None)))
    return allowed


def _resolve_tool_alias(name: str, allowed: set[str]) -> str:
    raw = str(name or "").strip()
    if raw in allowed:
        return raw
    # Native tool schemas replace characters outside [a-zA-Z0-9_-] with "__".
    # Accept that form here so models can pass the visible native name back to
    # mcp.describe_tool, e.g. web__search -> web.search.
    if "__" in raw:
        dotted = raw.replace("__", ".")
        if dotted in allowed:
            return dotted
        underscored = raw.replace("__", "_")
        if underscored in allowed:
            return underscored
    return raw


def _mcp_list_tools(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int] = None):
    from ..registry import registry
    from connector_runtime.dispatch.desktop_agent_tools import endpoint_tool_description, is_endpoint_agent_tool
    from api.services.librarian_service import intrinsic_tool_description

    allowed = _allowed_tool_names(user_id, ai_config_id)
    namespace_filter = str(args.get("namespace") or "").strip()
    mode = str(args.get("mode") or "").strip().lower()
    if bool(args.get("all")):
        mode = "all"
    if namespace_filter and not mode:
        mode = "namespace"
    if mode not in {"", "namespaces", "namespace", "all"}:
        raise HTTPException(status_code=400, detail="mode must be namespaces, namespace, or all")
    groups: Dict[str, list[dict]] = {}
    seen: set[str] = set()
    for item in registry.list_tools():
        name = str(item.get("name") or "").strip()
        if not name or name not in allowed:
            continue
        seen.add(name)
        namespace = _tool_namespace(name)
        if namespace_filter and namespace != namespace_filter:
            continue
        groups.setdefault(namespace, []).append(
            {
                "name": name,
                "description": intrinsic_tool_description(user_id, name, str(item.get("description") or "")),
                "destructive": bool(item.get("destructive")),
            }
        )
    for name in sorted(allowed - seen):
        if not is_endpoint_agent_tool(name):
            continue
        namespace = _tool_namespace(name)
        if namespace_filter and namespace != namespace_filter:
            continue
        groups.setdefault(namespace, []).append(
            {
                "name": name,
                "description": intrinsic_tool_description(user_id, name, endpoint_tool_description(name)),
                "destructive": True,
            }
        )

    if mode in {"", "namespaces"} and not namespace_filter:
        hints = _namespace_hints(user_id)
        namespaces = []
        for namespace in sorted(groups):
            tools = sorted(groups[namespace], key=lambda item: item["name"])
            namespaces.append({
                "namespace": namespace,
                "tool_count": len(tools),
                "description": hints.get(namespace, ""),
            })
        return {
            "tree": "\n".join(
                f"{item['namespace']}/ ({item['tool_count']})"
                + (f" - {item['description']}" if item["description"] else "")
                for item in namespaces
            ) if namespaces else "（空）",
            "namespaces": namespaces,
            "hint": "传 namespace 展开某一层，例如 {\"namespace\":\"task\"}；确定工具名后用 mcp.describe_tool 查看参数 schema。",
        }

    lines = []
    for namespace in sorted(groups):
        tools = sorted(groups[namespace], key=lambda item: item["name"])
        lines.append(f"{namespace}/ ({len(tools)})")
        for tool in tools:
            marker = " !" if tool["destructive"] else ""
            lines.append(f"  - {tool['name']}{marker}")
    return {
        "tree": "\n".join(lines) if lines else "（空）",
        "mode": "all" if mode == "all" and not namespace_filter else "namespace",
        "groups": {key: sorted(value, key=lambda item: item["name"]) for key, value in sorted(groups.items())},
        "hint": "确定工具名后用 mcp.describe_tool 查看参数 schema，再调用目标工具。",
    }


def _mcp_describe_tool(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int] = None):
    from ..registry import registry
    from connector_runtime.dispatch.desktop_agent_tools import (
        endpoint_tool_description,
        endpoint_tool_input_schema,
        is_endpoint_agent_tool,
    )
    from api.services.librarian_service import intrinsic_input_schema, intrinsic_tool_description

    name = str(args.get("tool") or args.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="tool is required")
    allowed = _allowed_tool_names(user_id, ai_config_id)
    requested_name = name
    name = _resolve_tool_alias(name, allowed)
    if name not in allowed:
        raise HTTPException(status_code=403, detail=f"Tool is not allowed for this AI: {requested_name}")
    if is_endpoint_agent_tool(name):
        return {
            "name": name,
            "requested_name": requested_name,
            "description": intrinsic_tool_description(user_id, name, endpoint_tool_description(name)),
            "inputSchema": intrinsic_input_schema(user_id, name, endpoint_tool_input_schema(name)),
            "destructive": True,
            "call_format": {
                "tool": name,
                "arguments": {},
            },
        }
    tool = registry.get(name)
    return {
        "name": tool.name,
        "requested_name": requested_name,
        "description": intrinsic_tool_description(user_id, tool.name, tool.description),
        "inputSchema": intrinsic_input_schema(user_id, tool.name, tool.input_schema),
        "destructive": tool.destructive,
        "call_format": {
            "tool": tool.name,
            "arguments": {},
        },
    }

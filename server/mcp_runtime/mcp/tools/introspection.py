from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from api.database import engine
from api.models import AssistantAIConfig
from api.agent_presence import online_tool_defs
from ..core import MCP_INTROSPECTION_TOOLS


def _tool_namespace(name: str) -> str:
    if "." in name:
        return name.split(".", 1)[0]
    if "_" in name:
        return name.split("_", 1)[0]
    return "other"


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


def _describe_one_tool(name: str, endpoint_defs: Dict[str, Any]) -> Dict[str, Any]:
    from ..registry import registry
    from connector_runtime.dispatch.desktop_agent_tools import is_endpoint_agent_tool

    if is_endpoint_agent_tool(name):
        spec = endpoint_defs.get(name) or {}
        return {
            "name": name,
            "description": str(spec.get("description") or "").strip(),
            "inputSchema": spec.get("input_schema") if isinstance(spec.get("input_schema"), dict) else {},
            "destructive": True,
            "call_format": {"tool": name, "arguments": {}},
        }
    tool = registry.get(name)
    return {
        "name": tool.name,
        "description": str(tool.description or "").strip(),
        "inputSchema": tool.input_schema if isinstance(tool.input_schema, dict) else {},
        "destructive": tool.destructive,
        "call_format": {"tool": tool.name, "arguments": {}},
    }


def _mcp_describe_tool(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int] = None):
    """Load full schema(s) for one or more allowed tools.

    Supports three input shapes so the model can load everything it needs in a
    single round-trip:
    - ``tool``/``name``: one tool (backward-compatible single-object result).
    - ``tools``: a list (or comma-separated string) of exact tool names.
    - ``query``: keyword search across tool names + descriptions.
    """
    from connector_runtime.dispatch.desktop_agent_tools import is_endpoint_agent_tool

    endpoint_defs = online_tool_defs()
    allowed = _allowed_tool_names(user_id, ai_config_id)

    requested: list[str] = []
    single = str(args.get("tool") or args.get("name") or "").strip()
    if single:
        requested.append(single)
    raw_tools = args.get("tools")
    if isinstance(raw_tools, list):
        requested.extend(str(item).strip() for item in raw_tools if str(item).strip())
    elif isinstance(raw_tools, str) and raw_tools.strip():
        requested.extend(part.strip() for part in raw_tools.split(",") if part.strip())

    query = str(args.get("query") or "").strip()
    is_batch = bool(raw_tools) or (len(requested) > 1)

    # Keyword search mode: return schemas for every allowed tool that matches.
    if query and not requested:
        needle = query.lower()
        matches: list[Dict[str, Any]] = []
        for name in sorted(allowed):
            described = _describe_one_tool(name, endpoint_defs)
            haystack = f"{name} {described.get('description') or ''}".lower()
            if needle in haystack:
                matches.append(described)
            if len(matches) >= 25:
                break
        return {"query": query, "count": len(matches), "tools": matches}

    if not requested:
        raise HTTPException(status_code=400, detail="tool, tools, or query is required")

    results: list[Dict[str, Any]] = []
    errors: list[Dict[str, str]] = []
    for raw in requested:
        resolved = _resolve_tool_alias(raw, allowed)
        if resolved not in allowed:
            errors.append({"requested_name": raw, "error": "Tool is not allowed for this AI"})
            continue
        described = _describe_one_tool(resolved, endpoint_defs)
        described["requested_name"] = raw
        results.append(described)

    # Backward-compatible single-object result for one plain tool lookup.
    if not is_batch:
        if results:
            return results[0]
        raise HTTPException(status_code=403, detail=f"Tool is not allowed for this AI: {requested[0]}")

    return {"count": len(results), "tools": results, "errors": errors}

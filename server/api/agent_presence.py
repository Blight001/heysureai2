"""Read/write helpers for the endpoint-agent presence snapshot.

Written by the process that owns the agent sockets (api-gateway, on
register / disconnect / bind) and read by every process during endpoint tool
discovery and classification. See ``api.models.agent_presence``.
"""

import json
import time
from typing import Dict, List, Optional, Set, Tuple

from sqlmodel import Session, select

from .database import engine
from .models import EndpointAgentPresence


def _int(value) -> Optional[int]:
    try:
        if value in (None, "", 0, "0"):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _decode(row: EndpointAgentPresence) -> Set[str]:
    try:
        parsed = json.loads(row.capabilities_json or "[]")
    except Exception:
        return set()
    if not isinstance(parsed, list):
        return set()
    return {str(x).strip() for x in parsed if str(x).strip()}


def _decode_defs(row: EndpointAgentPresence) -> Dict[str, dict]:
    try:
        parsed = json.loads(getattr(row, "tool_defs_json", "") or "{}")
    except Exception:
        return {}
    if not isinstance(parsed, dict):
        return {}
    out: Dict[str, dict] = {}
    for name, spec in parsed.items():
        key = str(name or "").strip()
        if not key or not isinstance(spec, dict):
            continue
        schema = spec.get("input_schema")
        out[key] = {
            "description": str(spec.get("description") or "").strip(),
            "input_schema": schema if isinstance(schema, dict) else {},
        }
    return out


def _load_presence_rows(session: Session, agent_id: str):
    return session.exec(
        select(EndpointAgentPresence)
        .where(EndpointAgentPresence.agent_id == agent_id)
        .order_by(EndpointAgentPresence.updated_at.desc(), EndpointAgentPresence.id.desc())
    ).all()


def upsert_presence(
    user_id, agent_id, ai_config_id, agent_type, capabilities, online: bool = True, tool_defs=None
) -> None:
    aid = str(agent_id or "").strip()
    if not aid:
        return
    caps = sorted({str(c).strip() for c in (capabilities or []) if str(c).strip()})
    defs = tool_defs if isinstance(tool_defs, dict) else {}
    uid = _int(user_id)
    with Session(engine) as session:
        rows = _load_presence_rows(session, aid)
        row = rows[0] if rows else None
        for stale in rows[1:]:
            session.delete(stale)
        if not row:
            row = EndpointAgentPresence(agent_id=aid)
            session.add(row)
        row.user_id = uid or row.user_id or 0
        row.ai_config_id = _int(ai_config_id)
        row.agent_type = str(agent_type or "").strip()
        row.capabilities_json = json.dumps(caps, ensure_ascii=False)
        row.tool_defs_json = json.dumps(defs, ensure_ascii=False)
        row.online = bool(online)
        row.updated_at = time.time()
        session.commit()


def set_offline(agent_id) -> None:
    aid = str(agent_id or "").strip()
    if not aid:
        return
    with Session(engine) as session:
        rows = _load_presence_rows(session, aid)
        row = rows[0] if rows else None
        dirty = bool(rows[1:])
        for stale in rows[1:]:
            session.delete(stale)
        if row and row.online:
            row.online = False
            row.updated_at = time.time()
            dirty = True
        if dirty:
            session.commit()


def update_binding(agent_id, ai_config_id) -> None:
    aid = str(agent_id or "").strip()
    if not aid:
        return
    with Session(engine) as session:
        rows = _load_presence_rows(session, aid)
        row = rows[0] if rows else None
        dirty = bool(rows[1:])
        for stale in rows[1:]:
            session.delete(stale)
        if row:
            row.ai_config_id = _int(ai_config_id)
            row.updated_at = time.time()
            dirty = True
        if dirty:
            session.commit()


def mark_all_offline() -> None:
    """Reset presence on a fresh gateway boot — sockets re-register and flip
    their own rows back online."""
    with Session(engine) as session:
        rows = session.exec(
            select(EndpointAgentPresence).where(EndpointAgentPresence.online == True)  # noqa: E712
        ).all()
        for row in rows:
            row.online = False
            row.updated_at = time.time()
        if rows:
            session.commit()


def online_agents_for_config(user_id, ai_config_id) -> List[Tuple[str, str, Set[str]]]:
    """``(agent_id, agent_type, capabilities)`` for every online agent bound to a
    config. ``agent_id`` lets callers apply per-agent MCP scope."""
    cfg = _int(ai_config_id)
    if not cfg:
        return []
    uid = _int(user_id)
    out: List[Tuple[str, str, Set[str]]] = []
    with Session(engine) as session:
        rows = session.exec(
            select(EndpointAgentPresence).where(
                EndpointAgentPresence.ai_config_id == cfg,
                EndpointAgentPresence.online == True,  # noqa: E712
            ).order_by(EndpointAgentPresence.updated_at.desc(), EndpointAgentPresence.id.desc())
        ).all()
        seen_agents: Set[str] = set()
        for row in rows:
            agent_id = str(row.agent_id or "").strip()
            if not agent_id or agent_id in seen_agents:
                continue
            seen_agents.add(agent_id)
            if uid and row.user_id and row.user_id != uid:
                continue
            out.append((agent_id, str(row.agent_type or "").strip(), _decode(row)))
    return out


def online_tool_names() -> Tuple[Set[str], Set[str]]:
    """``(desktop_tools, browser_tools)`` advertised by all online agents — used
    for context-free tool classification. 工坊（workshop）agent 的工具单独走
    :func:`online_workshop_agents_for_user`，不混入桌面桶。"""
    desktop: Set[str] = set()
    browser: Set[str] = set()
    with Session(engine) as session:
        rows = session.exec(
            select(EndpointAgentPresence)
            .where(EndpointAgentPresence.online == True)  # noqa: E712
            .order_by(EndpointAgentPresence.updated_at.desc(), EndpointAgentPresence.id.desc())
        ).all()
        seen_agents: Set[str] = set()
        for row in rows:
            agent_id = str(row.agent_id or "").strip()
            if not agent_id or agent_id in seen_agents:
                continue
            seen_agents.add(agent_id)
            caps = _decode(row)
            agent_type = str(row.agent_type or "").strip()
            if agent_type == "workshop":
                continue
            if agent_type == "browser":
                browser |= caps
            else:
                desktop |= caps
    return desktop, browser


def online_workshop_agents_for_user(user_id) -> List[Tuple[str, Set[str]]]:
    """``(agent_id, capabilities)`` for every online workshop agent of a user.
    绑定关系（哪些 AI 可用）由 ``api.workshop_bindings`` 决定，这里只回答
    "谁在线、各自上报了什么工具"。"""
    uid = _int(user_id)
    out: List[Tuple[str, Set[str]]] = []
    with Session(engine) as session:
        rows = session.exec(
            select(EndpointAgentPresence).where(
                EndpointAgentPresence.agent_type == "workshop",
                EndpointAgentPresence.online == True,  # noqa: E712
            ).order_by(EndpointAgentPresence.updated_at.desc(), EndpointAgentPresence.id.desc())
        ).all()
        seen_agents: Set[str] = set()
        for row in rows:
            agent_id = str(row.agent_id or "").strip()
            if not agent_id or agent_id in seen_agents:
                continue
            seen_agents.add(agent_id)
            if uid and row.user_id and row.user_id != uid:
                continue
            out.append((agent_id, _decode(row)))
    return out


def online_tool_defs() -> Dict[str, dict]:
    """Merged ``{tool_name: {description, input_schema}}`` self-described by all
    online agents. The agent is the source of truth for its own tool schemas;
    the server reads them here instead of hardcoding per-tool schemas."""
    out: Dict[str, dict] = {}
    with Session(engine) as session:
        rows = session.exec(
            select(EndpointAgentPresence)
            .where(EndpointAgentPresence.online == True)  # noqa: E712
            .order_by(EndpointAgentPresence.updated_at.desc(), EndpointAgentPresence.id.desc())
        ).all()
        seen_agents: Set[str] = set()
        for row in rows:
            agent_id = str(row.agent_id or "").strip()
            if not agent_id or agent_id in seen_agents:
                continue
            seen_agents.add(agent_id)
            for name, spec in _decode_defs(row).items():
                out.setdefault(name, spec)
    return out

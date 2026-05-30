"""Read/write helpers for the endpoint-agent presence snapshot.

Written by the process that owns the agent sockets (api-gateway, on
register / disconnect / bind) and read by every process during endpoint tool
discovery and classification. See ``api.models.agent_presence``.
"""

import json
import time
from typing import List, Optional, Set, Tuple

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


def upsert_presence(user_id, agent_id, ai_config_id, agent_type, capabilities, online: bool = True) -> None:
    aid = str(agent_id or "").strip()
    if not aid:
        return
    caps = sorted({str(c).strip() for c in (capabilities or []) if str(c).strip()})
    uid = _int(user_id)
    with Session(engine) as session:
        row = session.exec(
            select(EndpointAgentPresence).where(EndpointAgentPresence.agent_id == aid)
        ).first()
        if not row:
            row = EndpointAgentPresence(agent_id=aid)
            session.add(row)
        row.user_id = uid or row.user_id or 0
        row.ai_config_id = _int(ai_config_id)
        row.agent_type = str(agent_type or "").strip()
        row.capabilities_json = json.dumps(caps, ensure_ascii=False)
        row.online = bool(online)
        row.updated_at = time.time()
        session.commit()


def set_offline(agent_id) -> None:
    aid = str(agent_id or "").strip()
    if not aid:
        return
    with Session(engine) as session:
        row = session.exec(
            select(EndpointAgentPresence).where(EndpointAgentPresence.agent_id == aid)
        ).first()
        if row and row.online:
            row.online = False
            row.updated_at = time.time()
            session.commit()


def update_binding(agent_id, ai_config_id) -> None:
    aid = str(agent_id or "").strip()
    if not aid:
        return
    with Session(engine) as session:
        row = session.exec(
            select(EndpointAgentPresence).where(EndpointAgentPresence.agent_id == aid)
        ).first()
        if row:
            row.ai_config_id = _int(ai_config_id)
            row.updated_at = time.time()
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


def online_agents_for_config(user_id, ai_config_id) -> List[Tuple[str, Set[str]]]:
    """``(agent_type, capabilities)`` for every online agent bound to a config."""
    cfg = _int(ai_config_id)
    if not cfg:
        return []
    uid = _int(user_id)
    out: List[Tuple[str, Set[str]]] = []
    with Session(engine) as session:
        rows = session.exec(
            select(EndpointAgentPresence).where(
                EndpointAgentPresence.ai_config_id == cfg,
                EndpointAgentPresence.online == True,  # noqa: E712
            )
        ).all()
        for row in rows:
            if uid and row.user_id and row.user_id != uid:
                continue
            out.append((str(row.agent_type or "").strip(), _decode(row)))
    return out


def online_tool_names() -> Tuple[Set[str], Set[str]]:
    """``(desktop_tools, browser_tools)`` advertised by all online agents — used
    for context-free tool classification."""
    desktop: Set[str] = set()
    browser: Set[str] = set()
    with Session(engine) as session:
        rows = session.exec(
            select(EndpointAgentPresence).where(EndpointAgentPresence.online == True)  # noqa: E712
        ).all()
        for row in rows:
            caps = _decode(row)
            if str(row.agent_type or "").strip() == "browser":
                browser |= caps
            else:
                desktop |= caps
    return desktop, browser

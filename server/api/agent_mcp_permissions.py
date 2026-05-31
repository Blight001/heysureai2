"""Read/write helpers for per-agent endpoint MCP permission scope.

Kept separate from the socket / REST layers so the dispatch path (which reads
the scope on every endpoint tool call) and the Workshop / AI-settings editors
(which write it) share one source of truth. See
``api.models.agent_mcp_permission``.

Scope is keyed by ``(user_id, agent_id)`` — each individual connected agent has
its own allow-list. A missing row means "closed" — the bound AI may not use any
tool from that agent until the Workshop saves a scope. Callers distinguish that
from an explicit empty allow-list: ``get_scope`` returns ``None`` for "no
record" and a (possibly empty) ``set`` when a row exists.
"""

import json
import time
from typing import Iterable, Optional, Set

from sqlmodel import Session, select

from .database import engine
from .models import AgentTypeMcpPermission

VALID_AGENT_TYPES = ("linux", "desktop", "browser")


def _coerce_int(value) -> Optional[int]:
    try:
        if value in (None, "", 0, "0"):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _agent_id(value) -> str:
    return str(value or "").strip()


def _normalize_type(agent_type) -> str:
    value = str(agent_type or "").strip().lower()
    return value if value in VALID_AGENT_TYPES else ""


def _decode_tools(raw: str) -> Set[str]:
    try:
        parsed = json.loads(raw or "[]")
    except Exception:
        return set()
    if not isinstance(parsed, list):
        return set()
    return {str(item).strip() for item in parsed if isinstance(item, str) and str(item).strip()}


def get_scope(user_id, agent_id) -> Optional[Set[str]]:
    """Return the saved allow-list for (user, agent), or ``None`` when no row
    exists (meaning: default closed)."""
    uid = _coerce_int(user_id)
    aid = _agent_id(agent_id)
    if uid is None or not aid:
        return None
    with Session(engine) as session:
        row = session.exec(
            select(AgentTypeMcpPermission).where(
                AgentTypeMcpPermission.user_id == uid,
                AgentTypeMcpPermission.agent_id == aid,
            )
        ).first()
        return _decode_tools(row.tools_json) if row else None


def set_scope(user_id, agent_id, tools: Iterable[str], *, ai_config_id=None, agent_type="") -> Optional[Set[str]]:
    """Upsert the allow-list for one agent. ``ai_config_id`` / ``agent_type`` are
    stored as informational columns. Returns the stored set, or ``None`` on bad
    input."""
    uid = _coerce_int(user_id)
    aid = _agent_id(agent_id)
    if uid is None or not aid:
        return None
    allowed = sorted({str(item).strip() for item in (tools or []) if str(item).strip()})
    encoded = json.dumps(allowed, ensure_ascii=False)
    cfg = _coerce_int(ai_config_id)
    atype = _normalize_type(agent_type)
    with Session(engine) as session:
        row = session.exec(
            select(AgentTypeMcpPermission).where(
                AgentTypeMcpPermission.user_id == uid,
                AgentTypeMcpPermission.agent_id == aid,
            )
        ).first()
        if row:
            row.tools_json = encoded
            row.ai_config_id = cfg
            row.agent_type = atype or row.agent_type
            row.updated_at = time.time()
        else:
            row = AgentTypeMcpPermission(
                user_id=uid, agent_id=aid, ai_config_id=cfg, agent_type=atype, tools_json=encoded
            )
            session.add(row)
        session.commit()
    return set(allowed)

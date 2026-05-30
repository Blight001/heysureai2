"""Read/write helpers for per-(AI, agent-type) endpoint MCP permission scope.

Kept separate from the socket / REST layers so the dispatch path (which reads
the scope on every endpoint tool call) and the Workshop / AI-settings editors
(which write it) share one source of truth. See
``api.models.agent_mcp_permission``.

A missing row means "unrestricted" — the AI may use every tool the connected
agent of that type reports. Callers distinguish that from an explicit empty
allow-list: ``get_scope`` returns ``None`` for "no record" and a (possibly
empty) ``set`` when a row exists.
"""

import json
import time
from typing import Iterable, Optional, Set

from sqlmodel import Session, select

from .database import engine
from .models import AgentTypeMcpPermission

VALID_AGENT_TYPES = ("desktop", "browser")


def _coerce_int(value) -> Optional[int]:
    try:
        if value in (None, "", 0, "0"):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _normalize_type(agent_type) -> Optional[str]:
    value = str(agent_type or "").strip().lower()
    return value if value in VALID_AGENT_TYPES else None


def _decode_tools(raw: str) -> Set[str]:
    try:
        parsed = json.loads(raw or "[]")
    except Exception:
        return set()
    if not isinstance(parsed, list):
        return set()
    return {str(item).strip() for item in parsed if isinstance(item, str) and str(item).strip()}


def get_scope(user_id, ai_config_id, agent_type) -> Optional[Set[str]]:
    """Return the saved allow-list for (user, ai_config, type), or ``None`` when
    no row exists (meaning: no restriction configured yet)."""
    uid = _coerce_int(user_id)
    cfg = _coerce_int(ai_config_id)
    atype = _normalize_type(agent_type)
    if uid is None or cfg is None or atype is None:
        return None
    with Session(engine) as session:
        row = session.exec(
            select(AgentTypeMcpPermission).where(
                AgentTypeMcpPermission.user_id == uid,
                AgentTypeMcpPermission.ai_config_id == cfg,
                AgentTypeMcpPermission.agent_type == atype,
            )
        ).first()
        return _decode_tools(row.tools_json) if row else None


def set_scope(user_id, ai_config_id, agent_type, tools: Iterable[str]) -> Optional[Set[str]]:
    """Upsert the allow-list. Returns the stored set, or ``None`` on bad input."""
    uid = _coerce_int(user_id)
    cfg = _coerce_int(ai_config_id)
    atype = _normalize_type(agent_type)
    if uid is None or cfg is None or atype is None:
        return None
    allowed = sorted({str(item).strip() for item in (tools or []) if str(item).strip()})
    encoded = json.dumps(allowed, ensure_ascii=False)
    with Session(engine) as session:
        row = session.exec(
            select(AgentTypeMcpPermission).where(
                AgentTypeMcpPermission.user_id == uid,
                AgentTypeMcpPermission.ai_config_id == cfg,
                AgentTypeMcpPermission.agent_type == atype,
            )
        ).first()
        if row:
            row.tools_json = encoded
            row.updated_at = time.time()
        else:
            row = AgentTypeMcpPermission(
                user_id=uid, ai_config_id=cfg, agent_type=atype, tools_json=encoded
            )
            session.add(row)
        session.commit()
    return set(allowed)

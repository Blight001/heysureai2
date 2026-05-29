"""Read/write helpers for persistent device → AI bindings.

Kept separate from the socket/REST layers so both the ``agent:register``
handler (re-apply on connect) and the Workshop bind endpoint (operator
assigns) share one source of truth. See ``api.models.agent_binding``.
"""

import time
from typing import Optional

from sqlmodel import Session, select

from .database import engine
from .models import AgentAiBinding


def _coerce_int(value) -> Optional[int]:
    try:
        if value in (None, "", 0, "0"):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def get_binding(user_id, agent_id) -> Optional[int]:
    """Return the assigned ai_config_id for (user_id, agent_id), or None."""
    uid = _coerce_int(user_id)
    aid = str(agent_id or "").strip()
    if uid is None or not aid:
        return None
    with Session(engine) as session:
        row = session.exec(
            select(AgentAiBinding).where(
                AgentAiBinding.user_id == uid,
                AgentAiBinding.agent_id == aid,
            )
        ).first()
        return _coerce_int(row.ai_config_id) if row else None


def set_binding(user_id, agent_id, ai_config_id) -> Optional[int]:
    """Upsert the binding. A falsy ai_config_id deletes the row (unassign).

    Returns the stored ai_config_id (or None when unassigned).
    """
    uid = _coerce_int(user_id)
    aid = str(agent_id or "").strip()
    cfg = _coerce_int(ai_config_id)
    if uid is None or not aid:
        return None
    with Session(engine) as session:
        row = session.exec(
            select(AgentAiBinding).where(
                AgentAiBinding.user_id == uid,
                AgentAiBinding.agent_id == aid,
            )
        ).first()
        if cfg is None:
            if row:
                session.delete(row)
                session.commit()
            return None
        if row:
            row.ai_config_id = cfg
            row.updated_at = time.time()
        else:
            row = AgentAiBinding(user_id=uid, agent_id=aid, ai_config_id=cfg)
            session.add(row)
        session.commit()
        return cfg

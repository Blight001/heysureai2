"""Read/write helpers for AI → workshop-agent bindings (知识与进化工坊).

A workshop agent serves many AIs at once, so binding is declared from the AI
side (one row per (agent_id, ai_config_id) pair) instead of the 1:1 device
binding in ``api.agent_bindings``. Shared by the dispatch path (which resolves
the workshop agent for a calling AI) and the REST binding endpoints.
"""

import time
from typing import List, Optional, Set

from sqlmodel import Session, select

from .database import engine
from .models import WorkshopAiBinding


def _coerce_int(value) -> Optional[int]:
    try:
        if value in (None, "", 0, "0"):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def workshop_agent_ids_for_config(user_id, ai_config_id) -> List[str]:
    """Workshop agent ids this AI is bound to (may be offline)."""
    uid = _coerce_int(user_id)
    cfg = _coerce_int(ai_config_id)
    if uid is None or cfg is None:
        return []
    with Session(engine) as session:
        rows = session.exec(
            select(WorkshopAiBinding).where(
                WorkshopAiBinding.user_id == uid,
                WorkshopAiBinding.ai_config_id == cfg,
            )
        ).all()
        return sorted({str(row.agent_id or "").strip() for row in rows if str(row.agent_id or "").strip()})


def bound_config_ids_for_agent(user_id, agent_id) -> Set[int]:
    """AI config ids bound to one workshop agent."""
    uid = _coerce_int(user_id)
    aid = str(agent_id or "").strip()
    if uid is None or not aid:
        return set()
    with Session(engine) as session:
        rows = session.exec(
            select(WorkshopAiBinding).where(
                WorkshopAiBinding.user_id == uid,
                WorkshopAiBinding.agent_id == aid,
            )
        ).all()
        return {int(row.ai_config_id) for row in rows if row.ai_config_id}


def set_workshop_binding(user_id, agent_id, ai_config_id, *, bound: bool) -> bool:
    """Create or remove one (agent, AI) binding pair. Returns the stored state."""
    uid = _coerce_int(user_id)
    aid = str(agent_id or "").strip()
    cfg = _coerce_int(ai_config_id)
    if uid is None or not aid or cfg is None:
        return False
    with Session(engine) as session:
        row = session.exec(
            select(WorkshopAiBinding).where(
                WorkshopAiBinding.user_id == uid,
                WorkshopAiBinding.agent_id == aid,
                WorkshopAiBinding.ai_config_id == cfg,
            )
        ).first()
        if bound:
            if not row:
                session.add(WorkshopAiBinding(user_id=uid, agent_id=aid, ai_config_id=cfg))
                session.commit()
            else:
                row.updated_at = time.time()
                session.add(row)
                session.commit()
            return True
        if row:
            session.delete(row)
            session.commit()
        return False

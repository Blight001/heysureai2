"""Read/write helpers for AI → workshop-agent bindings (知识与进化工坊).

工坊与 AI 是 **1:1 绑定**：一个工坊同一时间只服务一个 AI 数字成员
（绑定新 AI 会替换旧绑定）。与设备绑定（``api.agent_bindings``）的差异
仅在绑定方向：工坊绑定从 AI 侧声明、存 ``WorkshopAiBinding``。
Shared by the dispatch path (which resolves the workshop agent for a
calling AI) and the REST binding endpoints.
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
    """AI config ids bound to one workshop agent（1:1 语义下至多 1 个）。"""
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


def bound_config_id_for_agent(user_id, agent_id) -> Optional[int]:
    """当前绑定到该工坊的唯一 AI config id（无绑定返回 None）。"""
    ids = sorted(bound_config_ids_for_agent(user_id, agent_id))
    return ids[0] if ids else None


def set_workshop_binding(user_id, agent_id, ai_config_id, *, bound: bool) -> bool:
    """Create or remove the (agent, AI) binding. Returns the stored state.

    1:1 强约束：绑定时会删除该工坊名下所有其它 AI 的绑定行（替换语义），
    并兜底清理历史多绑定数据。
    """
    uid = _coerce_int(user_id)
    aid = str(agent_id or "").strip()
    cfg = _coerce_int(ai_config_id)
    if uid is None or not aid or cfg is None:
        return False
    with Session(engine) as session:
        rows = session.exec(
            select(WorkshopAiBinding).where(
                WorkshopAiBinding.user_id == uid,
                WorkshopAiBinding.agent_id == aid,
            )
        ).all()
        current = next((row for row in rows if _coerce_int(row.ai_config_id) == cfg), None)
        if bound:
            dirty = False
            for row in rows:
                if row is not current:
                    session.delete(row)
                    dirty = True
            if not current:
                session.add(WorkshopAiBinding(user_id=uid, agent_id=aid, ai_config_id=cfg))
                dirty = True
            else:
                current.updated_at = time.time()
                session.add(current)
                dirty = True
            if dirty:
                session.commit()
            return True
        if current:
            session.delete(current)
            session.commit()
        return False

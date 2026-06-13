"""User-scoped snapshots for live endpoint agents and the builtin workshop."""

import logging

from api.sio import agents, sio


logger = logging.getLogger(__name__)


def _positive_int(value):
    try:
        parsed = int(value)
        return parsed if parsed > 0 else None
    except (TypeError, ValueError):
        return None


def connected_agent_rows_for_user(user_id: int):
    """Build the live agent snapshot visible to one user."""
    uid = _positive_int(user_id)
    if uid is None:
        return []
    rows = [
        agent for agent in agents.values()
        if _positive_int(agent.get("userId") or agent.get("user_id")) == uid
    ]
    try:
        from workshop import engine as workshop_engine

        workshop_engine.ensure_presence_for_user(uid)
        rows.append(workshop_engine.connected_entry_for_user(uid))
    except Exception:
        logger.exception("failed to add builtin workshop to agent snapshot user=%s", uid)
    return rows


async def emit_agent_list_for_user(user_id: int, *, to=None) -> None:
    """Emit a user-scoped snapshot to one socket or the user's UI room."""
    uid = _positive_int(user_id)
    if uid is None:
        return
    await sio.emit(
        "device:list",
        connected_agent_rows_for_user(uid),
        to=to or f"user_{uid}",
    )

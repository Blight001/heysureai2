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


def _online_sids_for(user_id: int, device_type: str) -> list:
    """Socket ids of the user's online endpoint agents of one device type."""
    from connector_runtime.dispatch.desktop_device_tools import device_type_of

    uid = _positive_int(user_id)
    if uid is None:
        return []
    out = []
    for sid, agent in list(agents.items()):
        if _positive_int(agent.get("userId") or agent.get("user_id")) != uid:
            continue
        if device_type_of(agent) != device_type:
            continue
        out.append(sid)
    return out


async def push_device_dynamic_tools(user_id: int, device_type: str) -> int:
    """Push the current web-authored dynamic MCP set to every online device of
    this type. Returns how many sockets it reached. The device merges the set
    into its dynamic interpreter and re-reports its catalog, so the rest of the
    endpoint pipeline keeps working unchanged."""
    from api.services import device_dynamic_tools as dyn

    try:
        dtype = dyn.normalize_device_type(device_type)
    except ValueError:
        return 0
    sids = _online_sids_for(user_id, dtype)
    if not sids:
        return 0
    payload = dyn.device_payload(user_id, dtype)
    for sid in sids:
        await sio.emit("device:tool-config", payload, to=sid)
    return len(sids)


async def push_device_dynamic_tools_to_sid(user_id: int, device_type: str, sid: str) -> None:
    """Push the dynamic MCP set to one freshly-registered socket so it picks up
    edits made while it was offline."""
    from api.services import device_dynamic_tools as dyn

    try:
        dtype = dyn.normalize_device_type(device_type)
    except ValueError:
        return
    await sio.emit("device:tool-config", dyn.device_payload(user_id, dtype), to=sid)

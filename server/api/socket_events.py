import logging
import time

from sqlmodel import Session, select

from api.agent_bindings import get_binding
from api.database import engine
from api.models import AssistantAIConfig
from api.sio import (
    sio,
    agents,
    is_agent_shared_secret,
    resolve_agent_user,
)
from connector_runtime.dispatch.agent_dispatch import (
    handle_task_error,
    handle_task_progress,
    handle_task_result,
    purge_stale_dispatches,
)


logger = logging.getLogger(__name__)


def _ai_config_belongs_to_user(ai_config_id, user_id: int) -> bool:
    """Return True only if the AI config is owned by the registering user."""
    if ai_config_id in (None, "", 0):
        return True  # No AI claimed; allow generic registration.
    try:
        cfg_id = int(ai_config_id)
    except (TypeError, ValueError):
        return False
    with Session(engine) as session:
        cfg = session.exec(
            select(AssistantAIConfig).where(AssistantAIConfig.id == cfg_id)
        ).first()
        return bool(cfg and cfg.user_id == user_id)


def register_user_socket_events():
    """User-side handlers — what the browser/web client triggers.

    Currently only ``ui:join`` because user → server flows mostly go through
    REST. Browser ``connect`` / ``disconnect`` are still useful for visibility
    in logs even when no behavior depends on them.
    """
    @sio.on('connect')
    async def connect(sid, environ):
        logger.info('Client connected: %s', sid)

    @sio.on('ui:join')
    async def ui_join(sid, data):
        user_id = data.get("userId") if isinstance(data, dict) else None
        if user_id is None:
            return
        await sio.enter_room(sid, f"user_{user_id}")
        # Opportunistically clean up dispatches whose agent vanished.
        purge_stale_dispatches()
        await sio.emit('agent:list', list(agents.values()), to=sid)


def register_agent_socket_events():
    """Agent-side handlers — what desktop / browser agents trigger.

    Lives on connector-runtime in split deployments so agent connections
    survive api-gateway restarts. The monolith registers BOTH this and the
    user-side block on the same sio instance.
    """
    @sio.on('agent:register')
    async def agent_register(sid, info):
        info = info if isinstance(info, dict) else {}
        token = info.get('token')

        # Resolve to a logged-in user. Shared secret (if configured) is the
        # only allowed bypass and skips the per-user binding.
        owner_user_id = None
        owner_account = None
        if is_agent_shared_secret(token):
            owner_user_id = info.get('userId')
            try:
                owner_user_id = int(owner_user_id) if owner_user_id is not None else None
            except (TypeError, ValueError):
                owner_user_id = None
        else:
            resolved = resolve_agent_user(token)
            if not resolved:
                logger.info('Agent registration rejected (no auth): %s', info.get('id'))
                await sio.emit(
                    'agent:register_rejected',
                    {'reason': 'agent must be logged in (invalid or missing user token)'},
                    to=sid,
                )
                return
            owner_user_id, owner_account = resolved

        # Devices no longer pick their own AI — they log in and connect, then an
        # operator assigns a server-side AI from the Workshop panel. Re-apply any
        # persisted binding for this (user, agent) so the assignment survives
        # reconnects. A payload aiConfigId (legacy clients) is honoured only as a
        # fallback when no server-side binding exists.
        agent_id = str(info.get('id') or sid)
        bound_ai = get_binding(owner_user_id, agent_id) if owner_user_id is not None else None
        claimed_ai = bound_ai if bound_ai is not None else info.get('aiConfigId')
        if owner_user_id is not None and not _ai_config_belongs_to_user(claimed_ai, owner_user_id):
            logger.warning(
                f"Agent registration rejected (AI ownership mismatch): "
                f"agent={info.get('id')} user={owner_user_id} ai={claimed_ai}"
            )
            await sio.emit(
                'agent:register_rejected',
                {'reason': 'selected AI does not belong to the logged-in user'},
                to=sid,
            )
            return

        # Idempotent: drop any stale socket entry for the same logical agent id
        # so a reconnect updates the socketId instead of duplicating the agent.
        for old_sid in [s for s, a in agents.items() if str(a.get('id')) == agent_id and s != sid]:
            del agents[old_sid]

        info.pop('token', None)
        agents[sid] = {
            **info,
            'id': agent_id,
            'aiConfigId': claimed_ai,
            'socketId': sid,
            'userId': owner_user_id,
            'userAccount': owner_account,
            'capabilities': info.get('capabilities') or [],
            'version': info.get('version') or '',
            'lifecycle': info.get('lifecycle') or 'registered',
            'connectedAt': time.time(),
            'lastSeenAt': time.time(),
            'lastTaskId': None,
            'lastTaskStatus': None,
            'lastTaskAt': None,
            'lastError': None,
            'source': 'socket',
            'dispatchable': True,
        }
        logger.info(
            f"Agent registered: {agent_id} user={owner_user_id} "
            f"ai={agents[sid].get('aiConfigId')}"
        )
        # Mirror this endpoint agent into the shared DB presence snapshot so
        # ai-runtime / mcp-runtime (separate processes) can discover and
        # classify its tools. Never let a presence write break registration.
        try:
            from connector_runtime.dispatch.desktop_agent_tools import (
                agent_type_of,
                agent_endpoint_tools,
                agent_endpoint_tool_defs,
            )
            from api.agent_presence import upsert_presence

            atype = agent_type_of(agents[sid])
            if atype:
                upsert_presence(
                    owner_user_id,
                    agent_id,
                    claimed_ai,
                    atype,
                    sorted(agent_endpoint_tools(agents[sid])),
                    online=True,
                    tool_defs=agent_endpoint_tool_defs(agents[sid]),
                )
        except Exception:
            logger.exception('Failed to record endpoint agent presence: %s', agent_id)
        # Include the server-side bound AI so the device can show whether an AI
        # is assigned yet (status indicator: green = bound, yellow = none).
        await sio.emit('agent:registered', {'id': agent_id, 'aiConfigId': claimed_ai}, to=sid)
        await sio.emit('agent:list', list(agents.values()))

    @sio.on('flow:log')
    async def flow_log(sid, data):
        await sio.emit('flow:monitor', data)

    @sio.on('task:progress')
    async def task_progress(sid, data):
        await handle_task_progress(data if isinstance(data, dict) else {})

    @sio.on('task:result')
    async def task_result(sid, data):
        await handle_task_result(data if isinstance(data, dict) else {})
        await sio.emit('agent:list', list(agents.values()))

    @sio.on('task:error')
    async def task_error(sid, data):
        await handle_task_error(data if isinstance(data, dict) else {})
        await sio.emit('agent:list', list(agents.values()))

    @sio.on('disconnect')
    async def disconnect(sid):
        if sid in agents:
            agent_id_for_presence = str(agents[sid].get('id') or '')
            del agents[sid]
            try:
                from api.agent_presence import set_offline
                set_offline(agent_id_for_presence)
            except Exception:
                logger.exception('Failed to mark endpoint agent offline: %s', agent_id_for_presence)
            await sio.emit('agent:list', list(agents.values()))


def register_socket_events():
    """Register both halves. Used by the monolith and (for safety) when
    the deployment is intentionally collapsed into one process."""
    register_user_socket_events()
    register_agent_socket_events()

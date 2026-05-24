import time

from api.sio import sio, agents, is_agent_token_valid
from api.services.agent_dispatch import (
    handle_task_error,
    handle_task_progress,
    handle_task_result,
    purge_stale_dispatches,
)

def register_socket_events():
    @sio.on('connect')
    async def connect(sid, environ):
        print('Client connected:', sid)

    @sio.on('agent:register')
    async def agent_register(sid, info):
        info = info if isinstance(info, dict) else {}
        token = info.get('token')
        if not is_agent_token_valid(token):
            print('Agent registration rejected (bad token):', info.get('id'))
            await sio.emit('agent:register_rejected', {'reason': 'invalid agent token'}, to=sid)
            return

        agent_id = str(info.get('id') or sid)
        # Idempotent: drop any stale socket entry for the same logical agent id
        # so a reconnect updates the socketId instead of duplicating the agent.
        for old_sid in [s for s, a in agents.items() if str(a.get('id')) == agent_id and s != sid]:
            del agents[old_sid]

        info.pop('token', None)
        agents[sid] = {
            **info,
            'id': agent_id,
            'socketId': sid,
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
        print('Agent registered:', agent_id)
        await sio.emit('agent:registered', {'id': agent_id}, to=sid)
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

    @sio.on('ui:join')
    async def ui_join(sid, data):
        user_id = data.get("userId") if isinstance(data, dict) else None
        if user_id is None:
            return
        await sio.enter_room(sid, f"user_{user_id}")
        # Opportunistically clean up dispatches whose agent vanished.
        purge_stale_dispatches()
        await sio.emit('agent:list', list(agents.values()), to=sid)

    @sio.on('disconnect')
    async def disconnect(sid):
        if sid in agents:
            del agents[sid]
            await sio.emit('agent:list', list(agents.values()))

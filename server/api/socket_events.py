import time

from api.sio import sio, agents
from api.agent_dispatch import (
    handle_task_error,
    handle_task_progress,
    handle_task_result,
)

def register_socket_events():
    @sio.on('connect')
    async def connect(sid, environ):
        print('Client connected:', sid)

    @sio.on('agent:register')
    async def agent_register(sid, info):
        info = info if isinstance(info, dict) else {}
        print('Agent registered:', info)
        agents[sid] = {
            **info,
            'socketId': sid,
            'capabilities': info.get('capabilities') or [],
            'version': info.get('version') or '',
            'connectedAt': time.time(),
            'source': 'socket',
            'dispatchable': True,
        }
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

    @sio.on('task:error')
    async def task_error(sid, data):
        await handle_task_error(data if isinstance(data, dict) else {})

    @sio.on('ui:join')
    async def ui_join(sid, data):
        user_id = data.get("userId") if isinstance(data, dict) else None
        if user_id is None:
            return
        await sio.enter_room(sid, f"user_{user_id}")

    @sio.on('disconnect')
    async def disconnect(sid):
        if sid in agents:
            del agents[sid]
            await sio.emit('agent:list', list(agents.values()))

from api.sio import sio, agents

def register_socket_events():
    @sio.on('connect')
    async def connect(sid, environ):
        print('Client connected:', sid)

    @sio.on('agent:register')
    async def agent_register(sid, info):
        print('Agent registered:', info)
        agents[sid] = {**info, 'socketId': sid}
        await sio.emit('agent:list', list(agents.values()))

    @sio.on('flow:log')
    async def flow_log(sid, data):
        await sio.emit('flow:monitor', data)

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

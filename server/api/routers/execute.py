from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from api.sio import sio, agents

router = APIRouter()

class ExecuteRequest(BaseModel):
    agentId: str
    flowData: dict

@router.post("/execute")
async def execute_flow(req: ExecuteRequest):
    target_sid = None
    for sid, agent in agents.items():
        if agent.get("id") == req.agentId:
            target_sid = sid
            break
    
    if target_sid:
        await sio.emit('flow:run', req.flowData, to=target_sid)
        return {"success": True, "message": "Command sent"}
    else:
        raise HTTPException(status_code=404, detail="Agent not found")

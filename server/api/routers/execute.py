from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.sio import sio, agents
from api.agent_dispatch import dispatch_task_to_agent

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


class AgentDispatchRequest(BaseModel):
    agentId: str
    userId: int
    instruction: str = ""
    tool: str = ""
    args: dict = {}
    aiConfigId: Optional[int] = None
    aiKind: str = "assistant"
    sessionId: str = ""
    sessionName: Optional[str] = None


@router.post("/agent/dispatch")
async def dispatch_agent_task(req: AgentDispatchRequest):
    if not req.instruction and not req.tool:
        raise HTTPException(status_code=400, detail="Provide an instruction or a tool to run")
    result = await dispatch_task_to_agent(
        agent_id=req.agentId,
        user_id=req.userId,
        ai_config_id=req.aiConfigId,
        ai_kind=req.aiKind,
        session_id=req.sessionId,
        session_name=req.sessionName,
        model=None,
        instruction=req.instruction,
        tool=req.tool,
        args=req.args,
    )
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error") or "Dispatch failed")
    return result

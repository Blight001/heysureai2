from fastapi import APIRouter, Depends, Header
from sqlmodel import Session

from api.database import get_session
from api.routers.auth import get_current_user
from api.sio import agents, agent_token_required

router = APIRouter()
PREFIX = "/api/agents"


@router.get("/connected")
async def list_connected_agents(
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    # Auth-gate the view; the agent registry itself is process-global.
    get_current_user(authorization, session)
    return {
        "agents": list(agents.values()),
        "count": len(agents),
        "token_required": agent_token_required(),
    }

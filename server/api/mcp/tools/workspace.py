import subprocess
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from ...database import engine
from ...models import AIRuntimeStatus, AssistantAIConfig
from ...sio import agents, sio
from ..core import generate_file_tree, get_project_root


def _run_command(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    command = args.get("command")
    if not command:
        raise HTTPException(status_code=400, detail="Missing command")

    project_root = get_project_root(user_id, ai_config_id)
    result = subprocess.run(
        command,
        shell=True,
        cwd=project_root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    output = result.stdout
    if result.stderr:
        output += f"\nError:\n{result.stderr}"

    return {
        "command": command,
        "success": result.returncode == 0,
        "exit_code": result.returncode,
        "output": output,
    }

def _list_connected_socket_agents() -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for item in list(agents.values()):
        row = dict(item) if isinstance(item, dict) else {"value": item}
        row["source"] = "socket"
        row["dispatchable"] = True
        out.append(row)
    return out

def _list_managed_ai_agents(user_id: int) -> List[Dict[str, Any]]:
    with Session(engine) as session:
        cfgs = session.exec(
            select(AssistantAIConfig)
            .where(AssistantAIConfig.user_id == user_id)
            .order_by(AssistantAIConfig.sort_order.asc(), AssistantAIConfig.created_at.asc())
        ).all()
        statuses = session.exec(
            select(AIRuntimeStatus).where(
                AIRuntimeStatus.user_id == user_id,
                AIRuntimeStatus.ai_kind == "assistant",
            )
        ).all()
    status_map = {int(row.ai_config_id): row for row in statuses if row.ai_config_id is not None}
    out: List[Dict[str, Any]] = []
    for cfg in cfgs:
        status = status_map.get(int(cfg.id or 0))
        current_status = str(status.current_status or "").strip() if status else ""
        out.append(
            {
                "id": f"ai_config_{cfg.id}",
                "ai_config_id": cfg.id,
                "name": cfg.name,
                "ai_role": cfg.ai_role,
                "digital_member_role": cfg.digital_member_role,
                "enabled": bool(cfg.enabled),
                "mcp_enabled": bool(cfg.mcp_enabled),
                "runtime_status": current_status or ("idle" if cfg.enabled else "stopped"),
                "runtime_tool": str(status.current_mcp_tool or "").strip() if status else "",
                "source": "ai_config",
                "dispatchable": False,
            }
        )
    return out

def _list_agents(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    connected_agents = _list_connected_socket_agents()
    managed_agents = _list_managed_ai_agents(user_id)
    all_agents = connected_agents + managed_agents
    return {
        "agents": all_agents,
        "agent_count": len(all_agents),
        "connected_agents": connected_agents,
        "connected_agent_count": len(connected_agents),
        "managed_agents": managed_agents,
        "managed_agent_count": len(managed_agents),
        "note": "connected_agents are socket-registered and dispatchable; managed_agents are AI configs for visibility.",
    }

def _get_overview(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    project_root = get_project_root(user_id, ai_config_id)
    cfg_db_uri = None
    if ai_config_id:
        with Session(engine) as session:
            cfg = session.exec(
                select(AssistantAIConfig).where(
                    AssistantAIConfig.user_id == user_id,
                    AssistantAIConfig.id == ai_config_id,
                )
            ).first()
            if cfg:
                cfg_db_uri = cfg.database_uri
    connected_agents = _list_connected_socket_agents()
    managed_agents = _list_managed_ai_agents(user_id)
    all_agents = connected_agents + managed_agents
    return {
        "workspace_root": project_root,
        "workspace_tree": generate_file_tree(project_root),
        "database_uri": cfg_db_uri,
        "agent_count": len(all_agents),
        "agents": all_agents,
        "connected_agent_count": len(connected_agents),
        "managed_agent_count": len(managed_agents),
    }

async def _dispatch_flow(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    agent_id = args.get("agentId")
    flow_data = args.get("flowData")
    if not agent_id or not flow_data:
        raise HTTPException(status_code=400, detail="Missing agentId or flowData")

    target_sid = None
    for sid, agent in agents.items():
        if agent.get("id") == agent_id:
            target_sid = sid
            break

    if not target_sid:
        raise HTTPException(status_code=404, detail="Agent not found")

    await sio.emit("flow:run", flow_data, to=target_sid)
    return {"success": True, "agentId": agent_id, "message": "Flow dispatched"}

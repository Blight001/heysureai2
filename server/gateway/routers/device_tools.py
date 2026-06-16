"""Device dynamic MCP tools: CRUD for web-authored, device-type-scoped tools.

An operator manages dynamic MCP tools (``call`` / ``set`` / ``return`` JSON
programs) per device type (``desktop`` / ``browser``) from the web console. The
server validates them the same way the device interpreter does, stores them,
and pushes the enabled set to every online device of that type so a tool change
ships without a new client release.
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session

from api.database import get_session
from api.device_live import push_device_dynamic_tools
from api.device_presence import online_tool_catalog_for_user
from api.services import device_dynamic_tools as dyn
from .auth import get_current_user

router = APIRouter()
PREFIX = "/api/device-tools"


class DynamicToolUpsert(BaseModel):
    device_type: str = Field(..., description="desktop | browser")
    definition: Dict[str, Any] = Field(..., description="{name, description, input_schema, code}")
    enabled: bool = True


class DynamicToolToggle(BaseModel):
    device_type: str
    name: str
    enabled: bool


def _available_call_targets(user_id: int, device_type: str) -> List[Dict[str, str]]:
    """Tool names the visual editor can offer as ``call`` targets: every tool an
    online device of this type currently advertises (built-ins included), so the
    operator picks from what the device can actually run."""
    targets: Dict[str, str] = {}
    for device in online_tool_catalog_for_user(user_id):
        if str(device.get("device_type") or "") != device_type:
            continue
        for tool in device.get("tools") or []:
            name = str(tool.get("name") or "").strip()
            if name:
                targets.setdefault(name, str(tool.get("description") or "").strip())
    return [{"name": name, "description": targets[name]} for name in sorted(targets)]


@router.get("")
async def list_device_tools(
    device_type: str = Query(...),
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    try:
        dtype = dyn.normalize_device_type(device_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {
        "deviceType": dtype,
        "tools": dyn.list_tools(user.id, dtype),
        # Tools the operator can target in a ``call`` step (live device catalog).
        "availableTools": _available_call_targets(user.id, dtype),
    }


@router.post("")
async def upsert_device_tool(
    payload: DynamicToolUpsert,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    try:
        dtype = dyn.normalize_device_type(payload.device_type)
        tool = dyn.upsert_tool(user.id, dtype, payload.definition, enabled=payload.enabled)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    reached = await push_device_dynamic_tools(user.id, dtype)
    return {"tool": tool, "pushedToDevices": reached}


@router.post("/toggle")
async def toggle_device_tool(
    payload: DynamicToolToggle,
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    try:
        dtype = dyn.normalize_device_type(payload.device_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    tool = dyn.set_enabled(user.id, dtype, payload.name, payload.enabled)
    if tool is None:
        raise HTTPException(status_code=404, detail="Dynamic MCP tool not found")
    reached = await push_device_dynamic_tools(user.id, dtype)
    return {"tool": tool, "pushedToDevices": reached}


@router.delete("/{name}")
async def delete_device_tool(
    name: str,
    device_type: str = Query(...),
    session: Session = Depends(get_session),
    authorization: str = Header(None),
):
    user = get_current_user(authorization, session)
    try:
        dtype = dyn.normalize_device_type(device_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not dyn.delete_tool(user.id, dtype, name):
        raise HTTPException(status_code=404, detail="Dynamic MCP tool not found")
    reached = await push_device_dynamic_tools(user.id, dtype)
    return {"ok": True, "pushedToDevices": reached}

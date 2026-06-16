"""CRUD + validation for web-authored, device-type-scoped dynamic MCP tools.

The server is the source of truth for these tools; the validation here mirrors
the device-side interpreter (``device/<linux|windows>/src/executor/dynamic.ts``
and ``device/extension/src/lib/tools/dynamic.ts``) so a definition rejected on
the device can never be saved from the web, and vice versa. Keep the rules in
this module and the device ``validate()`` in lockstep.
"""

import hashlib
import json
import re
import time
from typing import Any, Dict, List, Optional

from sqlmodel import Session, select

from api.database import engine
from api.models import DeviceDynamicTool


# Mirrors NAME_RE in the device interpreters.
NAME_RE = re.compile(r"^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*$")
# Reserved manager tool names on the devices — a dynamic tool can never shadow
# the editor that loads it.
RESERVED_NAMES = {"mcp.manage_dynamic_tool", "browser_mcp.manage_dynamic_tool"}
VALID_DEVICE_TYPES = ("desktop", "browser")
MAX_CODE_INSTRUCTIONS = 32


def normalize_device_type(value: Any) -> str:
    dtype = str(value or "").strip().lower()
    if dtype not in VALID_DEVICE_TYPES:
        raise ValueError(f"device_type must be one of {VALID_DEVICE_TYPES}")
    return dtype


def _revision(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def validate_definition(raw: Any) -> Dict[str, Any]:
    """Validate and normalize a dynamic tool definition.

    Returns ``{name, description, input_schema, code}``. Raises ``ValueError``
    with a human-readable message on any problem (the router maps it to 400).
    """
    if not isinstance(raw, dict):
        raise ValueError("definition must be an object")
    name = str(raw.get("name") or "").strip()
    if not NAME_RE.match(name):
        raise ValueError(f"Invalid dynamic MCP name: {name or '(empty)'}")
    if name in RESERVED_NAMES:
        raise ValueError(f"{name} is reserved")
    description = str(raw.get("description") or "").strip()
    if not description:
        raise ValueError(f"Dynamic MCP {name} requires description")
    input_schema = raw.get("input_schema")
    if input_schema is None:
        input_schema = raw.get("inputSchema")
    if not isinstance(input_schema, dict):
        raise ValueError(f"Dynamic MCP {name} requires input_schema object")

    code = raw.get("code")
    if isinstance(code, str):
        try:
            code = json.loads(code)
        except Exception:
            raise ValueError(f"Dynamic MCP {name} code is not valid JSON")
    if not isinstance(code, list) or not code or len(code) > MAX_CODE_INSTRUCTIONS:
        raise ValueError(
            f"Dynamic MCP {name} code must contain 1-{MAX_CODE_INSTRUCTIONS} instructions"
        )
    normalized_code: List[Dict[str, Any]] = []
    for step in code:
        if not isinstance(step, dict) or step.get("op") not in ("call", "set", "return"):
            raise ValueError(f"Invalid instruction in {name}")
        op = step["op"]
        if op == "call" and not str(step.get("tool") or "").strip():
            raise ValueError(f"call instruction in {name} requires tool")
        if op == "set" and not str(step.get("name") or "").strip():
            raise ValueError(f"set instruction in {name} requires name")
        if op == "call" and str(step.get("tool") or "").strip() in RESERVED_NAMES:
            raise ValueError(f"Dynamic MCP code cannot invoke the management tool")
        normalized_code.append(step)

    return {
        "name": name,
        "description": description,
        "input_schema": input_schema,
        "code": normalized_code,
    }


def _serialize(row: DeviceDynamicTool) -> Dict[str, Any]:
    try:
        input_schema = json.loads(row.input_schema_json or "{}")
    except Exception:
        input_schema = {}
    try:
        code = json.loads(row.code_json or "[]")
    except Exception:
        code = []
    definition = {
        "name": row.name,
        "description": row.description,
        "input_schema": input_schema if isinstance(input_schema, dict) else {},
        "code": code if isinstance(code, list) else [],
    }
    return {
        **definition,
        "enabled": bool(row.enabled),
        "revision": _revision(definition),
        "updated_at": float(row.updated_at or 0),
    }


def list_tools(user_id: int, device_type: str) -> List[Dict[str, Any]]:
    dtype = normalize_device_type(device_type)
    with Session(engine) as session:
        rows = session.exec(
            select(DeviceDynamicTool)
            .where(
                DeviceDynamicTool.user_id == user_id,
                DeviceDynamicTool.device_type == dtype,
            )
            .order_by(DeviceDynamicTool.name)
        ).all()
        return [_serialize(row) for row in rows]


def get_tool(user_id: int, device_type: str, name: str) -> Optional[Dict[str, Any]]:
    dtype = normalize_device_type(device_type)
    with Session(engine) as session:
        row = session.exec(
            select(DeviceDynamicTool).where(
                DeviceDynamicTool.user_id == user_id,
                DeviceDynamicTool.device_type == dtype,
                DeviceDynamicTool.name == str(name or "").strip(),
            )
        ).first()
        return _serialize(row) if row else None


def upsert_tool(user_id: int, device_type: str, definition: Any, enabled: bool = True) -> Dict[str, Any]:
    dtype = normalize_device_type(device_type)
    clean = validate_definition(definition)
    now = time.time()
    with Session(engine) as session:
        row = session.exec(
            select(DeviceDynamicTool).where(
                DeviceDynamicTool.user_id == user_id,
                DeviceDynamicTool.device_type == dtype,
                DeviceDynamicTool.name == clean["name"],
            )
        ).first()
        if not row:
            row = DeviceDynamicTool(
                user_id=user_id, device_type=dtype, name=clean["name"], created_at=now
            )
            session.add(row)
        row.description = clean["description"]
        row.input_schema_json = json.dumps(clean["input_schema"], ensure_ascii=False)
        row.code_json = json.dumps(clean["code"], ensure_ascii=False)
        row.enabled = bool(enabled)
        row.updated_at = now
        session.commit()
        session.refresh(row)
        return _serialize(row)


def set_enabled(user_id: int, device_type: str, name: str, enabled: bool) -> Optional[Dict[str, Any]]:
    dtype = normalize_device_type(device_type)
    with Session(engine) as session:
        row = session.exec(
            select(DeviceDynamicTool).where(
                DeviceDynamicTool.user_id == user_id,
                DeviceDynamicTool.device_type == dtype,
                DeviceDynamicTool.name == str(name or "").strip(),
            )
        ).first()
        if not row:
            return None
        row.enabled = bool(enabled)
        row.updated_at = time.time()
        session.commit()
        session.refresh(row)
        return _serialize(row)


def delete_tool(user_id: int, device_type: str, name: str) -> bool:
    dtype = normalize_device_type(device_type)
    with Session(engine) as session:
        row = session.exec(
            select(DeviceDynamicTool).where(
                DeviceDynamicTool.user_id == user_id,
                DeviceDynamicTool.device_type == dtype,
                DeviceDynamicTool.name == str(name or "").strip(),
            )
        ).first()
        if not row:
            return False
        session.delete(row)
        session.commit()
        return True


def _passthrough_code(name: str) -> List[Dict[str, Any]]:
    """A dynamic program that simply forwards to the device's native primitive.

    Seeded built-ins start as a transparent wrapper around ``builtin:<name>`` so
    behavior is unchanged until an operator edits the definition on the web.
    """
    return [
        {"op": "call", "tool": f"builtin:{name}", "args": "${args}", "save_as": "result"},
        {"op": "return", "value": "${vars.result}"},
    ]


def seed_from_tool_defs(user_id: int, device_type: str, tool_defs: Any) -> int:
    """Seed missing built-in tools into the DB as editable pass-through wrappers.

    Called when a device registers: the device reports its hardcoded catalog in
    ``toolDefs``; we mirror each native primitive into ``DeviceDynamicTool`` once
    (idempotent by name) so the whole tool surface becomes web-editable while the
    native implementation keeps running on the device via ``builtin:<name>``.

    Only genuine built-ins are seeded — tools the device already reports as
    ``dynamic`` (locally- or server-authored) and reserved manager tools are
    skipped, so we never wrap a wrapper. Returns how many rows were created.
    """
    dtype = normalize_device_type(device_type)
    if not isinstance(tool_defs, dict) or not tool_defs:
        return 0
    now = time.time()
    created = 0
    with Session(engine) as session:
        existing = {
            row.name
            for row in session.exec(
                select(DeviceDynamicTool).where(
                    DeviceDynamicTool.user_id == user_id,
                    DeviceDynamicTool.device_type == dtype,
                )
            ).all()
        }
        for name, spec in tool_defs.items():
            tool_name = str(name or "").strip()
            if not tool_name or tool_name in existing or tool_name in RESERVED_NAMES:
                continue
            if not NAME_RE.match(tool_name):
                continue
            if not isinstance(spec, dict):
                continue
            impl = spec.get("implementation") if isinstance(spec.get("implementation"), dict) else {}
            # Skip tools that are already dynamic (local AI-authored or a server
            # tool echoed back) — only native built-ins get seeded.
            if str(impl.get("kind") or "") == "dynamic":
                continue
            schema = spec.get("input_schema")
            if not isinstance(schema, dict):
                schema = {"type": "object", "properties": {}, "additionalProperties": True}
            row = DeviceDynamicTool(
                user_id=user_id,
                device_type=dtype,
                name=tool_name,
                description=str(spec.get("description") or "").strip() or f"设备原生工具 {tool_name}",
                input_schema_json=json.dumps(schema, ensure_ascii=False),
                code_json=json.dumps(_passthrough_code(tool_name), ensure_ascii=False),
                enabled=True,
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            existing.add(tool_name)
            created += 1
        if created:
            session.commit()
    return created


def device_payload(user_id: int, device_type: str) -> Dict[str, Any]:
    """The ``device:tool-config`` payload shipped to a device of this type.

    Only enabled tools are shipped, in the exact shape the device interpreter
    expects (``{version, tools:[{name, description, input_schema, code}]}``).
    A stable ``revision`` lets the device skip re-applying an unchanged set and
    so avoids a register/push feedback loop.
    """
    tools = [
        {
            "name": tool["name"],
            "description": tool["description"],
            "input_schema": tool["input_schema"],
            "code": tool["code"],
        }
        for tool in list_tools(user_id, device_type)
        if tool.get("enabled")
    ]
    return {
        "version": 1,
        "deviceType": normalize_device_type(device_type),
        "tools": tools,
        "revision": _revision(tools),
    }

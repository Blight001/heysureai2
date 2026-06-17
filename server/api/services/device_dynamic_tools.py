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
from api.models import DeviceDynamicTool, DeviceDynamicToolVersion

# Keep at most this many version snapshots per (user, device_type, name).
MAX_VERSIONS_PER_TOOL = 50


# Mirrors NAME_RE in the device interpreters.
NAME_RE = re.compile(r"^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*$")
# Reserved manager tool names on the devices — a dynamic tool can never shadow
# the editor that loads it.
RESERVED_NAMES = {"mcp.manage_dynamic_tool", "browser_mcp.manage_dynamic_tool"}
VALID_DEVICE_TYPES = ("desktop", "browser")
MAX_CODE_INSTRUCTIONS = 32
# Runtimes the device executors support (runtime/runtime-tool.ts). Keep in
# lockstep with ``isToolRuntime`` on the device.
VALID_RUNTIMES = ("python", "powershell", "shell")
MAX_SOURCE = 64 * 1024


def normalize_device_type(value: Any) -> str:
    dtype = str(value or "").strip().lower()
    if dtype not in VALID_DEVICE_TYPES:
        raise ValueError(f"device_type must be one of {VALID_DEVICE_TYPES}")
    return dtype


def _revision(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


MAX_JS_SOURCE = 64 * 1024


def validate_definition(raw: Any) -> Dict[str, Any]:
    """Validate and normalize a dynamic tool definition.

    Returns ``{name, description, input_schema, code_kind, code, js}``. ``code_kind``
    is ``"js"`` (desktop: a JS function body run with ``(args, cap, ctx)``) or
    ``"program"`` (browser: a call/set/return DSL). Raises ``ValueError`` with a
    human-readable message on any problem (the router maps it to 400).
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

    runtime = str(raw.get("runtime") or "").strip().lower()
    code_kind = str(raw.get("code_kind") or raw.get("codeKind") or "").strip().lower()
    if not code_kind:
        # Infer: a runtime tag means a runtime tool, a non-empty ``js`` means a
        # JS tool, otherwise a program.
        code_kind = "runtime" if runtime else ("js" if str(raw.get("js") or "").strip() else "program")
    if code_kind not in ("js", "program", "runtime"):
        raise ValueError(f"Dynamic MCP {name} code_kind must be 'js', 'program' or 'runtime'")

    if code_kind == "runtime":
        if runtime not in VALID_RUNTIMES:
            raise ValueError(f"Dynamic MCP {name} runtime must be one of {VALID_RUNTIMES}")
        # The runtime body may arrive as ``source`` (preferred) or ``code`` (the
        # device accepts a string ``code`` for runtime tools too).
        source = raw.get("source")
        if not isinstance(source, str) or not source.strip():
            code_field = raw.get("code")
            source = code_field if isinstance(code_field, str) else ""
        if not isinstance(source, str) or not source.strip():
            raise ValueError(f"Dynamic MCP {name} requires non-empty source")
        if len(source) > MAX_SOURCE:
            raise ValueError(f"Dynamic MCP {name} source is too large")
        raw_permissions = raw.get("permissions")
        permissions = [
            str(p).strip()
            for p in (raw_permissions if isinstance(raw_permissions, list) else [])
            if str(p).strip()
        ]
        return {
            "name": name,
            "description": description,
            "input_schema": input_schema,
            "code_kind": "runtime",
            "code": [],
            "js": "",
            "runtime": runtime,
            "source": source,
            "permissions": permissions,
        }

    if code_kind == "js":
        js = raw.get("js")
        if not isinstance(js, str) or not js.strip():
            raise ValueError(f"Dynamic MCP {name} requires non-empty js")
        if len(js) > MAX_JS_SOURCE:
            raise ValueError(f"Dynamic MCP {name} js is too large")
        return {
            "name": name,
            "description": description,
            "input_schema": input_schema,
            "code_kind": "js",
            "code": [],
            "js": js,
            "runtime": "",
            "source": "",
            "permissions": [],
        }

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
        "code_kind": "program",
        "code": normalized_code,
        "js": "",
        "runtime": "",
        "source": "",
        "permissions": [],
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
    try:
        permissions = json.loads(getattr(row, "permissions_json", "") or "[]")
    except Exception:
        permissions = []
    code_kind = str(getattr(row, "code_kind", "") or "program")
    definition = {
        "name": row.name,
        "description": row.description,
        "input_schema": input_schema if isinstance(input_schema, dict) else {},
        "code_kind": code_kind,
        "code": code if isinstance(code, list) else [],
        "js": str(getattr(row, "js_source", "") or ""),
        "runtime": str(getattr(row, "runtime", "") or ""),
        "source": str(getattr(row, "source", "") or ""),
        "permissions": permissions if isinstance(permissions, list) else [],
    }
    return {
        **definition,
        "enabled": bool(row.enabled),
        "revision": _revision(definition),
        "updated_at": float(row.updated_at or 0),
    }


def _record_version(
    session: Session,
    *,
    user_id: int,
    device_type: str,
    row: DeviceDynamicTool,
    action: str,
    actor: str,
    ai_config_id: Optional[int],
) -> None:
    """Append a snapshot of ``row`` and prune the oldest beyond the cap.

    Must be called inside ``session`` after the row's fields are set so the
    snapshot matches what was persisted."""
    definition = {
        "name": row.name,
        "description": row.description,
        "input_schema": json.loads(row.input_schema_json or "{}"),
        "code_kind": row.code_kind,
        "code": json.loads(row.code_json or "[]"),
        "js": row.js_source or "",
        "runtime": getattr(row, "runtime", "") or "",
        "source": getattr(row, "source", "") or "",
        "permissions": json.loads(getattr(row, "permissions_json", "") or "[]"),
    }
    session.add(DeviceDynamicToolVersion(
        user_id=user_id,
        device_type=device_type,
        name=row.name,
        revision=_revision(definition),
        action=action,
        actor=actor if actor in ("web", "ai") else "web",
        ai_config_id=ai_config_id,
        description=row.description,
        input_schema_json=row.input_schema_json,
        code_kind=row.code_kind,
        code_json=row.code_json,
        js_source=row.js_source or "",
        runtime=getattr(row, "runtime", "") or "",
        source=getattr(row, "source", "") or "",
        permissions_json=getattr(row, "permissions_json", "") or "[]",
        created_at=time.time(),
    ))
    # Prune oldest snapshots beyond the cap for this tool.
    history = session.exec(
        select(DeviceDynamicToolVersion)
        .where(
            DeviceDynamicToolVersion.user_id == user_id,
            DeviceDynamicToolVersion.device_type == device_type,
            DeviceDynamicToolVersion.name == row.name,
        )
        .order_by(DeviceDynamicToolVersion.created_at.desc(), DeviceDynamicToolVersion.id.desc())
    ).all()
    for stale in history[MAX_VERSIONS_PER_TOOL:]:
        session.delete(stale)


def _serialize_version(row: DeviceDynamicToolVersion, *, full: bool = False) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "version_id": row.id,
        "name": row.name,
        "revision": row.revision,
        "action": row.action,
        "actor": row.actor,
        "ai_config_id": row.ai_config_id,
        "description": row.description,
        "code_kind": row.code_kind,
        "created_at": float(row.created_at or 0),
    }
    if full:
        try:
            out["input_schema"] = json.loads(row.input_schema_json or "{}")
        except Exception:
            out["input_schema"] = {}
        try:
            out["code"] = json.loads(row.code_json or "[]")
        except Exception:
            out["code"] = []
        out["js"] = row.js_source or ""
        out["runtime"] = getattr(row, "runtime", "") or ""
        out["source"] = getattr(row, "source", "") or ""
        try:
            out["permissions"] = json.loads(getattr(row, "permissions_json", "") or "[]")
        except Exception:
            out["permissions"] = []
    return out


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


def upsert_tool(
    user_id: int,
    device_type: str,
    definition: Any,
    enabled: bool = True,
    actor: str = "web",
    ai_config_id: Optional[int] = None,
    action: str = "upsert",
) -> Dict[str, Any]:
    dtype = normalize_device_type(device_type)
    clean = validate_definition(definition)
    # Runtime tools (python/powershell/shell) only run on desktop shells; the
    # browser extension has no such runner and would reject the whole config.
    if clean["code_kind"] == "runtime" and dtype != "desktop":
        raise ValueError("runtime tools are only supported on desktop devices")
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
        row.code_kind = clean["code_kind"]
        row.code_json = json.dumps(clean["code"], ensure_ascii=False)
        row.js_source = clean.get("js") or ""
        row.runtime = clean.get("runtime") or ""
        row.source = clean.get("source") or ""
        row.permissions_json = json.dumps(clean.get("permissions") or [], ensure_ascii=False)
        row.enabled = bool(enabled)
        row.updated_at = now
        _record_version(
            session, user_id=user_id, device_type=dtype, row=row,
            action=action, actor=actor, ai_config_id=ai_config_id,
        )
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


def delete_tool(
    user_id: int,
    device_type: str,
    name: str,
    actor: str = "web",
    ai_config_id: Optional[int] = None,
) -> bool:
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
        # Snapshot the final state as a delete marker so it can still be
        # restored after deletion.
        _record_version(
            session, user_id=user_id, device_type=dtype, row=row,
            action="delete", actor=actor, ai_config_id=ai_config_id,
        )
        session.delete(row)
        session.commit()
        return True


def list_versions(user_id: int, device_type: str, name: str, limit: int = MAX_VERSIONS_PER_TOOL) -> List[Dict[str, Any]]:
    dtype = normalize_device_type(device_type)
    with Session(engine) as session:
        rows = session.exec(
            select(DeviceDynamicToolVersion)
            .where(
                DeviceDynamicToolVersion.user_id == user_id,
                DeviceDynamicToolVersion.device_type == dtype,
                DeviceDynamicToolVersion.name == str(name or "").strip(),
            )
            .order_by(DeviceDynamicToolVersion.created_at.desc(), DeviceDynamicToolVersion.id.desc())
            .limit(max(1, min(int(limit or 1), MAX_VERSIONS_PER_TOOL)))
        ).all()
        return [_serialize_version(row) for row in rows]


def get_version(user_id: int, device_type: str, version_id: int) -> Optional[Dict[str, Any]]:
    dtype = normalize_device_type(device_type)
    with Session(engine) as session:
        row = session.get(DeviceDynamicToolVersion, int(version_id))
        if not row or row.user_id != user_id or row.device_type != dtype:
            return None
        return _serialize_version(row, full=True)


def restore_version(
    user_id: int,
    device_type: str,
    version_id: int,
    actor: str = "web",
    ai_config_id: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """Re-create a tool from a historical snapshot. Records a new 'restore'
    version. Returns the restored tool, or None if the snapshot is missing."""
    snapshot = get_version(user_id, device_type, version_id)
    if not snapshot:
        return None
    definition = {
        "name": snapshot["name"],
        "description": snapshot["description"],
        "input_schema": snapshot.get("input_schema") or {},
        "code_kind": snapshot.get("code_kind") or "program",
        "code": snapshot.get("code") or [],
        "js": snapshot.get("js") or "",
        "runtime": snapshot.get("runtime") or "",
        "source": snapshot.get("source") or "",
        "permissions": snapshot.get("permissions") or [],
    }
    return upsert_tool(
        user_id, device_type, definition,
        actor=actor, ai_config_id=ai_config_id, action="restore",
    )


def _passthrough_code(name: str) -> List[Dict[str, Any]]:
    """A dynamic program that simply forwards to the device's native primitive.

    Seeded built-ins start as a transparent wrapper around ``builtin:<name>`` so
    behavior is unchanged until an operator edits the definition on the web.
    """
    return [
        {"op": "call", "tool": f"builtin:{name}", "args": "${args}", "save_as": "result"},
        {"op": "return", "value": "${vars.result}"},
    ]


def _passthrough_js(name: str) -> str:
    """Initial JS for a seeded desktop tool: forward to the native capability.

    The desktop runtime injects ``cap`` (the device's native capability library)
    and runs this body with ``(args, cap, ctx)``. Operators then edit the JS on
    the web to change behavior — the whole implementation lives on the server.
    """
    return f"return await cap.call({json.dumps(name)}, args)"


def seed_from_tool_defs(user_id: int, device_type: str, tool_defs: Any) -> int:
    """Seed missing built-in tools into the DB as editable definitions.

    Called when a device registers: the device reports its native capability
    catalog in ``toolDefs``; we mirror each one into ``DeviceDynamicTool`` once
    (idempotent by name) so the whole tool surface becomes web-editable. Desktop
    tools are seeded as JS (``cap.call(<name>, args)``) so the implementation
    lives on the server; browser tools are seeded as a pass-through program
    (MV3 forbids running server JS in the extension).

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
            is_js = dtype == "desktop"
            row = DeviceDynamicTool(
                user_id=user_id,
                device_type=dtype,
                name=tool_name,
                description=str(spec.get("description") or "").strip() or f"设备原生工具 {tool_name}",
                input_schema_json=json.dumps(schema, ensure_ascii=False),
                code_kind="js" if is_js else "program",
                code_json=json.dumps([] if is_js else _passthrough_code(tool_name), ensure_ascii=False),
                js_source=_passthrough_js(tool_name) if is_js else "",
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
            "code_kind": tool.get("code_kind") or "program",
            "code": tool["code"],
            "js": tool.get("js") or "",
            "runtime": tool.get("runtime") or "",
            "source": tool.get("source") or "",
            "permissions": tool.get("permissions") or [],
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

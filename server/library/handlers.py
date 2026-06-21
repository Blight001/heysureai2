# -*- coding: utf-8 -*-
"""Handlers exposed by the built-in knowledge library (工坊)."""

from typing import Any, Dict, Optional

from fastapi import HTTPException

from api.services import librarian_service


def list_inheritance_thoughts(
    user_id: int,
    args: Dict[str, Any],
    ai_config_id: Optional[int] = None,
) -> Dict[str, Any]:
    _ = args, ai_config_id
    return librarian_service.list_inheritance_thoughts(user_id=int(user_id))


def get_inheritance_thought(
    user_id: int,
    args: Dict[str, Any],
    ai_config_id: Optional[int] = None,
) -> Dict[str, Any]:
    _ = ai_config_id
    thought_id = str(args.get("id") or "").strip()
    if not thought_id:
        raise HTTPException(status_code=400, detail="id is required")
    try:
        return librarian_service.read_inheritance_thought(
            user_id=int(user_id),
            thought_id=thought_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def install_skill_package(
    user_id: int,
    args: Dict[str, Any],
    ai_config_id: Optional[int] = None,
) -> Dict[str, Any]:
    package = str(args.get("package") or "").strip()
    if not package:
        raise HTTPException(status_code=400, detail="package is required")
    endpoint_kind = args.get("endpoint_kind")
    try:
        return librarian_service.install_npx_skill_package(
            user_id=int(user_id),
            package=package,
            timeout=args.get("timeout"),
            endpoint_kind=str(endpoint_kind) if endpoint_kind else None,
            ai_config_id=int(ai_config_id) if ai_config_id else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def create_inheritance_thought(
    user_id: int,
    args: Dict[str, Any],
    ai_config_id: Optional[int] = None,
) -> Dict[str, Any]:
    name = str(args.get("name") or args.get("title") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    content = str(args.get("content") or args.get("text") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="content is required")
    endpoint_kind = args.get("endpoint_kind")
    summary = args.get("summary")
    try:
        return librarian_service.create_inheritance_thought(
            user_id=int(user_id),
            name=name,
            content=content,
            summary=str(summary) if summary else None,
            endpoint_kind=str(endpoint_kind) if endpoint_kind else None,
            ai_config_id=int(ai_config_id) if ai_config_id else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def edit_inheritance_thought(
    user_id: int,
    args: Dict[str, Any],
    ai_config_id: Optional[int] = None,
) -> Dict[str, Any]:
    _ = ai_config_id
    thought_id = str(args.get("id") or "").strip()
    if not thought_id:
        raise HTTPException(status_code=400, detail="id is required")
    try:
        return librarian_service.edit_inheritance_thought(
            user_id=int(user_id),
            thought_id=thought_id,
            arguments=args,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def delete_inheritance_thought(
    user_id: int,
    args: Dict[str, Any],
    ai_config_id: Optional[int] = None,
) -> Dict[str, Any]:
    _ = ai_config_id
    thought_id = str(args.get("id") or "").strip()
    if not thought_id:
        raise HTTPException(status_code=400, detail="id is required")
    try:
        return librarian_service.delete_inheritance_thought(
            user_id=int(user_id),
            thought_id=thought_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def read_inheritance_skills(
    user_id: int,
    args: Dict[str, Any],
    ai_config_id: Optional[int] = None,
) -> Dict[str, Any]:
    _ = args, ai_config_id
    return librarian_service.read(
        user_id=int(user_id),
        memory_id="builtin.inheritance_skills",
    )


def read_intrinsic_skills(
    user_id: int,
    args: Dict[str, Any],
    ai_config_id: Optional[int] = None,
) -> Dict[str, Any]:
    _ = args, ai_config_id
    # 纯服务端固定 MCP（按 namespace 分组），与 update_intrinsic_skills 写路径同源；
    # 在线设备工具请用 read_inheritance_skills。
    return librarian_service.read(
        user_id=int(user_id),
        memory_id="builtin.intrinsic_properties",
    )


def update_intrinsic_skills(
    user_id: int,
    args: Dict[str, Any],
    ai_config_id: Optional[int] = None,
) -> Dict[str, Any]:
    _ = ai_config_id
    tools = args.get("tools")
    if not isinstance(tools, list) or not tools:
        raise HTTPException(status_code=400, detail="tools (non-empty list) is required")
    try:
        librarian_service.save_intrinsic_properties_overrides(
            user_id=int(user_id),
            tools=tools,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # 回读纯服务端 MCP 视图，保证读/写出口形状一致。
    return librarian_service.read(
        user_id=int(user_id),
        memory_id="builtin.intrinsic_properties",
    )


def read_intrinsic_personas(
    user_id: int,
    args: Dict[str, Any],
    ai_config_id: Optional[int] = None,
) -> Dict[str, Any]:
    _ = args, ai_config_id
    return librarian_service.read(
        user_id=int(user_id),
        memory_id="builtin.intrinsic_personas",
    )


def update_intrinsic_persona(
    user_id: int,
    args: Dict[str, Any],
    ai_config_id: Optional[int] = None,
) -> Dict[str, Any]:
    _ = ai_config_id
    try:
        target_id = int(args.get("ai_config_id") or 0)
    except (TypeError, ValueError):
        target_id = 0
    if target_id <= 0:
        raise HTTPException(status_code=400, detail="ai_config_id is required")
    prompt = args.get("prompt")
    if prompt is None:
        raise HTTPException(status_code=400, detail="prompt is required")
    try:
        return librarian_service.save_intrinsic_persona(
            user_id=int(user_id),
            ai_config_id=target_id,
            prompt=str(prompt),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def read_system_prompts(
    user_id: int,
    args: Dict[str, Any],
    ai_config_id: Optional[int] = None,
) -> Dict[str, Any]:
    _ = args, ai_config_id
    return librarian_service.read(
        user_id=int(user_id),
        memory_id="builtin.system_prompts",
    )


def update_system_prompts(
    user_id: int,
    args: Dict[str, Any],
    ai_config_id: Optional[int] = None,
) -> Dict[str, Any]:
    _ = ai_config_id
    prompts = args.get("prompts")
    if not isinstance(prompts, list) or not prompts:
        raise HTTPException(status_code=400, detail="prompts (non-empty list) is required")
    try:
        return librarian_service.save_system_prompts(
            user_id=int(user_id),
            prompts=prompts,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

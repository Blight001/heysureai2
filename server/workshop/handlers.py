# -*- coding: utf-8 -*-
"""Handlers exposed by the built-in knowledge workshop."""

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


def set_inheritance_thought_endpoint(
    user_id: int,
    args: Dict[str, Any],
    ai_config_id: Optional[int] = None,
) -> Dict[str, Any]:
    _ = ai_config_id
    thought_id = str(args.get("id") or "").strip()
    if not thought_id:
        raise HTTPException(status_code=400, detail="id is required")
    endpoint_kind = str(args.get("endpoint_kind") or "").strip()
    if not endpoint_kind:
        raise HTTPException(status_code=400, detail="endpoint_kind is required")
    try:
        return librarian_service.set_inheritance_thought_endpoint(
            user_id=int(user_id),
            slug=thought_id,
            endpoint_kind=endpoint_kind,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


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
        return librarian_service.save_intrinsic_properties_overrides(
            user_id=int(user_id),
            tools=tools,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
    auto_prompts = args.get("auto_prompts")
    if auto_prompts is not None and not isinstance(auto_prompts, dict):
        raise HTTPException(status_code=400, detail="auto_prompts must be an object")
    if prompt is None and not auto_prompts:
        raise HTTPException(status_code=400, detail="prompt or auto_prompts is required")
    try:
        return librarian_service.save_intrinsic_persona(
            user_id=int(user_id),
            ai_config_id=target_id,
            prompt=str(prompt) if prompt is not None else None,
            auto_prompts=auto_prompts if isinstance(auto_prompts, dict) else None,
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

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
    _ = ai_config_id
    package = str(args.get("package") or "").strip()
    if not package:
        raise HTTPException(status_code=400, detail="package is required")
    try:
        return librarian_service.install_npx_skill_package(
            user_id=int(user_id),
            package=package,
            timeout=args.get("timeout"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

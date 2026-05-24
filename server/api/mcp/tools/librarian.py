"""MCP tools for the Librarian (图书管理员) — KnowledgeBase facade."""

from typing import Any, Dict, Optional

from fastapi import HTTPException

from . import librarian_service


def _ensure_librarian_only(user_id: int, ai_config_id: Optional[int]) -> None:
    """限制只有 librarian 角色可调（写/审批/合并/归档类工具）。

    咨询/读取/列表类工具不限制，任何 digital_member 都可调。
    """
    librarian_id = librarian_service.get_librarian_config_id(user_id)
    if librarian_id is None:
        raise HTTPException(
            status_code=503,
            detail="No librarian (图书管理员) configured for this user. "
                   "Mark one digital_member as is_librarian=true via AI config first.",
        )
    if ai_config_id is None or int(ai_config_id) != int(librarian_id):
        raise HTTPException(
            status_code=403,
            detail="This tool is restricted to the librarian AI config.",
        )


# ---------- 沉淀申请（任何 digital_member 可调） ----------

def _librarian_propose(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    title = str(args.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required for librarian.propose")
    scenario = str(args.get("scenario") or "").strip()
    steps = args.get("steps") or []
    if not isinstance(steps, list) or not steps:
        raise HTTPException(status_code=400, detail="steps must be a non-empty list of strings")
    steps_norm = [str(s).strip() for s in steps if str(s).strip()]
    if not steps_norm:
        raise HTTPException(status_code=400, detail="steps cannot be empty")
    gotchas_raw = args.get("gotchas") or []
    if gotchas_raw and not isinstance(gotchas_raw, list):
        raise HTTPException(status_code=400, detail="gotchas must be a list")
    triggers = args.get("triggers")
    scope = str(args.get("scope") or "global").strip().lower()
    scope_target = args.get("scope_target")
    if scope_target is not None:
        scope_target = str(scope_target).strip() or None
    evidence = args.get("evidence")
    source = {"ai_config_id": ai_config_id}
    if isinstance(evidence, dict):
        if evidence.get("job_id"):
            source["job_id"] = str(evidence.get("job_id"))
        if evidence.get("generation"):
            try:
                source["generation"] = int(evidence.get("generation"))
            except Exception:
                pass
        if evidence.get("message_id"):
            try:
                source["message_id"] = int(evidence.get("message_id"))
            except Exception:
                pass
    try:
        entry = librarian_service.propose(
            user_id=user_id,
            ai_config_id=ai_config_id,
            title=title,
            scenario=scenario,
            steps=steps_norm,
            gotchas=[str(g).strip() for g in (gotchas_raw or []) if str(g).strip()],
            triggers=triggers,
            scope=scope,
            scope_target=scope_target,
            source=source,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {
        "proposed": True,
        "memory_id": entry["memory_id"],
        "status": entry["status"],
        "title": entry["title"],
        "note": "条目已进入待审批队列，需用户在前端确认后才会被检索到。",
    }


# ---------- 咨询/列表/读取（任何 digital_member 可调） ----------

def _librarian_consult(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    query = str(args.get("query") or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query is required for librarian.consult")
    k = int(args.get("k") or 5)
    scope = args.get("scope")
    if scope is not None:
        scope = str(scope).strip().lower()
    results = librarian_service.consult(
        user_id=user_id,
        query=query,
        scope=scope,
        ai_config_id=ai_config_id,
        k=k,
    )
    return {"query": query, "count": len(results), "results": results}


def _librarian_list_topics(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    scope = args.get("scope")
    if scope is not None:
        scope = str(scope).strip().lower()
    status = args.get("status")
    if status is not None:
        status = str(status).strip().lower()
    try:
        items = librarian_service.list_topics(user_id=user_id, scope=scope, status=status)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    # 渐进披露：默认不返 body
    return {"count": len(items), "items": items}


def _librarian_read(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    memory_id = str(args.get("memory_id") or "").strip()
    if not memory_id:
        raise HTTPException(status_code=400, detail="memory_id is required for librarian.read")
    try:
        return librarian_service.read(user_id=user_id, memory_id=memory_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# ---------- 归档（仅 librarian） ----------

def _librarian_archive(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    _ensure_librarian_only(user_id, ai_config_id)
    memory_id = str(args.get("memory_id") or "").strip()
    if not memory_id:
        raise HTTPException(status_code=400, detail="memory_id is required for librarian.archive")
    try:
        return librarian_service.archive(user_id=user_id, memory_id=memory_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

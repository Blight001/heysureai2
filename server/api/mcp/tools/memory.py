"""MCP tools for structured Memory and Evolution Input (Phase 3).

Memory = retrievable facts/lessons an AI can search next time.
EvolutionInput = proposals to improve the AI system itself (prompts, tool
rules, workflows), reviewed and applied by a core manager.
"""

import json
import time
import uuid
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from ...database import engine
from ...models import EvolutionInput, Memory

_MEMORY_KINDS = {"fact", "decision", "lesson", "todo", "risk", "template"}
_EVOLUTION_TYPES = {
    "prompt_rule",
    "tool_rule",
    "workflow_rule",
    "memory",
    "failure_case",
    "success_case",
}
_REVIEW_STATUSES = {"queued", "accepted", "rejected", "applied"}


def _normalize_tags(value: Any) -> str:
    if isinstance(value, list):
        items = [str(item).strip() for item in value if str(item).strip()]
    elif isinstance(value, str):
        items = [piece.strip() for piece in value.split(",") if piece.strip()]
    else:
        items = []
    # de-dup, preserve order
    seen = set()
    out = []
    for item in items:
        if item.lower() in seen:
            continue
        seen.add(item.lower())
        out.append(item)
    return ",".join(out)


def _tags_list(raw: str) -> List[str]:
    return [piece.strip() for piece in str(raw or "").split(",") if piece.strip()]


def _memory_to_dict(row: Memory) -> Dict[str, Any]:
    try:
        source = json.loads(row.source or "{}")
    except Exception:
        source = {}
    return {
        "memory_id": row.memory_id,
        "ai_config_id": row.ai_config_id,
        "project_id": row.project_id,
        "job_id": row.job_id,
        "generation": row.generation,
        "kind": row.kind,
        "tags": _tags_list(row.tags),
        "content": row.content,
        "source": source,
        "confidence": row.confidence,
        "archived": bool(row.archived),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _memory_write(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    content = str(args.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="content is required for memory.write")
    kind = str(args.get("kind") or "fact").strip().lower()
    if kind not in _MEMORY_KINDS:
        raise HTTPException(status_code=400, detail=f"kind must be one of {sorted(_MEMORY_KINDS)}")
    try:
        confidence = float(args.get("confidence", 0.6))
    except Exception:
        confidence = 0.6
    confidence = max(0.0, min(1.0, confidence))
    try:
        generation = int(args.get("generation", 1))
    except Exception:
        generation = 1
    source = args.get("source")
    source_json = json.dumps(source, ensure_ascii=False) if isinstance(source, dict) else "{}"

    with Session(engine) as session:
        row = Memory(
            memory_id=f"mem_{uuid.uuid4().hex[:12]}",
            user_id=user_id,
            ai_config_id=ai_config_id,
            project_id=str(args.get("project_id") or "").strip() or None,
            job_id=str(args.get("job_id") or "").strip() or None,
            generation=max(1, generation),
            kind=kind,
            tags=_normalize_tags(args.get("tags")),
            content=content,
            source=source_json,
            confidence=confidence,
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return {"written": True, "memory": _memory_to_dict(row)}


def _memory_search(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    query = str(args.get("query") or args.get("q") or "").strip().lower()
    kind = str(args.get("kind") or "").strip().lower()
    project_id = str(args.get("project_id") or "").strip()
    tag_filter = _tags_list(_normalize_tags(args.get("tags")))
    try:
        limit = int(args.get("limit", 20))
    except Exception:
        limit = 20
    limit = max(1, min(100, limit))
    include_archived = bool(args.get("include_archived", False))

    with Session(engine) as session:
        stmt = select(Memory).where(Memory.user_id == user_id)
        if not include_archived:
            stmt = stmt.where(Memory.archived == False)  # noqa: E712
        if kind:
            stmt = stmt.where(Memory.kind == kind)
        if project_id:
            stmt = stmt.where(Memory.project_id == project_id)
        rows = session.exec(stmt.order_by(Memory.created_at.desc())).all()

    results = []
    for row in rows:
        haystack = f"{row.content}\n{row.tags}".lower()
        if query and query not in haystack:
            continue
        if tag_filter:
            row_tags = {t.lower() for t in _tags_list(row.tags)}
            if not any(t.lower() in row_tags for t in tag_filter):
                continue
        results.append(_memory_to_dict(row))
        if len(results) >= limit:
            break
    return {"count": len(results), "memories": results}


def _memory_list(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    args = dict(args or {})
    args.pop("query", None)
    args.pop("q", None)
    return _memory_search(user_id, args, ai_config_id)


def _get_owned_memory(session: Session, user_id: int, memory_id: str) -> Memory:
    row = session.exec(
        select(Memory).where(Memory.user_id == user_id, Memory.memory_id == memory_id)
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Memory not found")
    return row


def _memory_update(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    memory_id = str(args.get("memory_id") or "").strip()
    if not memory_id:
        raise HTTPException(status_code=400, detail="memory_id is required for memory.update")
    with Session(engine) as session:
        row = _get_owned_memory(session, user_id, memory_id)
        if "content" in args and args.get("content") is not None:
            row.content = str(args.get("content"))
        if "tags" in args:
            row.tags = _normalize_tags(args.get("tags"))
        if "kind" in args and args.get("kind"):
            kind = str(args.get("kind")).strip().lower()
            if kind not in _MEMORY_KINDS:
                raise HTTPException(status_code=400, detail=f"kind must be one of {sorted(_MEMORY_KINDS)}")
            row.kind = kind
        if "confidence" in args and args.get("confidence") is not None:
            try:
                row.confidence = max(0.0, min(1.0, float(args.get("confidence"))))
            except Exception:
                pass
        row.updated_at = time.time()
        session.add(row)
        session.commit()
        session.refresh(row)
        return {"updated": True, "memory": _memory_to_dict(row)}


def _memory_archive(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    memory_id = str(args.get("memory_id") or "").strip()
    if not memory_id:
        raise HTTPException(status_code=400, detail="memory_id is required for memory.archive")
    with Session(engine) as session:
        row = _get_owned_memory(session, user_id, memory_id)
        row.archived = True
        row.updated_at = time.time()
        session.add(row)
        session.commit()
        return {"archived": True, "memory_id": memory_id}


def _evolution_to_dict(row: EvolutionInput) -> Dict[str, Any]:
    def _load(raw, fallback):
        try:
            return json.loads(raw)
        except Exception:
            return fallback

    return {
        "evolution_input_id": row.evolution_input_id,
        "source_ai_config_id": row.source_ai_config_id,
        "type": row.type,
        "target_scope": _load(row.target_scope, {}),
        "evidence": _load(row.evidence, []),
        "proposal": row.proposal,
        "risk": row.risk,
        "review_status": row.review_status,
        "applied_to": row.applied_to,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _evolution_input(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    proposal = str(args.get("proposal") or "").strip()
    if not proposal:
        raise HTTPException(status_code=400, detail="proposal is required for evolution.input")
    etype = str(args.get("type") or "lesson").strip().lower()
    if etype not in _EVOLUTION_TYPES:
        raise HTTPException(status_code=400, detail=f"type must be one of {sorted(_EVOLUTION_TYPES)}")
    target_scope = args.get("target_scope")
    evidence = args.get("evidence")
    with Session(engine) as session:
        row = EvolutionInput(
            evolution_input_id=f"evo_{uuid.uuid4().hex[:12]}",
            user_id=user_id,
            source_ai_config_id=ai_config_id,
            type=etype,
            target_scope=json.dumps(target_scope, ensure_ascii=False) if isinstance(target_scope, dict) else "{}",
            evidence=json.dumps(evidence, ensure_ascii=False) if isinstance(evidence, list) else "[]",
            proposal=proposal,
            risk=str(args.get("risk") or "").strip(),
            review_status="queued",
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return {"submitted": True, "evolution_input": _evolution_to_dict(row)}


def _evolution_list(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    status = str(args.get("review_status") or args.get("status") or "").strip().lower()
    try:
        limit = int(args.get("limit", 50))
    except Exception:
        limit = 50
    limit = max(1, min(200, limit))
    with Session(engine) as session:
        stmt = select(EvolutionInput).where(EvolutionInput.user_id == user_id)
        if status:
            if status not in _REVIEW_STATUSES:
                raise HTTPException(status_code=400, detail=f"review_status must be one of {sorted(_REVIEW_STATUSES)}")
            stmt = stmt.where(EvolutionInput.review_status == status)
        rows = session.exec(stmt.order_by(EvolutionInput.created_at.desc())).all()
    items = [_evolution_to_dict(row) for row in rows[:limit]]
    return {"count": len(items), "evolution_inputs": items}


def _evolution_review(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    evo_id = str(args.get("evolution_input_id") or "").strip()
    if not evo_id:
        raise HTTPException(status_code=400, detail="evolution_input_id is required for evolution.review")
    decision = str(args.get("decision") or args.get("review_status") or "").strip().lower()
    decision_map = {"accept": "accepted", "reject": "rejected", "apply": "applied", "applied": "applied"}
    decision = decision_map.get(decision, decision)
    if decision not in {"accepted", "rejected", "applied"}:
        raise HTTPException(status_code=400, detail="decision must be accept/reject/apply")
    with Session(engine) as session:
        row = session.exec(
            select(EvolutionInput).where(
                EvolutionInput.user_id == user_id,
                EvolutionInput.evolution_input_id == evo_id,
            )
        ).first()
        if not row:
            raise HTTPException(status_code=404, detail="EvolutionInput not found")
        row.review_status = decision
        if decision == "applied":
            row.applied_to = str(args.get("applied_to") or "").strip()
        row.updated_at = time.time()
        session.add(row)
        session.commit()
        session.refresh(row)
        return {"reviewed": True, "evolution_input": _evolution_to_dict(row)}

"""MCP tools for Evolution Input (Phase 3).

EvolutionInput = proposals to improve the AI system itself (prompts, tool
rules, workflows), reviewed and applied by a core manager.
"""

import json
import time
import uuid
from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from api.database import engine
from api.models import EvolutionInput
from api.services import kb_store

_EVOLUTION_TYPES = {
    "prompt_rule",
    "tool_rule",
    "workflow_rule",
    "memory",
    "failure_case",
    "success_case",
}
_REVIEW_STATUSES = {"queued", "accepted", "rejected", "applied"}


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
        evo = _evolution_to_dict(row)
    kb_store.write_evolution_file(user_id, evo)  # 文件真相源双写（best-effort）
    return {"submitted": True, "evolution_input": evo}


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
        evo = _evolution_to_dict(row)
    kb_store.write_evolution_file(user_id, evo)  # 文件真相源双写（best-effort）
    return {"reviewed": True, "evolution_input": evo}

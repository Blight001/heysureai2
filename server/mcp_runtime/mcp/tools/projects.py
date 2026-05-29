import json
import time
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from api.database import engine
from api.models import AssistantAIConfig, EvolutionProject
def _normalize_project_status(status: Any) -> str:
    value = str(status or "running").strip()
    if value not in {"running", "ended"}:
        raise HTTPException(status_code=400, detail="status must be one of: running, ended")
    return value

def _normalize_member_ids(value: Any) -> List[int]:
    if value is None:
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return []
    if not isinstance(value, list):
        return []
    parsed: List[int] = []
    for item in value:
        try:
            parsed.append(int(item))
        except Exception:
            continue
    return sorted(list(set(parsed)))

def _list_projects(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    with Session(engine) as session:
        rows = session.exec(
            select(EvolutionProject)
            .where(EvolutionProject.user_id == user_id)
            .order_by(EvolutionProject.created_at.asc())
        ).all()
        data = []
        for row in rows:
            members = _normalize_member_ids(row.ai_member_ids)
            data.append({
                "id": row.project_id,
                "name": row.name,
                "description": row.description,
                "status": row.status,
                "ai_member_ids": members,
                "created_at": row.created_at,
                "updated_at": row.updated_at,
            })
        return {"projects": data}

def _create_project(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    name = str(args.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    description = str(args.get("description") or "").strip()
    status = _normalize_project_status(args.get("status"))
    member_ids = _normalize_member_ids(args.get("ai_member_ids"))
    project_id = f"p-{int(time.time() * 1000)}"

    with Session(engine) as session:
        row = EvolutionProject(
            user_id=user_id,
            project_id=project_id,
            name=name,
            description=description,
            status=status,
            ai_member_ids=json.dumps(member_ids, ensure_ascii=False),
        )
        session.add(row)

        if member_ids:
            cfgs = session.exec(
                select(AssistantAIConfig).where(AssistantAIConfig.user_id == user_id)
            ).all()
            for cfg in cfgs:
                if cfg.id in member_ids:
                    cfg.project_id = project_id
                    cfg.project_name = name
                    cfg.updated_at = time.time()
                    session.add(cfg)
        session.commit()
        session.refresh(row)

    return {
        "id": project_id,
        "name": name,
        "description": description,
        "status": status,
        "ai_member_ids": member_ids,
    }

def _update_project(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    project_id = str(args.get("id") or args.get("project_id") or "").strip()
    if not project_id:
        raise HTTPException(status_code=400, detail="id (or project_id) is required")

    with Session(engine) as session:
        row = session.exec(
            select(EvolutionProject).where(
                EvolutionProject.user_id == user_id,
                EvolutionProject.project_id == project_id,
            )
        ).first()
        if not row:
            raise HTTPException(status_code=404, detail="Project not found")

        next_name = None
        if "name" in args and args.get("name") is not None:
            next_name = str(args.get("name")).strip()
            if not next_name:
                raise HTTPException(status_code=400, detail="name cannot be empty")
            row.name = next_name

        if "description" in args and args.get("description") is not None:
            row.description = str(args.get("description") or "").strip()

        if "status" in args and args.get("status") is not None:
            row.status = _normalize_project_status(args.get("status"))

        if "ai_member_ids" in args:
            member_ids = _normalize_member_ids(args.get("ai_member_ids"))
            row.ai_member_ids = json.dumps(member_ids, ensure_ascii=False)
            cfgs = session.exec(
                select(AssistantAIConfig).where(AssistantAIConfig.user_id == user_id)
            ).all()
            for cfg in cfgs:
                if cfg.id in member_ids:
                    cfg.project_id = row.project_id
                    cfg.project_name = row.name
                elif cfg.project_id == row.project_id:
                    cfg.project_id = None
                    cfg.project_name = None
                cfg.updated_at = time.time()
                session.add(cfg)
        elif next_name is not None:
            linked = session.exec(
                select(AssistantAIConfig).where(
                    AssistantAIConfig.user_id == user_id,
                    AssistantAIConfig.project_id == row.project_id,
                )
            ).all()
            for cfg in linked:
                cfg.project_name = row.name
                cfg.updated_at = time.time()
                session.add(cfg)

        row.updated_at = time.time()
        session.add(row)
        session.commit()
        session.refresh(row)

        return {
            "id": row.project_id,
            "name": row.name,
            "description": row.description,
            "status": row.status,
            "ai_member_ids": _normalize_member_ids(row.ai_member_ids),
        }

def _delete_project(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    project_id = str(args.get("id") or args.get("project_id") or "").strip()
    if not project_id:
        raise HTTPException(status_code=400, detail="id (or project_id) is required")

    with Session(engine) as session:
        row = session.exec(
            select(EvolutionProject).where(
                EvolutionProject.user_id == user_id,
                EvolutionProject.project_id == project_id,
            )
        ).first()
        if not row:
            raise HTTPException(status_code=404, detail="Project not found")

        linked = session.exec(
            select(AssistantAIConfig).where(
                AssistantAIConfig.user_id == user_id,
                AssistantAIConfig.project_id == project_id,
            )
        ).all()
        for cfg in linked:
            cfg.project_id = None
            cfg.project_name = None
            cfg.updated_at = time.time()
            session.add(cfg)

        session.delete(row)
        session.commit()
    return {"success": True, "id": project_id}

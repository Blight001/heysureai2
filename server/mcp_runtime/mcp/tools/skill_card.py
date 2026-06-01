"""Skill Card MCP tools — store / retrieve / version reusable operation skills.

S1 数据地基：卡片的 CRUD、版本历史与按环境执行统计。设计见
``doc/沉淀技能卡片-设计方案.md``。重放执行（``card.execute``）与失败自愈属于 S2/S3，
在 endpoint agent 侧实现，这里只负责服务端存取与治理规则：

- 可见性按 scope 收敛（private 仅创建者 AI；team/public 同账号下其它 AI 可见）
- 写入用乐观锁（expected_version）避免并发改卡互相覆盖（§6.4）
- 改非自己拥有的 public 卡默认 fork（copy-on-heal），不原地改（§6.4）
- 信任分按 (card, environment_signature) 维度累计，跨环境不继承（§6.3）

能力契约（capability）与调用方权限的交集校验发生在执行端（§6.2），不在存取层。
"""

import json
import time
import uuid
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from api.database import engine
from api.models import SkillCard, SkillCardRunStat, SkillCardVersion

_SURFACES = {"windows", "browser", "shell", "composite"}
_SCOPES = {"private", "team", "public"}
_STATUSES = {"draft", "supervised", "trusted", "deprecated"}

# 晋升 / 降级阈值（按环境的连续成败计，见 §4.4 / §6.3）。
_PROMOTE_AFTER_CONSECUTIVE_SUCCESS = 5   # supervised -> trusted
_DEMOTE_AFTER_CONSECUTIVE_FAIL = 3       # trusted -> supervised


def _dumps(value: Any) -> Optional[str]:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False)


def _loads(raw: Optional[str], fallback: Any) -> Any:
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except Exception:
        return fallback


def _require(value: Any, name: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail=f"{name} is required")
    return text


def _enum(value: Any, allowed: set, name: str, default: Optional[str] = None) -> str:
    text = str(value or "").strip().lower()
    if not text and default is not None:
        return default
    if text not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"{name} must be one of {sorted(allowed)}",
        )
    return text


def _str_list(value: Any) -> List[str]:
    if value is None:
        return []
    items = value if isinstance(value, list) else [value]
    out: List[str] = []
    seen = set()
    for item in items:
        text = str(item or "").strip()
        if text and text not in seen:
            seen.add(text)
            out.append(text)
    return out


def _card_to_dict(row: SkillCard, *, full: bool = True) -> Dict[str, Any]:
    base: Dict[str, Any] = {
        "card_id": row.card_id,
        "name": row.name,
        "description": row.description,
        "surface": row.surface,
        "scope": row.scope,
        "status": row.status,
        "version": row.version,
        "domain": _loads(row.domain, []),
        "owner_ai_config_id": row.owner_ai_config_id,
        "environment_signature": row.environment_signature,
        "forked_from_card_id": row.forked_from_card_id,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }
    if full:
        base.update({
            "capability": _loads(row.capability, []),
            "params": _loads(row.params, []),
            "preconditions": _loads(row.preconditions, []),
            "steps": _loads(row.steps, []),
            "postconditions": _loads(row.postconditions, []),
        })
    return base


def _visible_card(
    session: Session,
    user_id: int,
    ai_config_id: Optional[int],
    card_id: str,
) -> SkillCard:
    """Load a card the caller is allowed to see, or raise 404/403.

    Visibility (§6.6): all cards are scoped to the owning user account. Within an
    account, ``private`` is only visible to the creating AI; ``team`` / ``public``
    are visible to every AI under the same account.
    """
    row = session.exec(
        select(SkillCard).where(
            SkillCard.user_id == user_id,
            SkillCard.card_id == card_id,
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Skill card not found")
    if row.scope == "private" and row.owner_ai_config_id is not None:
        if ai_config_id is None or int(ai_config_id) != int(row.owner_ai_config_id):
            raise HTTPException(status_code=403, detail="Private skill card belongs to another AI")
    return row


def _snapshot_version(session: Session, row: SkillCard, author_ai_config_id: Optional[int], change_summary: str) -> None:
    session.add(SkillCardVersion(
        card_id=row.card_id,
        version=row.version,
        author_ai_config_id=author_ai_config_id,
        change_summary=change_summary or None,
        snapshot=_dumps(_card_to_dict(row, full=True)),
    ))


def _skill_card_create(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    name = _require(args.get("name") or args.get("title"), "name")
    surface = _enum(args.get("surface"), _SURFACES, "surface", default="windows")
    scope = _enum(args.get("scope"), _SCOPES, "scope", default="private")
    steps = args.get("steps")
    if not isinstance(steps, list) or not steps:
        raise HTTPException(status_code=400, detail="steps must be a non-empty list")

    card_id = f"card_{uuid.uuid4().hex[:12]}"
    now = time.time()
    row = SkillCard(
        card_id=card_id,
        user_id=user_id,
        owner_ai_config_id=ai_config_id,
        name=name,
        description=str(args.get("description") or "").strip() or None,
        surface=surface,
        scope=scope,
        status="draft",  # 新卡一律 draft，须经 supervised 运行才能晋升（§4.4）
        version=1,
        domain=_dumps(_str_list(args.get("domain"))),
        capability=_dumps(_str_list(args.get("capability"))),
        params=_dumps(args.get("params") or []),
        preconditions=_dumps(args.get("preconditions") or []),
        steps=_dumps(steps),
        postconditions=_dumps(args.get("postconditions") or []),
        environment_signature=str(args.get("environment_signature") or "").strip() or None,
        created_at=now,
        updated_at=now,
    )
    with Session(engine) as session:
        session.add(row)
        _snapshot_version(session, row, ai_config_id, "initial draft")
        session.commit()
        session.refresh(row)
        return {"created": True, "card": _card_to_dict(row)}


def _skill_card_list(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    query = select(SkillCard).where(SkillCard.user_id == user_id)
    surface = str(args.get("surface") or "").strip().lower()
    if surface:
        query = query.where(SkillCard.surface == surface)
    status = str(args.get("status") or "").strip().lower()
    if status:
        query = query.where(SkillCard.status == status)
    scope = str(args.get("scope") or "").strip().lower()
    if scope:
        query = query.where(SkillCard.scope == scope)
    if not str(args.get("include_deprecated") or "").strip().lower() in {"1", "true", "yes"}:
        query = query.where(SkillCard.status != "deprecated")

    domain_filter = str(args.get("domain") or "").strip()
    keyword = str(args.get("keyword") or args.get("query") or "").strip().lower()
    with Session(engine) as session:
        rows = session.exec(query.order_by(SkillCard.updated_at.desc())).all()
        cards = []
        for row in rows:
            # 可见性：private 仅创建者 AI 可见。
            if row.scope == "private" and row.owner_ai_config_id is not None:
                if ai_config_id is None or int(ai_config_id) != int(row.owner_ai_config_id):
                    continue
            if domain_filter and domain_filter not in _loads(row.domain, []):
                continue
            if keyword and keyword not in f"{row.name} {row.description or ''}".lower():
                continue
            cards.append(_card_to_dict(row, full=False))
    return {"count": len(cards), "cards": cards}


def _skill_card_get(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    card_id = _require(args.get("card_id"), "card_id")
    env = str(args.get("environment_signature") or "").strip()
    with Session(engine) as session:
        row = _visible_card(session, user_id, ai_config_id, card_id)
        card = _card_to_dict(row, full=True)
        stat = None
        if env:
            stat_row = session.exec(
                select(SkillCardRunStat).where(
                    SkillCardRunStat.card_id == card_id,
                    SkillCardRunStat.environment_signature == env,
                )
            ).first()
            if stat_row:
                stat = _stat_to_dict(stat_row)
        return {"card": card, "stat": stat}


def _skill_card_update(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    """Update a card's head, snapshotting the previous version.

    Concurrency safety (§6.4): caller must pass ``expected_version`` matching the
    current head (optimistic lock). Editing a ``public`` card you do not own
    forks a private copy (copy-on-heal) instead of mutating the shared card.
    """
    card_id = _require(args.get("card_id"), "card_id")
    change_summary = str(args.get("change_summary") or "").strip()
    with Session(engine) as session:
        row = _visible_card(session, user_id, ai_config_id, card_id)

        # copy-on-heal: 改非自己拥有的 public 卡 → fork 私有副本。
        is_owner = row.owner_ai_config_id is None or (
            ai_config_id is not None and int(ai_config_id) == int(row.owner_ai_config_id)
        )
        if row.scope == "public" and not is_owner:
            return _fork_card(session, row, user_id, ai_config_id, args, change_summary)

        expected = args.get("expected_version")
        if expected is not None and int(expected) != int(row.version):
            raise HTTPException(
                status_code=409,
                detail=f"Version conflict: head is {row.version}, expected {expected}. Reload and retry.",
            )

        _snapshot_version(session, row, ai_config_id, change_summary or "update")
        _apply_card_fields(row, args)
        row.version = int(row.version) + 1
        row.updated_at = time.time()
        session.add(row)
        session.commit()
        session.refresh(row)
        return {"updated": True, "card": _card_to_dict(row)}


def _fork_card(
    session: Session,
    src: SkillCard,
    user_id: int,
    ai_config_id: Optional[int],
    args: Dict[str, Any],
    change_summary: str,
) -> Dict[str, Any]:
    now = time.time()
    new_id = f"card_{uuid.uuid4().hex[:12]}"
    fork = SkillCard(
        card_id=new_id,
        user_id=user_id,
        owner_ai_config_id=ai_config_id,
        name=src.name,
        description=src.description,
        surface=src.surface,
        scope="private",         # fork 默认私有，验证后再由 Archivist 决定是否合并回主卡
        status="draft",
        version=1,
        domain=src.domain,
        capability=src.capability,
        params=src.params,
        preconditions=src.preconditions,
        steps=src.steps,
        postconditions=src.postconditions,
        environment_signature=str(args.get("environment_signature") or "").strip() or None,
        forked_from_card_id=src.card_id,
        created_at=now,
        updated_at=now,
    )
    _apply_card_fields(fork, args)
    session.add(fork)
    _snapshot_version(session, fork, ai_config_id, change_summary or f"forked from {src.card_id}")
    session.commit()
    session.refresh(fork)
    return {"forked": True, "forked_from": src.card_id, "card": _card_to_dict(fork)}


def _apply_card_fields(row: SkillCard, args: Dict[str, Any]) -> None:
    if "name" in args or "title" in args:
        row.name = _require(args.get("name") or args.get("title"), "name")
    if "description" in args:
        row.description = str(args.get("description") or "").strip() or None
    if "surface" in args:
        row.surface = _enum(args.get("surface"), _SURFACES, "surface")
    if "scope" in args:
        row.scope = _enum(args.get("scope"), _SCOPES, "scope")
    if "domain" in args:
        row.domain = _dumps(_str_list(args.get("domain")))
    if "capability" in args:
        row.capability = _dumps(_str_list(args.get("capability")))
    if "params" in args:
        row.params = _dumps(args.get("params") or [])
    if "preconditions" in args:
        row.preconditions = _dumps(args.get("preconditions") or [])
    if "steps" in args:
        steps = args.get("steps")
        if not isinstance(steps, list) or not steps:
            raise HTTPException(status_code=400, detail="steps must be a non-empty list")
        row.steps = _dumps(steps)
    if "postconditions" in args:
        row.postconditions = _dumps(args.get("postconditions") or [])
    if "status" in args:
        row.status = _enum(args.get("status"), _STATUSES, "status")


def _skill_card_delete(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    """Soft-delete: mark deprecated. Only the owner AI may deprecate a card."""
    card_id = _require(args.get("card_id"), "card_id")
    with Session(engine) as session:
        row = _visible_card(session, user_id, ai_config_id, card_id)
        if row.owner_ai_config_id is not None and (
            ai_config_id is None or int(ai_config_id) != int(row.owner_ai_config_id)
        ):
            raise HTTPException(status_code=403, detail="Only the owner AI can deprecate this card")
        row.status = "deprecated"
        row.updated_at = time.time()
        session.add(row)
        session.commit()
        return {"deprecated": True, "card_id": card_id}


def _stat_to_dict(row: SkillCardRunStat) -> Dict[str, Any]:
    return {
        "card_id": row.card_id,
        "environment_signature": row.environment_signature,
        "version": row.version,
        "runs": row.runs,
        "success": row.success,
        "fail": row.fail,
        "consecutive_success": row.consecutive_success,
        "consecutive_fail": row.consecutive_fail,
        "trust_score": round(row.trust_score, 4),
        "last_failed_step": row.last_failed_step,
        "last_run_at": row.last_run_at,
    }


def _skill_card_record_run(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    """Record one replay result for a card in a given environment.

    Updates the per-environment stat (§6.3) and applies status promotion /
    demotion (§4.4). Cross-environment trust is never inherited: a new
    environment starts at zero and the card runs supervised there until it earns
    trust locally.
    """
    card_id = _require(args.get("card_id"), "card_id")
    env = str(args.get("environment_signature") or "").strip()
    success = bool(args.get("success"))
    failed_step = args.get("failed_step")
    now = time.time()
    with Session(engine) as session:
        row = _visible_card(session, user_id, ai_config_id, card_id)
        stat = session.exec(
            select(SkillCardRunStat).where(
                SkillCardRunStat.card_id == card_id,
                SkillCardRunStat.environment_signature == env,
            )
        ).first()
        if not stat:
            stat = SkillCardRunStat(card_id=card_id, environment_signature=env, version=row.version)
            session.add(stat)
        stat.version = row.version
        stat.runs += 1
        stat.last_run_at = now
        if success:
            stat.success += 1
            stat.consecutive_success += 1
            stat.consecutive_fail = 0
            stat.last_failed_step = None
        else:
            stat.fail += 1
            stat.consecutive_fail += 1
            stat.consecutive_success = 0
            if failed_step is not None:
                try:
                    stat.last_failed_step = int(failed_step)
                except Exception:
                    stat.last_failed_step = None
        stat.trust_score = stat.success / stat.runs if stat.runs else 0.0

        promoted = demoted = False
        if success and row.status in {"draft", "supervised"}:
            if stat.consecutive_success >= _PROMOTE_AFTER_CONSECUTIVE_SUCCESS:
                row.status = "trusted"
                promoted = True
        elif not success and row.status == "trusted":
            if stat.consecutive_fail >= _DEMOTE_AFTER_CONSECUTIVE_FAIL:
                row.status = "supervised"  # 连续失败回落，重新积累信任（§6.3）
                demoted = True
        if promoted or demoted:
            row.updated_at = now
            session.add(row)
        session.add(stat)
        session.commit()
        session.refresh(stat)
        return {
            "recorded": True,
            "status": row.status,
            "promoted": promoted,
            "demoted": demoted,
            "stat": _stat_to_dict(stat),
        }


def _skill_card_versions(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    card_id = _require(args.get("card_id"), "card_id")
    with Session(engine) as session:
        _visible_card(session, user_id, ai_config_id, card_id)  # 可见性校验
        rows = session.exec(
            select(SkillCardVersion)
            .where(SkillCardVersion.card_id == card_id)
            .order_by(SkillCardVersion.version.desc())
        ).all()
        versions = [
            {
                "version": r.version,
                "author_ai_config_id": r.author_ai_config_id,
                "change_summary": r.change_summary,
                "created_at": r.created_at,
            }
            for r in rows
        ]
    return {"card_id": card_id, "count": len(versions), "versions": versions}

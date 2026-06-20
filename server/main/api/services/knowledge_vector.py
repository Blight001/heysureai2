"""Semantic indexing and retrieval for KnowledgeEntry topics."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import urlsplit, urlunsplit

from fastapi import HTTPException
from sqlalchemy import select
from sqlmodel import Session

from api.core.settings import settings
from api.core.config import user_shared_knowledge_dir
from api.database import engine
from api.http_client import ai_http_post
from api.models import AssistantAIConfig, KnowledgeEmbedding, KnowledgeEntry, User
from api.services.model_presets import resolve_model_preset

logger = logging.getLogger(__name__)

_MAX_EMBED_TEXT_CHARS = 12_000
_MAX_EXCERPT_CHARS = 280
_WORD_PATTERN = re.compile(r"[一-鿿]|[A-Za-z0-9]+")


def _split_frontmatter(text: str) -> tuple[Dict[str, str], str]:
    src = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    if not src.startswith("---\n"):
        return {}, src
    end = src.find("\n---\n", 4)
    if end < 0:
        return {}, src
    head = src[4:end]
    body = src[end + 5 :]
    meta: Dict[str, str] = {}
    for line in head.split("\n"):
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        meta[key.strip()] = value.strip()
    return meta, body.lstrip("\n")


def _read_text(path: str) -> Optional[str]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return None
    except Exception as exc:  # pragma: no cover - defensive
        logger.info("knowledge_vector read %s failed: %s", path, exc)
        return None


def _topic_path(user_id: int, file_path: str) -> str:
    root = user_shared_knowledge_dir(int(user_id))
    abs_root = os.path.abspath(root)
    joined = os.path.abspath(os.path.join(abs_root, str(file_path or "")))
    try:
        common = os.path.commonpath([abs_root, joined])
    except ValueError:
        common = ""
    if common != abs_root:
        raise ValueError("Access denied: path outside workspace")
    return joined


def _normalize_csv(raw: Any) -> list[str]:
    if isinstance(raw, list):
        items = [str(item).strip() for item in raw if str(item).strip()]
    else:
        items = [piece.strip() for piece in re.split(r"[,，;；\n]+", str(raw or "")) if piece.strip()]
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def _scope_match(row: KnowledgeEntry, scope: Optional[str], ai_config_id: Optional[int]) -> bool:
    if row.scope == "global":
        return True
    if scope:
        if scope == "global":
            return row.scope == "global"
        if scope == "ai" and row.scope == "ai":
            return str(row.scope_target or "") == str(ai_config_id or "")
        if scope == "project" and row.scope == "project":
            return True
    if row.scope == "ai" and ai_config_id is not None:
        return str(row.scope_target or "") == str(ai_config_id)
    return False


def _tokenize(text: str) -> list[str]:
    return [m.lower() for m in _WORD_PATTERN.findall(text or "")]


def _score_lexical(row: KnowledgeEntry, query_text: str) -> float:
    q_tokens = _tokenize(query_text)
    if not q_tokens:
        return 0.0
    hay = " ".join([
        row.title or "",
        row.triggers or "",
        row.summary or "",
    ]).lower()
    score = 0.0
    for trigger in _normalize_csv(row.triggers):
        if trigger and trigger.lower() in query_text.lower():
            score += 2.0
    for token in q_tokens:
        if token in hay:
            score += 1.0
    return score


def _clip_text(text: str, limit: int = _MAX_EMBED_TEXT_CHARS) -> str:
    raw = str(text or "")
    return raw if len(raw) <= limit else raw[:limit]


def _render_embedding_text(
    row: KnowledgeEntry,
    *,
    body_text: str = "",
) -> str:
    parts = [
        f"标题: {row.title or ''}".strip(),
        f"触发词: {', '.join(_normalize_csv(row.triggers))}".strip(),
        f"摘要: {row.summary or ''}".strip(),
    ]
    body = _clip_text(body_text or "")
    if body.strip():
        parts.extend(["正文:", body.strip()])
    return "\n".join(part for part in parts if part).strip()


def _content_hash(row: KnowledgeEntry, body_text: str) -> str:
    payload = {
        "title": str(row.title or ""),
        "triggers": _normalize_csv(row.triggers),
        "summary": str(row.summary or ""),
        "body": _clip_text(body_text or ""),
        "status": str(row.status or ""),
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _source_snapshot(row: KnowledgeEntry, body_text: str) -> str:
    payload = {
        "memory_id": row.memory_id,
        "title": row.title,
        "triggers": _normalize_csv(row.triggers),
        "scope": row.scope,
        "scope_target": row.scope_target,
        "summary": row.summary,
        "status": row.status,
        "file_path": row.file_path,
        "body_chars": len(body_text or ""),
        "updated_at": row.updated_at,
    }
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def _embedding_url(base_url: str) -> str:
    text = str(base_url or "").rstrip("/")
    if not text:
        return text
    parts = urlsplit(text)
    path = parts.path.rstrip("/")
    if path.endswith("/chat/completions"):
        path = path[: -len("/chat/completions")] + "/embeddings"
    elif path.endswith("/responses"):
        path = path[: -len("/responses")] + "/embeddings"
    elif path.endswith("/completions"):
        path = path[: -len("/completions")] + "/embeddings"
    else:
        path = f"{path}/embeddings" if path else "/embeddings"
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, parts.fragment))


def _normalize_embedding(values: Sequence[Any], dimensions: int) -> list[float]:
    out = [float(v) for v in values if isinstance(v, (int, float))]
    dims = max(1, int(dimensions or 1536))
    if len(out) > dims:
        return out[:dims]
    if len(out) < dims:
        out.extend([0.0] * (dims - len(out)))
    return out


def _extract_embedding_vector(payload: Dict[str, Any], dimensions: int) -> list[float]:
    data = payload.get("data")
    if isinstance(data, list) and data:
        first = data[0] if isinstance(data[0], dict) else {}
        vec = first.get("embedding") if isinstance(first, dict) else None
        if isinstance(vec, list):
            return _normalize_embedding(vec, dimensions)
    raise ValueError("embedding response missing data[0].embedding")


def _cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    if not left or not right:
        return 0.0
    limit = min(len(left), len(right))
    dot = 0.0
    left_norm = 0.0
    right_norm = 0.0
    for idx in range(limit):
        lv = float(left[idx] or 0.0)
        rv = float(right[idx] or 0.0)
        dot += lv * rv
        left_norm += lv * lv
        right_norm += rv * rv
    if left_norm <= 0.0 or right_norm <= 0.0:
        return 0.0
    return dot / ((left_norm ** 0.5) * (right_norm ** 0.5))


def _coerce_embedding(value: Any) -> list[float]:
    if isinstance(value, list):
        return [float(item) for item in value if isinstance(item, (int, float))]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            return []
        if isinstance(parsed, list):
            return [float(item) for item in parsed if isinstance(item, (int, float))]
    return []


def _resolve_embedding_credentials(
    user_id: int,
    ai_config_id: Optional[int],
) -> tuple[str, str, str, int]:
    with Session(engine) as session:
        user = session.get(User, int(user_id))
        cfg = None
        if ai_config_id is not None:
            cfg = session.exec(
                select(AssistantAIConfig).where(
                    AssistantAIConfig.user_id == int(user_id),
                    AssistantAIConfig.id == int(ai_config_id),
                )
            ).first()
    if user is None:
        return "", "", str(settings.embedding_model or "text-embedding-3-small"), int(settings.embedding_dimensions or 1536)

    api_key, base_url, _chat_model = resolve_model_preset(user, cfg)
    model = str(settings.embedding_model or _chat_model or "text-embedding-3-small").strip()
    dims = int(settings.embedding_dimensions or 1536)
    return api_key, base_url, model, dims


def _embed_text(
    *,
    api_key: str,
    base_url: str,
    model: str,
    dimensions: int,
    text: str,
) -> list[float]:
    if not api_key or not base_url:
        raise ValueError("embedding credentials are not configured")
    resp = ai_http_post(
        _embedding_url(base_url),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        json={
            "model": model,
            "input": text,
            "dimensions": dimensions,
        },
        timeout=120,
        stream=False,
    )
    if resp.status_code >= 400:
        raise ValueError(f"embedding request failed HTTP {resp.status_code}: {str(getattr(resp, 'text', '') or '')[:500]}")
    payload = resp.json()
    if not isinstance(payload, dict):
        raise ValueError("embedding response is not an object")
    return _extract_embedding_vector(payload, dimensions)


def _read_topic_body(user_id: int, row: KnowledgeEntry) -> str:
    path = _topic_path(user_id, row.file_path)
    raw = _read_text(path)
    if raw is None:
        return ""
    _meta, body = _split_frontmatter(raw)
    return body.strip()


def ensure_knowledge_embedding(
    session: Session,
    *,
    user_id: int,
    row: KnowledgeEntry,
    ai_config_id: Optional[int] = None,
    force: bool = False,
) -> bool:
    """Upsert a semantic index row for a single KnowledgeEntry."""

    body_text = _read_topic_body(user_id, row)
    embedded_text = _render_embedding_text(row, body_text=body_text)
    content_hash = _content_hash(row, body_text)
    snapshot = _source_snapshot(row, body_text)
    existing = session.exec(
        select(KnowledgeEmbedding).where(
            KnowledgeEmbedding.user_id == int(user_id),
            KnowledgeEmbedding.memory_id == row.memory_id,
        )
    ).first()
    if existing and existing.content_hash == content_hash and not force:
        if existing.source_snapshot != snapshot:
            existing.source_snapshot = snapshot
            existing.updated_at = time.time()
            session.add(existing)
            session.commit()
        return False

    api_key, base_url, model, dimensions = _resolve_embedding_credentials(user_id, ai_config_id)
    embedding = _embed_text(
        api_key=api_key,
        base_url=base_url,
        model=model,
        dimensions=dimensions,
        text=embedded_text,
    )

    now = time.time()
    target = existing or KnowledgeEmbedding(
        memory_id=row.memory_id,
        user_id=int(user_id),
        content_hash=content_hash,
        content_text=embedded_text,
        source_snapshot=snapshot,
        embedding=embedding,
        created_at=now,
        updated_at=now,
    )
    target.content_hash = content_hash
    target.content_text = embedded_text
    target.source_snapshot = snapshot
    target.embedding = embedding
    target.updated_at = now
    session.add(target)
    session.commit()
    return True


def ensure_knowledge_embeddings(
    *,
    user_id: int,
    ai_config_id: Optional[int] = None,
    session: Optional[Session] = None,
    force: bool = False,
) -> int:
    own = session is None
    sess = session or Session(engine)
    changed = 0
    try:
        api_key, base_url, _model, _dimensions = _resolve_embedding_credentials(user_id, ai_config_id)
        if not api_key or not base_url:
            return 0
        rows = sess.exec(
            select(KnowledgeEntry).where(KnowledgeEntry.user_id == int(user_id))
        ).all()
        for row in rows:
            try:
                if ensure_knowledge_embedding(sess, user_id=int(user_id), row=row, ai_config_id=ai_config_id, force=force):
                    changed += 1
            except Exception as exc:
                logger.info("knowledge_vector index failed user=%s memory_id=%s: %s", user_id, row.memory_id, exc)
        return changed
    finally:
        if own:
            sess.close()


def _entry_result(
    *,
    user_id: int,
    row: KnowledgeEntry,
    score: float,
    distance: Optional[float] = None,
    include_body: bool = False,
) -> Dict[str, Any]:
    body = _read_topic_body(user_id, row)
    excerpt_source = body or row.summary or ""
    excerpt = excerpt_source.replace("\n", " ").strip()
    if len(excerpt) > _MAX_EXCERPT_CHARS:
        excerpt = excerpt[:_MAX_EXCERPT_CHARS] + "…"
    payload: Dict[str, Any] = {
        "memory_id": row.memory_id,
        "title": row.title,
        "triggers": _normalize_csv(row.triggers),
        "scope": row.scope,
        "scope_target": row.scope_target,
        "status": row.status,
        "summary": row.summary,
        "confidence": row.confidence,
        "score": round(float(score), 6),
        "distance": round(float(distance), 6) if distance is not None else None,
        "excerpt": excerpt,
        "file_path": row.file_path,
        "updated_at": row.updated_at,
    }
    if include_body:
        payload["body"] = body
    return payload


def _vector_search_candidates(
    session: Session,
    *,
    user_id: int,
    query_vector: Sequence[float],
    scope: Optional[str],
    ai_config_id: Optional[int],
    candidate_limit: int,
) -> list[tuple[KnowledgeEntry, float]]:
    stmt = (
        select(KnowledgeEntry, KnowledgeEmbedding.embedding)
        .join(KnowledgeEmbedding, KnowledgeEmbedding.memory_id == KnowledgeEntry.memory_id)
        .where(
            KnowledgeEntry.user_id == int(user_id),
            KnowledgeEntry.status == "active",
        )
    )
    rows = session.exec(stmt).all()
    scored: list[tuple[KnowledgeEntry, float]] = []
    for item in rows:
        try:
            row = item[0]
            embedding = item[1]
        except Exception:
            continue
        if not isinstance(row, KnowledgeEntry) or not _scope_match(row, scope, ai_config_id):
            continue
        vector = _coerce_embedding(embedding)
        if not vector:
            continue
        scored.append((row, _cosine_similarity(query_vector, vector)))
    scored.sort(key=lambda pair: (-pair[1], -float(pair[0].updated_at or 0.0)))
    return scored[:candidate_limit]


def search_knowledge(
    *,
    user_id: int,
    query: str,
    k: int = 5,
    scope: Optional[str] = None,
    ai_config_id: Optional[int] = None,
    include_body: bool = False,
) -> List[Dict[str, Any]]:
    query_text = str(query or "").strip()
    if not query_text:
        return []

    with Session(engine) as session:
        try:
            ensure_knowledge_embeddings(user_id=user_id, ai_config_id=ai_config_id, session=session)
        except Exception as exc:
            logger.info("knowledge_vector backfill skipped for search: %s", exc)

        api_key, base_url, model, dimensions = _resolve_embedding_credentials(user_id, ai_config_id)
        query_vector: Optional[list[float]] = None
        if api_key and base_url:
            try:
                query_vector = _embed_text(
                    api_key=api_key,
                    base_url=base_url,
                    model=model,
                    dimensions=dimensions,
                    text=query_text,
                )
            except Exception as exc:
                logger.info("knowledge_vector query embedding failed user=%s: %s", user_id, exc)

        candidate_limit = max(20, int(k or 5) * 6)
        candidates: list[tuple[KnowledgeEntry, float, Optional[float]]] = []
        seen_ids: set[str] = set()
        if query_vector:
            try:
                for row, distance in _vector_search_candidates(
                    session,
                    user_id=user_id,
                    query_vector=query_vector,
                    scope=scope,
                    ai_config_id=ai_config_id,
                    candidate_limit=candidate_limit,
                ):
                    lexical = _score_lexical(row, query_text)
                    semantic = max(0.0, float(distance or 0.0))
                    score = semantic + min(lexical, 8.0) * 0.12
                    candidates.append((row, score, float(distance or 0.0)))
                    seen_ids.add(row.memory_id)
            except Exception as exc:
                logger.info("knowledge_vector native search failed user=%s: %s", user_id, exc)

        rows = session.exec(
            select(KnowledgeEntry).where(
                KnowledgeEntry.user_id == int(user_id),
                KnowledgeEntry.status == "active",
            )
        ).all()
        for row in rows:
            if row.memory_id in seen_ids or not _scope_match(row, scope, ai_config_id):
                continue
            lexical = _score_lexical(row, query_text)
            if lexical <= 0:
                continue
            candidates.append((row, lexical, None))

        candidates.sort(key=lambda item: (-item[1], -float(item[0].updated_at or 0)))
        top = candidates[: max(1, int(k or 5))]

        now = time.time()
        results: list[Dict[str, Any]] = []
        for row, score, distance in top:
            row.use_count += 1
            row.last_used_at = now
            session.add(row)
            results.append(
                _entry_result(
                    user_id=user_id,
                    row=row,
                    score=score,
                    distance=distance,
                    include_body=include_body,
                )
            )
        session.commit()
        return results


def knowledge_search_schema() -> Dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "语义检索的查询文本。"},
            "k": {"type": "integer", "description": "返回结果数量，默认 5。"},
            "scope": {
                "type": "string",
                "enum": ["global", "ai", "project"],
                "description": "可选作用域过滤；省略则按当前 AI 可见范围检索。",
            },
            "include_body": {"type": "boolean", "description": "是否返回全文正文。"},
        },
        "required": ["query"],
    }


def _knowledge_search_result(
    *,
    user_id: int,
    args: Dict[str, Any],
    ai_config_id: Optional[int] = None,
) -> Any:
    query = str((args or {}).get("query") or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query is required for knowledge.search")
    try:
        k = int((args or {}).get("k") or 5)
    except Exception:
        k = 5
    scope = str((args or {}).get("scope") or "").strip() or None
    include_body = bool((args or {}).get("include_body"))
    items = search_knowledge(
            user_id=user_id,
            query=query,
            k=k,
            scope=scope,
            ai_config_id=ai_config_id,
            include_body=include_body,
    )
    return {
        "query": query,
        "count": len(items),
        "items": items,
    }


def sync_topic_embedding_for_entry(
    *,
    user_id: int,
    row: KnowledgeEntry,
    ai_config_id: Optional[int] = None,
    force: bool = False,
) -> None:
    api_key, base_url, _model, _dimensions = _resolve_embedding_credentials(user_id, ai_config_id)
    if not api_key or not base_url:
        return
    with Session(engine) as session:
        try:
            ensure_knowledge_embedding(session, user_id=user_id, row=row, ai_config_id=ai_config_id, force=force)
        except Exception as exc:
            logger.info("knowledge_vector sync failed user=%s memory_id=%s: %s", user_id, row.memory_id, exc)

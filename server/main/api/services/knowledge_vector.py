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
from sqlalchemy import and_, or_, select
from sqlmodel import Session

from api.core.settings import settings
from api.core.config import user_shared_knowledge_dir
from api.database import engine
from api.http_client import ai_http_post
from api.models import AssistantAIConfig, KnowledgeEmbedding, KnowledgeEntry, User
from api.models.knowledge import EMBEDDING_BACKEND
from api.services.model_presets import resolve_model_preset

try:  # numpy accelerates the in-process cosine fallback; optional dependency.
    import numpy as _np
except Exception:  # pragma: no cover - numpy missing
    _np = None

_PGVECTOR = EMBEDDING_BACKEND == "pgvector"

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


def _content_hash(
    row: KnowledgeEntry,
    body_text: str,
    *,
    model: str = "",
    dimensions: int = 0,
) -> str:
    payload = {
        "title": str(row.title or ""),
        "triggers": _normalize_csv(row.triggers),
        "summary": str(row.summary or ""),
        "body": _clip_text(body_text or ""),
        "status": str(row.status or ""),
        # Bind the cache to the embedding model + width so switching either one
        # (e.g. text-embedding-3-small → -large, or a different dimension)
        # invalidates stale vectors instead of silently mixing incompatible ones.
        "embedding_model": str(model or ""),
        "embedding_dimensions": int(dimensions or 0),
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


def _batch_cosine(query: Sequence[float], vectors: Sequence[Sequence[float]]) -> list[float]:
    """Cosine similarity of ``query`` against each row in ``vectors``.

    Vectorised with numpy when available; otherwise falls back to the pure
    Python pairwise implementation. Rows are aligned to ``len(query)`` by
    truncation / zero-padding to tolerate width drift.
    """
    if not vectors:
        return []
    if _np is None:
        return [_cosine_similarity(query, vec) for vec in vectors]
    q = _np.asarray(list(query), dtype=_np.float32)
    dim = int(q.shape[0])
    if dim == 0:
        return [0.0] * len(vectors)
    q_norm = float(_np.linalg.norm(q)) or 1.0
    mat = _np.zeros((len(vectors), dim), dtype=_np.float32)
    for idx, vec in enumerate(vectors):
        n = min(dim, len(vec))
        if n:
            mat[idx, :n] = _np.asarray(vec[:n], dtype=_np.float32)
    norms = _np.linalg.norm(mat, axis=1)
    norms[norms == 0.0] = 1.0
    sims = (mat @ q) / (norms * q_norm)
    return [float(s) for s in sims.tolist()]


def _coerce_embedding(value: Any) -> list[float]:
    if value is None:
        return []
    if _np is not None and isinstance(value, _np.ndarray):
        return [float(item) for item in value.tolist()]
    if isinstance(value, (list, tuple)):
        return [float(item) for item in value if isinstance(item, (int, float))]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            return []
        if isinstance(parsed, list):
            return [float(item) for item in parsed if isinstance(item, (int, float))]
        return []
    # pgvector may hand back its own array-like type; fall back to iteration.
    try:
        return [float(item) for item in value]
    except Exception:
        return []


def _resolve_embedding_credentials(
    user_id: int,
    ai_config_id: Optional[int],
) -> tuple[str, str, str, int]:
    model = str(settings.embedding_model or "text-embedding-3-small").strip()
    dims = int(settings.embedding_dimensions or 1536)

    # Dedicated embedding credentials take priority over chat-model credentials.
    # This allows using OpenAI (or any embedding provider) for knowledge indexing
    # while the chat model may be Grok/xAI or another provider that has no
    # embedding endpoint.
    dedicated_key = str(settings.embedding_api_key or "").strip()
    dedicated_url = str(settings.embedding_base_url or "").strip()
    if dedicated_key and dedicated_url:
        return dedicated_key, dedicated_url, model, dims

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
        return "", "", model, dims

    api_key, base_url, _chat_model = resolve_model_preset(user, cfg)
    if not model:
        model = str(_chat_model or "text-embedding-3-small").strip()
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
    try:
        path = _topic_path(user_id, row.file_path)
        raw = _read_text(path)
        if raw is None:
            return ""
        _meta, body = _split_frontmatter(raw)
        return body.strip()
    except Exception as exc:  # bad file_path, traversal guard, read error etc.
        logger.info("knowledge_vector read_topic_body failed memory_id=%s: %s", getattr(row, 'memory_id', '?'), exc)
        return ""


def ensure_knowledge_embedding(
    session: Session,
    *,
    user_id: int,
    row: KnowledgeEntry,
    ai_config_id: Optional[int] = None,
    force: bool = False,
    creds: Optional[Tuple[str, str, str, int]] = None,
    commit: bool = True,
) -> bool:
    """Upsert a semantic index row for a single KnowledgeEntry.

    ``creds`` lets a batch caller resolve embedding credentials once and reuse
    them; ``commit=False`` defers the commit so the batch can flush in a single
    transaction.
    """

    api_key, base_url, model, dimensions = creds or _resolve_embedding_credentials(user_id, ai_config_id)
    body_text = _read_topic_body(user_id, row)
    embedded_text = _render_embedding_text(row, body_text=body_text)
    content_hash = _content_hash(row, body_text, model=model, dimensions=dimensions)
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
            if commit:
                session.commit()
        return False

    if not api_key or not base_url:
        # No embedding endpoint configured: leave the index untouched rather
        # than raising inside a batch backfill.
        return False

    # Only actually call the embedding API when dedicated embedding config is present.
    # This prevents noisy 404s when the main chat credentials (e.g. xAI/Grok) are used
    # as fallback but don't support /embeddings.
    dedicated_key = str(settings.embedding_api_key or "").strip()
    dedicated_url = str(settings.embedding_base_url or "").strip()
    if not (dedicated_key and dedicated_url):
        return False

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
    if commit:
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
        creds = _resolve_embedding_credentials(user_id, ai_config_id)
        api_key, base_url = creds[0], creds[1]
        if not api_key or not base_url:
            return 0
        rows = sess.exec(
            select(KnowledgeEntry).where(KnowledgeEntry.user_id == int(user_id))
        ).all()
        for row in rows:
            try:
                if ensure_knowledge_embedding(
                    sess,
                    user_id=int(user_id),
                    row=row,
                    ai_config_id=ai_config_id,
                    creds=creds,
                    force=force,
                    commit=False,
                ):
                    changed += 1
            except Exception as exc:
                logger.warning("knowledge_vector index failed user=%s memory_id=%s: %s", user_id, row.memory_id, exc)
        # Single commit for the whole batch (also flushes deferred snapshot
        # refreshes from unchanged rows).
        sess.commit()
        return changed
    finally:
        if own:
            sess.close()


def _backfill_missing_embeddings(
    session: Session,
    *,
    user_id: int,
    ai_config_id: Optional[int] = None,
) -> int:
    """Embed only KnowledgeEntries that have no index row yet.

    This is the cheap path used on the search hot route: unlike
    :func:`ensure_knowledge_embeddings` it does not read every topic file or
    re-hash already-indexed entries — write-time sync keeps those fresh.
    """
    creds = _resolve_embedding_credentials(user_id, ai_config_id)
    api_key, base_url = creds[0], creds[1]
    if not api_key or not base_url:
        return 0
    missing = session.exec(
        select(KnowledgeEntry)
        .outerjoin(KnowledgeEmbedding, KnowledgeEmbedding.memory_id == KnowledgeEntry.memory_id)
        .where(
            KnowledgeEntry.user_id == int(user_id),
            KnowledgeEntry.status == "active",
            KnowledgeEmbedding.id == None,  # noqa: E711 - SQL NULL check
        )
    ).all()
    changed = 0
    for row in missing:
        try:
            if ensure_knowledge_embedding(
                session,
                user_id=int(user_id),
                row=row,
                ai_config_id=ai_config_id,
                creds=creds,
                commit=False,
            ):
                changed += 1
        except Exception as exc:
            logger.warning("knowledge_vector backfill missing failed memory_id=%s: %s", row.memory_id, exc)
    if changed:
        session.commit()
    return changed


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


def _scope_conditions(scope: Optional[str], ai_config_id: Optional[int]):
    """SQL equivalent of :func:`_scope_match`, pushed into the WHERE clause.

    ``global`` topics are always visible; ``ai`` topics only when their
    ``scope_target`` matches the active AI; ``project`` topics only when the
    caller explicitly requests the project scope.
    """
    conditions = [KnowledgeEntry.scope == "global"]
    ai_match = None
    if ai_config_id is not None:
        ai_match = and_(
            KnowledgeEntry.scope == "ai",
            KnowledgeEntry.scope_target == str(ai_config_id),
        )
    if scope == "global":
        pass
    elif scope == "project":
        conditions.append(KnowledgeEntry.scope == "project")
    elif scope == "ai":
        if ai_match is not None:
            conditions.append(ai_match)
    else:  # no explicit scope → default visibility for the active AI
        if ai_match is not None:
            conditions.append(ai_match)
    return or_(*conditions)


def _vector_search_candidates(
    session: Session,
    *,
    user_id: int,
    query_vector: Sequence[float],
    scope: Optional[str],
    ai_config_id: Optional[int],
    candidate_limit: int,
) -> list[tuple[KnowledgeEntry, float]]:
    if _PGVECTOR:
        try:
            return _vector_search_candidates_sql(
                session,
                user_id=user_id,
                query_vector=query_vector,
                scope=scope,
                ai_config_id=ai_config_id,
                candidate_limit=candidate_limit,
            )
        except Exception as exc:
            logger.info("knowledge_vector pgvector search failed, falling back to scan: %s", exc)
    return _vector_search_candidates_python(
        session,
        user_id=user_id,
        query_vector=query_vector,
        scope=scope,
        ai_config_id=ai_config_id,
        candidate_limit=candidate_limit,
    )


def _vector_search_candidates_sql(
    session: Session,
    *,
    user_id: int,
    query_vector: Sequence[float],
    scope: Optional[str],
    ai_config_id: Optional[int],
    candidate_limit: int,
) -> list[tuple[KnowledgeEntry, float]]:
    """ANN retrieval via the pgvector cosine-distance operator.

    Filtering (user / status / scope) is pushed into SQL so ``ORDER BY
    distance LIMIT k`` returns the correct top-k without post-filtering.
    """
    distance = KnowledgeEmbedding.embedding.cosine_distance(list(query_vector)).label("distance")
    stmt = (
        select(KnowledgeEntry, distance)
        .join(KnowledgeEmbedding, KnowledgeEmbedding.memory_id == KnowledgeEntry.memory_id)
        .where(
            KnowledgeEntry.user_id == int(user_id),
            KnowledgeEmbedding.user_id == int(user_id),
            KnowledgeEntry.status == "active",
            KnowledgeEmbedding.embedding.isnot(None),
            _scope_conditions(scope, ai_config_id),
        )
        .order_by(distance)
        .limit(int(candidate_limit))
    )
    scored: list[tuple[KnowledgeEntry, float]] = []
    for row, dist in session.exec(stmt).all():
        if not isinstance(row, KnowledgeEntry):
            continue
        similarity = 1.0 - float(dist if dist is not None else 1.0)
        scored.append((row, similarity))
    return scored


def _vector_search_candidates_python(
    session: Session,
    *,
    user_id: int,
    query_vector: Sequence[float],
    scope: Optional[str],
    ai_config_id: Optional[int],
    candidate_limit: int,
) -> list[tuple[KnowledgeEntry, float]]:
    """In-process fallback when pgvector is unavailable (JSON backend).

    Scope/status/user filtering is still pushed into SQL; only the cosine
    ranking happens in Python (numpy-vectorised when available).
    """
    stmt = (
        select(KnowledgeEntry, KnowledgeEmbedding.embedding)
        .join(KnowledgeEmbedding, KnowledgeEmbedding.memory_id == KnowledgeEntry.memory_id)
        .where(
            KnowledgeEntry.user_id == int(user_id),
            KnowledgeEntry.status == "active",
            _scope_conditions(scope, ai_config_id),
        )
    )
    rows = session.exec(stmt).all()
    entries: list[KnowledgeEntry] = []
    vectors: list[list[float]] = []
    for item in rows:
        try:
            row = item[0]
            embedding = item[1]
        except Exception:
            continue
        if not isinstance(row, KnowledgeEntry):
            continue
        vector = _coerce_embedding(embedding)
        if not vector:
            continue
        entries.append(row)
        vectors.append(vector)
    sims = _batch_cosine(query_vector, vectors)
    scored = list(zip(entries, sims))
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

    try:
        with Session(engine) as session:
            try:
                # Hot path: only embed entries that have no index row yet. Existing
                # entries are kept fresh at write time (sync_topic_embedding_for_entry),
                # so we avoid re-reading every topic file on each search.
                _backfill_missing_embeddings(session, user_id=user_id, ai_config_id=ai_config_id)
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
            candidates: list[tuple[KnowledgeEntry, float, float]] = []
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
                except Exception as exc:
                    logger.info("knowledge_vector native search failed user=%s: %s", user_id, exc)

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
    except Exception as exc:
        logger.warning("knowledge_vector search_knowledge failed user=%s: %s", user_id, exc)
        return []


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
    try:
        items = search_knowledge(
                user_id=user_id,
                query=query,
                k=k,
                scope=scope,
                ai_config_id=ai_config_id,
                include_body=include_body,
        )
    except Exception as exc:
        logger.warning("knowledge.search internal error user=%s: %s", user_id, exc)
        items = []
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
            logger.warning("knowledge_vector sync failed user=%s memory_id=%s: %s", user_id, row.memory_id, exc)

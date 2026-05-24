"""图书管理员（Librarian）业务服务。

职责：
- 接受 AI 员工的"沉淀申请"（propose）→ 落 status=pending
- 接受用户的审批（approve/reject）
- 提供"咨询"（consult）：按 query 在 active 条目中检索
- 提供"主题列表"（list_topics）：渐进披露，只返标题+触发词

文件存储：<workspace_root>/KnowledgeBase/topics/<slug>.md
索引：KnowledgeEntry 表
注册表：<workspace_root>/KnowledgeBase/index.json（前端可选浏览）

参考：Claude Code Skills 的 progressive disclosure（先标题，再按需读全文）。
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
import uuid
from typing import Any, Dict, List, Optional

from sqlmodel import Session, select

from .database import engine
from .mcp.core import _resolve_ai_workspace, safe_join
from .models import AssistantAIConfig, KnowledgeEntry
from .sio import sio


_KB_DIR = "KnowledgeBase"
_TOPICS_DIR = "topics"
_ARCHIVE_DIR = "archives"
_INDEX_FILE = "index.json"
_MAX_SUMMARY_LEN = 240
_VALID_STATUSES = {"pending", "active", "archived", "rejected"}


# ---------- 路径与工具 ----------

def _kb_root(user_id: int) -> str:
    """每用户一份 KB（共享所有 AI，避免按 ai_config_id 切割）。
    复用主 librarian 配置或任意配置解析 workspace 即可。"""
    cfg_id = _pick_librarian_or_any_config_id(user_id) or 0
    ws = _resolve_ai_workspace(user_id, cfg_id) if cfg_id else _resolve_ai_workspace(user_id, None)
    root = os.path.join(ws, _KB_DIR)
    os.makedirs(root, exist_ok=True)
    os.makedirs(os.path.join(root, _TOPICS_DIR), exist_ok=True)
    os.makedirs(os.path.join(root, _ARCHIVE_DIR), exist_ok=True)
    return root


def _pick_librarian_or_any_config_id(user_id: int) -> Optional[int]:
    with Session(engine) as session:
        librarian = session.exec(
            select(AssistantAIConfig).where(
                AssistantAIConfig.user_id == user_id,
                AssistantAIConfig.is_librarian == True,  # noqa: E712
            )
        ).first()
        if librarian:
            return librarian.id
        any_cfg = session.exec(
            select(AssistantAIConfig).where(AssistantAIConfig.user_id == user_id)
            .order_by(AssistantAIConfig.sort_order.asc(), AssistantAIConfig.created_at.asc())
        ).first()
        return any_cfg.id if any_cfg else None


def get_librarian_config_id(user_id: int) -> Optional[int]:
    """返回当前 user 的图书管理员 ai_config_id；无则 None。"""
    with Session(engine) as session:
        row = session.exec(
            select(AssistantAIConfig).where(
                AssistantAIConfig.user_id == user_id,
                AssistantAIConfig.is_librarian == True,  # noqa: E712
            )
        ).first()
        return row.id if row else None


def _slugify(title: str) -> str:
    raw = (title or "").strip().lower()
    # 保留中英文与数字
    cleaned = re.sub(r"[^0-9a-z一-鿿]+", "-", raw)
    cleaned = cleaned.strip("-")
    if not cleaned:
        cleaned = "untitled"
    if len(cleaned) > 80:
        cleaned = cleaned[:80]
    return cleaned


def _new_memory_id() -> str:
    return f"mem_{uuid.uuid4().hex[:12]}"


def _normalize_triggers(value: Any) -> List[str]:
    if isinstance(value, list):
        items = [str(x).strip() for x in value if str(x).strip()]
    elif isinstance(value, str):
        items = [piece.strip() for piece in re.split(r"[,，;；\n]+", value) if piece.strip()]
    else:
        items = []
    seen = set()
    out: List[str] = []
    for item in items:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out[:20]


def _normalize_scope(scope: Any, scope_target: Any) -> tuple[str, Optional[str]]:
    raw = str(scope or "global").strip().lower()
    if raw not in {"global", "ai", "project"}:
        raw = "global"
    target = str(scope_target or "").strip() or None
    if raw == "global":
        return "global", None
    return raw, target


def _yaml_frontmatter(meta: Dict[str, Any]) -> str:
    lines = ["---"]
    for k, v in meta.items():
        if v is None:
            continue
        if isinstance(v, list):
            inline = ", ".join(json.dumps(x, ensure_ascii=False) for x in v)
            lines.append(f"{k}: [{inline}]")
        elif isinstance(v, bool):
            lines.append(f"{k}: {'true' if v else 'false'}")
        elif isinstance(v, str):
            esc = v.replace("\"", "\\\"")
            lines.append(f"{k}: \"{esc}\"")
        else:
            lines.append(f"{k}: {v}")
    lines.append("---")
    return "\n".join(lines)


def _short_summary(scenario: str, steps: List[str]) -> str:
    pieces: List[str] = []
    sc = (scenario or "").strip().replace("\n", " ")
    if sc:
        pieces.append(sc)
    if steps:
        first = (steps[0] or "").strip().replace("\n", " ")
        if first:
            pieces.append(f"步骤 1：{first}")
    text = " · ".join(pieces)
    if len(text) > _MAX_SUMMARY_LEN:
        text = text[:_MAX_SUMMARY_LEN] + "…"
    return text


# ---------- 文件写入 ----------

def _render_procedure_md(
    *,
    memory_id: str,
    title: str,
    triggers: List[str],
    scope: str,
    scope_target: Optional[str],
    scenario: str,
    steps: List[str],
    gotchas: List[str],
    status: str,
    confidence: float,
    source: Dict[str, Any],
    created_at: float,
    updated_at: float,
) -> str:
    fm = _yaml_frontmatter({
        "memory_id": memory_id,
        "title": title,
        "triggers": triggers,
        "scope": scope,
        "scope_target": scope_target,
        "status": status,
        "confidence": confidence,
        "source_job_id": source.get("job_id"),
        "source_generation": source.get("generation"),
        "source_ai_config_id": source.get("ai_config_id"),
        "source_message_id": source.get("message_id"),
        "created_at": created_at,
        "updated_at": updated_at,
    })
    blocks: List[str] = [fm, "", f"# {title}", ""]
    if scenario:
        blocks.append("## 场景 / 触发条件")
        blocks.append("")
        blocks.append(scenario.strip())
        blocks.append("")
    if steps:
        blocks.append("## 操作步骤")
        blocks.append("")
        for i, step in enumerate(steps, 1):
            blocks.append(f"{i}. {step.strip()}")
        blocks.append("")
    if gotchas:
        blocks.append("## 注意事项 / 已知坑")
        blocks.append("")
        for g in gotchas:
            blocks.append(f"- {g.strip()}")
        blocks.append("")
    return "\n".join(blocks)


def _safe_write(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def _topic_path(user_id: int, file_path: str) -> str:
    root = _kb_root(user_id)
    return safe_join(root, file_path)


# ---------- 索引文件 ----------

def _rebuild_index(user_id: int) -> None:
    """重写 KnowledgeBase/index.json（只含 active+pending，archived/rejected 不进）。"""
    try:
        root = _kb_root(user_id)
        with Session(engine) as session:
            rows = session.exec(
                select(KnowledgeEntry).where(
                    KnowledgeEntry.user_id == user_id,
                    KnowledgeEntry.status.in_(["active", "pending"]),
                ).order_by(KnowledgeEntry.created_at.desc())
            ).all()
            items = [
                {
                    "memory_id": r.memory_id,
                    "title": r.title,
                    "triggers": _split_csv(r.triggers),
                    "scope": r.scope,
                    "scope_target": r.scope_target,
                    "status": r.status,
                    "confidence": r.confidence,
                    "file_path": r.file_path,
                    "use_count": r.use_count,
                    "summary": r.summary,
                    "updated_at": r.updated_at,
                }
                for r in rows
            ]
        path = os.path.join(root, _INDEX_FILE)
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"items": items, "updated_at": time.time()}, f, ensure_ascii=False, indent=2)
    except Exception as exc:
        print(f"[librarian._rebuild_index] {exc}")


def _split_csv(value: str) -> List[str]:
    return [piece.strip() for piece in str(value or "").split(",") if piece.strip()]


# ---------- 公共接口 ----------

def propose(
    *,
    user_id: int,
    ai_config_id: Optional[int],
    title: str,
    scenario: str,
    steps: List[str],
    gotchas: Optional[List[str]] = None,
    triggers: Optional[List[str]] = None,
    scope: str = "global",
    scope_target: Optional[str] = None,
    source: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """AI 员工调用：申请沉淀。status=pending。

    实际文件落盘到 KnowledgeBase/topics/<slug>.md，
    DB 写入 KnowledgeEntry 一行。后续等待用户 approve。
    """
    title = (title or "").strip()
    if not title:
        raise ValueError("title is required")
    scenario = (scenario or "").strip()
    steps = [s for s in (steps or []) if str(s).strip()]
    if not steps:
        raise ValueError("at least one step is required")
    gotchas = [g for g in (gotchas or []) if str(g).strip()]
    triggers_norm = _normalize_triggers(triggers or [])
    scope_norm, scope_target_norm = _normalize_scope(scope, scope_target)
    source = dict(source or {})

    memory_id = _new_memory_id()
    slug = f"{_slugify(title)}-{memory_id[-6:]}"
    file_rel = f"{_TOPICS_DIR}/{slug}.md"
    now = time.time()
    md = _render_procedure_md(
        memory_id=memory_id,
        title=title,
        triggers=triggers_norm,
        scope=scope_norm,
        scope_target=scope_target_norm,
        scenario=scenario,
        steps=steps,
        gotchas=gotchas,
        status="pending",
        confidence=0.6,
        source=source,
        created_at=now,
        updated_at=now,
    )
    _safe_write(_topic_path(user_id, file_rel), md)

    with Session(engine) as session:
        librarian_id = get_librarian_config_id(user_id)
        row = KnowledgeEntry(
            memory_id=memory_id,
            user_id=user_id,
            title=title,
            triggers=",".join(triggers_norm),
            scope=scope_norm,
            scope_target=scope_target_norm,
            file_path=file_rel,
            summary=_short_summary(scenario, steps),
            status="pending",
            confidence=0.6,
            source_job_id=str(source.get("job_id") or "") or None,
            source_generation=int(source.get("generation") or 0) or None,
            source_ai_config_id=int(source.get("ai_config_id") or ai_config_id or 0) or None,
            source_message_id=int(source.get("message_id") or 0) or None,
            librarian_ai_config_id=librarian_id,
            created_at=now,
            updated_at=now,
        )
        session.add(row)
        session.commit()
        session.refresh(row)

    _rebuild_index(user_id)
    entry_dict = _entry_to_dict(row, with_body=False)
    _emit_proposal_event(user_id, "librarian:proposal_new", entry_dict)
    return entry_dict


def approve(
    *,
    user_id: int,
    memory_id: str,
    edited_content: Optional[str] = None,
) -> Dict[str, Any]:
    """用户审批通过。可选地用 edited_content 覆盖整份 markdown。"""
    with Session(engine) as session:
        row = session.exec(
            select(KnowledgeEntry).where(
                KnowledgeEntry.user_id == user_id,
                KnowledgeEntry.memory_id == memory_id,
            )
        ).first()
        if not row:
            raise ValueError("memory not found")
        if row.status not in {"pending", "active"}:
            raise ValueError(f"cannot approve from status={row.status}")
        row.status = "active"
        row.confidence = max(row.confidence, 1.0)
        row.updated_at = time.time()
        session.add(row)
        session.commit()
        session.refresh(row)
        if edited_content is not None:
            path = _topic_path(user_id, row.file_path)
            _safe_write(path, edited_content)
        out = _entry_to_dict(row, with_body=False)
    _rebuild_index(user_id)
    _emit_proposal_event(user_id, "librarian:proposal_resolved", out)
    return out


def reject(*, user_id: int, memory_id: str, reason: Optional[str] = None) -> Dict[str, Any]:
    with Session(engine) as session:
        row = session.exec(
            select(KnowledgeEntry).where(
                KnowledgeEntry.user_id == user_id,
                KnowledgeEntry.memory_id == memory_id,
            )
        ).first()
        if not row:
            raise ValueError("memory not found")
        row.status = "rejected"
        row.updated_at = time.time()
        session.add(row)
        session.commit()
        session.refresh(row)
        # 文件保留在 topics/ 但 index 不再包含；可后续手动归档
        if reason:
            # 在文件尾部追加 reject 原因，便于审计
            try:
                path = _topic_path(user_id, row.file_path)
                with open(path, "a", encoding="utf-8") as f:
                    f.write(f"\n\n<!-- rejected by user: {reason} at {time.time()} -->\n")
            except Exception:
                pass
        out = _entry_to_dict(row, with_body=False)
    _rebuild_index(user_id)
    _emit_proposal_event(user_id, "librarian:proposal_resolved", out)
    return out


def archive(*, user_id: int, memory_id: str) -> Dict[str, Any]:
    """归档：从 active 移到 archived，文件移到 archives/ 子目录。"""
    with Session(engine) as session:
        row = session.exec(
            select(KnowledgeEntry).where(
                KnowledgeEntry.user_id == user_id,
                KnowledgeEntry.memory_id == memory_id,
            )
        ).first()
        if not row:
            raise ValueError("memory not found")
        # 移动文件
        src = _topic_path(user_id, row.file_path)
        bucket = time.strftime("%Y-%m", time.localtime())
        dest_rel = f"{_ARCHIVE_DIR}/{bucket}/{os.path.basename(row.file_path)}"
        dest = _topic_path(user_id, dest_rel)
        try:
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            if os.path.exists(src):
                os.replace(src, dest)
        except Exception as exc:
            print(f"[librarian.archive] move file failed: {exc}")
        row.status = "archived"
        row.file_path = dest_rel
        row.updated_at = time.time()
        session.add(row)
        session.commit()
        session.refresh(row)
        out = _entry_to_dict(row, with_body=False)
    _rebuild_index(user_id)
    return out


def consult(
    *,
    user_id: int,
    query: str,
    scope: Optional[str] = None,
    ai_config_id: Optional[int] = None,
    k: int = 5,
) -> List[Dict[str, Any]]:
    """两阶段检索（P1 无 embedding 版）：

    Stage 1: 触发词与标题的关键词重叠打分
    Stage 2: 在 active + 满足 scope 的条目里取 top-k
    """
    query_norm = (query or "").strip()
    if not query_norm:
        return []
    q_tokens = _tokenize(query_norm)

    with Session(engine) as session:
        rows = session.exec(
            select(KnowledgeEntry).where(
                KnowledgeEntry.user_id == user_id,
                KnowledgeEntry.status == "active",
            )
        ).all()
        scored: List[tuple[float, KnowledgeEntry]] = []
        for r in rows:
            if not _scope_match(r, scope, ai_config_id):
                continue
            score = _score_entry(r, q_tokens, query_norm)
            if score <= 0:
                continue
            scored.append((score, r))
        scored.sort(key=lambda x: (-x[0], -x[1].updated_at))
        top = scored[: max(1, int(k))]

        # 更新 use_count
        now = time.time()
        for _, r in top:
            r.use_count += 1
            r.last_used_at = now
            session.add(r)
        session.commit()

        return [_entry_to_dict(r, with_body=True, user_id=user_id) for _, r in top]


def list_topics(
    *,
    user_id: int,
    scope: Optional[str] = None,
    status: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """渐进披露：只返标题 + 触发词 + 摘要，不返正文。"""
    target_status = status or "active"
    if target_status not in _VALID_STATUSES and target_status != "all":
        raise ValueError(f"invalid status: {target_status}")
    with Session(engine) as session:
        stmt = select(KnowledgeEntry).where(KnowledgeEntry.user_id == user_id)
        if target_status != "all":
            stmt = stmt.where(KnowledgeEntry.status == target_status)
        rows = session.exec(stmt.order_by(KnowledgeEntry.updated_at.desc())).all()
        out: List[Dict[str, Any]] = []
        for r in rows:
            if not _scope_match(r, scope, None):
                continue
            out.append({
                "memory_id": r.memory_id,
                "title": r.title,
                "triggers": _split_csv(r.triggers),
                "scope": r.scope,
                "scope_target": r.scope_target,
                "status": r.status,
                "confidence": r.confidence,
                "use_count": r.use_count,
                "summary": r.summary,
                "updated_at": r.updated_at,
            })
        return out


def brief(
    *,
    user_id: int,
    ai_config_id: Optional[int],
    task_title: str,
    task_instruction: str,
    k: int = 5,
    max_chars: int = 1200,
) -> str:
    """生成"任务派发前的预先简报"。

    算法：
    1. 取所有 active 条目；按"任务文本 ↔ 触发词/标题"重叠度排序
    2. 取 top-k；逐条压缩为 "- 【title】(memory_id)：summary"（最长 200 字符）
    3. 总字符上限 max_chars；不超则拼接，超则截尾并加省略
    4. 若全无命中返回空串（不强行注入空 Brief）
    """
    text_for_match = f"{task_title or ''} {task_instruction or ''}".strip()
    if not text_for_match:
        return ""
    lower = text_for_match.lower()
    q_tokens = _tokenize(text_for_match)

    with Session(engine) as session:
        rows = session.exec(
            select(KnowledgeEntry).where(
                KnowledgeEntry.user_id == user_id,
                KnowledgeEntry.status == "active",
            )
        ).all()
        scored: List[tuple[float, KnowledgeEntry]] = []
        for r in rows:
            if not _scope_match(r, None, ai_config_id):
                continue
            # brief 必须靠"声明式触发词命中"（类 Skills 风格），杜绝标题
            # 子串误命中带来的假阳性；否则 consult 才走更宽的 token 匹配。
            triggers = [t.lower() for t in _split_csv(r.triggers) if t.strip()]
            trigger_hits = sum(1 for t in triggers if t and t in lower)
            if trigger_hits <= 0:
                continue
            score = trigger_hits * 3.0
            scored.append((score, r))
        scored.sort(key=lambda x: (-x[0], -x[1].updated_at))
        top = scored[: max(1, int(k))]
        if not top:
            return ""

        lines: List[str] = []
        used = 0
        for _, r in top:
            summary = (r.summary or "").replace("\n", " ").strip()
            if len(summary) > 200:
                summary = summary[:200] + "…"
            line = f"- 【{r.title}】({r.memory_id})：{summary}"
            if used + len(line) + 1 > max_chars:
                lines.append("- …其余条目可调 `librarian.consult` 进一步查询")
                break
            lines.append(line)
            used += len(line) + 1
        return "\n".join(lines)


def read(
    *,
    user_id: int,
    memory_id: str,
) -> Dict[str, Any]:
    with Session(engine) as session:
        row = session.exec(
            select(KnowledgeEntry).where(
                KnowledgeEntry.user_id == user_id,
                KnowledgeEntry.memory_id == memory_id,
            )
        ).first()
        if not row:
            raise ValueError("memory not found")
        return _entry_to_dict(row, with_body=True, user_id=user_id)


def list_pending_for_review(*, user_id: int) -> List[Dict[str, Any]]:
    with Session(engine) as session:
        rows = session.exec(
            select(KnowledgeEntry).where(
                KnowledgeEntry.user_id == user_id,
                KnowledgeEntry.status == "pending",
            ).order_by(KnowledgeEntry.created_at.desc())
        ).all()
        return [_entry_to_dict(r, with_body=True, user_id=user_id) for r in rows]


# ---------- 内部工具 ----------

_WORD_PATTERN = re.compile(r"[一-鿿]|[A-Za-z0-9]+")


def _tokenize(text: str) -> List[str]:
    return [m.lower() for m in _WORD_PATTERN.findall(text or "")]


def _scope_match(row: KnowledgeEntry, scope: Optional[str], ai_config_id: Optional[int]) -> bool:
    if row.scope == "global":
        return True
    if scope:
        if scope == "global":
            return row.scope == "global"
        if scope == "ai" and row.scope == "ai":
            return str(row.scope_target or "") == str(ai_config_id or "")
        if scope == "project" and row.scope == "project":
            return True  # 项目级先放过，未来加 project_id 匹配
    if row.scope == "ai" and ai_config_id is not None:
        return str(row.scope_target or "") == str(ai_config_id)
    return False


def _score_entry(row: KnowledgeEntry, q_tokens: List[str], query_text: str) -> float:
    if not q_tokens:
        return 0.0
    hay_pieces = [
        row.title or "",
        row.triggers or "",
        row.summary or "",
    ]
    hay = " ".join(hay_pieces).lower()
    score = 0.0
    # 触发词命中权重更高
    triggers = [t.lower() for t in _split_csv(row.triggers)]
    for t in triggers:
        if t and t in query_text.lower():
            score += 2.0
    # 标题/摘要 token 命中
    for tk in q_tokens:
        if tk in hay:
            score += 1.0
    # 长度惩罚极弱，避免噪声
    return score


def _entry_to_dict(
    row: KnowledgeEntry,
    *,
    with_body: bool = False,
    user_id: Optional[int] = None,
) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "memory_id": row.memory_id,
        "title": row.title,
        "triggers": _split_csv(row.triggers),
        "scope": row.scope,
        "scope_target": row.scope_target,
        "status": row.status,
        "confidence": row.confidence,
        "use_count": row.use_count,
        "last_used_at": row.last_used_at,
        "file_path": row.file_path,
        "summary": row.summary,
        "source_job_id": row.source_job_id,
        "source_generation": row.source_generation,
        "source_ai_config_id": row.source_ai_config_id,
        "source_message_id": row.source_message_id,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }
    if with_body and user_id is not None:
        try:
            path = _topic_path(user_id, row.file_path)
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    out["body"] = f.read()
        except Exception:
            out["body"] = ""
    return out


def _emit_proposal_event(user_id: int, event: str, entry: Dict[str, Any]) -> None:
    """从 sync 上下文向 user 房间广播事件。

    - 若已在事件循环里（如 MCP handler 在异步栈中调用过来）：用
      asyncio.create_task 把 emit 排到当前 loop
    - 若不在事件循环里（如 HTTP 同步路由）：fire-and-forget 一个临时线程
    """
    payload = {
        "userId": user_id,
        "event": event,
        "entry": entry,
        "timestamp": time.time(),
    }
    room = f"user_{user_id}"

    async def _do_emit():
        try:
            await sio.emit(event, payload, room=room)
        except Exception as exc:
            print(f"[librarian._emit_proposal_event] {event}: {exc}")

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_do_emit())
    except RuntimeError:
        # 不在事件循环中（同步路由）— fire-and-forget
        import threading
        def _runner():
            try:
                asyncio.run(_do_emit())
            except Exception as exc:
                print(f"[librarian._emit_proposal_event] runner: {exc}")
        threading.Thread(target=_runner, daemon=True).start()

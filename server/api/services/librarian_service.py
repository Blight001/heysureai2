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

from ..database import engine
from ..mcp.core import _resolve_ai_workspace, safe_join
from ..models import AssistantAIConfig, KnowledgeEntry
from ..sio import sio


_KB_DIR = "KnowledgeBase"
_TOPICS_DIR = "topics"
_ARCHIVE_DIR = "archives"
_INDEX_FILE = "index.json"
_MAX_SUMMARY_LEN = 240
_VALID_STATUSES = {"pending", "active", "archived", "rejected"}
_BUILTIN_UPDATED_AT = 1893456000.0  # 2030-01-01, keeps built-in categories at the top.
_BUILTIN_ENTRIES = {
    "builtin.intrinsic_properties": {
        "title": "固有属性",
        "triggers": ["固有属性", "固定MCP", "MCP工具"],
        "summary": "系统固定 MCP 工具清单及其描述。",
    },
    "builtin.intrinsic_personas": {
        "title": "固有人格",
        "triggers": ["固有人格", "AI人格", "Prompt"],
        "summary": "当前所有 AI 的人格 prompt 与自动控制 prompt 内容。",
    },
    "builtin.inheritance_skills": {
        "title": "传承技能",
        "triggers": ["传承技能", "Python脚本", "技能沉淀"],
        "summary": "预留给后续沉淀的 Python 脚本技能，目前为空。",
    },
    "builtin.inheritance_tools": {
        "title": "传承工具",
        "triggers": ["传承工具", "Markdown文件", "工具沉淀"],
        "summary": "预留给后续沉淀的 Markdown 工具文档，目前为空。",
    },
}


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


def _builtin_entries(*, user_id: Optional[int] = None, with_body: bool = False) -> List[Dict[str, Any]]:
    return [
        item
        for memory_id in (
            "builtin.intrinsic_properties",
            "builtin.intrinsic_personas",
            "builtin.inheritance_skills",
            "builtin.inheritance_tools",
        )
        if (item := _builtin_entry(memory_id, user_id=user_id, with_body=with_body)) is not None
    ]


def _builtin_entry(memory_id: str, *, user_id: Optional[int] = None, with_body: bool = False) -> Optional[Dict[str, Any]]:
    meta = _BUILTIN_ENTRIES.get(str(memory_id or ""))
    if not meta:
        return None
    out: Dict[str, Any] = {
        "memory_id": memory_id,
        "title": meta["title"],
        "triggers": list(meta["triggers"]),
        "scope": "global",
        "scope_target": None,
        "status": "active",
        "confidence": 1.0,
        "use_count": 0,
        "last_used_at": None,
        "file_path": "",
        "summary": meta["summary"],
        "source_job_id": None,
        "source_generation": None,
        "source_ai_config_id": None,
        "source_message_id": None,
        "created_at": _BUILTIN_UPDATED_AT,
        "updated_at": _BUILTIN_UPDATED_AT,
    }
    if with_body:
        if memory_id == "builtin.intrinsic_properties":
            intrinsic = _intrinsic_properties_payload()
            out["intrinsic_properties"] = intrinsic
            out["body"] = _render_intrinsic_properties_body(intrinsic)
        elif memory_id == "builtin.intrinsic_personas":
            personas = _intrinsic_personas_payload(int(user_id or 0))
            out["intrinsic_personas"] = personas
            out["body"] = _render_intrinsic_personas_body(personas)
        elif memory_id == "builtin.inheritance_skills":
            out["body"] = ""
        elif memory_id == "builtin.inheritance_tools":
            out["body"] = ""
    return out


def _intrinsic_properties_payload() -> Dict[str, Any]:
    from ..mcp import registry

    tools = sorted(registry.list_tools(), key=lambda item: str(item.get("name") or ""))
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for tool in tools:
        name = str(tool.get("name") or "").strip()
        namespace = name.split(".", 1)[0] if "." in name else "other"
        input_schema = tool.get("inputSchema") if isinstance(tool.get("inputSchema"), dict) else {}
        grouped.setdefault(namespace, []).append({
            "name": name,
            "description": str(tool.get("description") or "").strip(),
            "inputSchema": input_schema,
            "parameters": _mcp_schema_parameter_rows(input_schema),
            "destructive": bool(tool.get("destructive")),
        })

    categories = [
        {
            "namespace": namespace,
            "count": len(items),
            "tools": items,
        }
        for namespace, items in sorted(grouped.items())
    ]
    return {
        "description": "系统当前固定注册的 MCP 工具及其描述如下。",
        "total": len(tools),
        "categories": categories,
    }


def _mcp_schema_parameter_rows(schema: Dict[str, Any]) -> List[Dict[str, Any]]:
    properties = schema.get("properties") if isinstance(schema, dict) else {}
    if not isinstance(properties, dict):
        properties = {}
    required = schema.get("required") if isinstance(schema, dict) else []
    required_set = {str(item) for item in required if str(item).strip()} if isinstance(required, list) else set()
    rows: List[Dict[str, Any]] = []
    for name, config in properties.items():
        cfg = config if isinstance(config, dict) else {}
        raw_type = cfg.get("type", "")
        if isinstance(raw_type, list):
            type_name = " | ".join(str(item) for item in raw_type if str(item).strip())
        else:
            type_name = str(raw_type or "").strip()
        rows.append({
            "name": str(name),
            "type": type_name or "any",
            "required": str(name) in required_set,
            "description": str(cfg.get("description") or "").strip(),
        })
    rows.sort(key=lambda item: (not bool(item.get("required")), str(item.get("name") or "")))
    return rows


def _render_intrinsic_properties_body(payload: Optional[Dict[str, Any]] = None) -> str:
    data = payload or _intrinsic_properties_payload()
    lines = [
        "# 固有属性",
        "",
        str(data.get("description") or ""),
        "",
        f"工具总数：{int(data.get('total') or 0)}",
        "",
    ]
    for category in data.get("categories") or []:
        namespace = str(category.get("namespace") or "")
        lines.append(f"## {namespace}")
        lines.append("")
        for tool in category.get("tools") or []:
            name = str(tool.get("name") or "").strip()
            description = str(tool.get("description") or "").strip() or "（无描述）"
            destructive = "（可能产生写入/变更）" if tool.get("destructive") else ""
            lines.append(f"- `{name}`{destructive}: {description}")
            params = tool.get("parameters") if isinstance(tool.get("parameters"), list) else []
            if params:
                for param in params:
                    required = "必填" if param.get("required") else "可选"
                    param_name = str(param.get("name") or "").strip()
                    param_type = str(param.get("type") or "any").strip()
                    param_desc = str(param.get("description") or "").strip() or "（无描述）"
                    lines.append(f"  - 参数 `{param_name}` ({param_type}, {required}): {param_desc}")
            else:
                lines.append("  - 参数：无")
        lines.append("")
    return "\n".join(lines).strip()


def _intrinsic_personas_payload(user_id: int) -> Dict[str, Any]:
    with Session(engine) as session:
        rows = session.exec(
            select(AssistantAIConfig)
            .where(AssistantAIConfig.user_id == user_id)
            .order_by(AssistantAIConfig.sort_order.asc(), AssistantAIConfig.created_at.asc())
        ).all()

    agents: List[Dict[str, Any]] = []
    for cfg in rows:
        auto_prompts: List[Dict[str, str]] = []
        try:
            parsed = json.loads(cfg.system_auto_control or "{}")
            if isinstance(parsed, dict):
                labels = {
                    "start_task_prompt": "任务启动 Prompt",
                    "resume_task_prompt": "任务恢复 Prompt",
                    "supervision_prompt": "监督 Prompt",
                    "inheritance_notice": "传承提醒 Prompt",
                }
                for key, label in labels.items():
                    value = str(parsed.get(key) or "").strip()
                    if value:
                        auto_prompts.append({"key": key, "label": label, "content": value})
        except Exception:
            raw = str(cfg.system_auto_control or "").strip()
            if raw:
                auto_prompts.append({"key": "system_auto_control", "label": "自动控制 Prompt 原文", "content": raw})

        agents.append({
            "id": cfg.id,
            "name": cfg.name,
            "description": cfg.description,
            "role": cfg.ai_role,
            "digital_member_role": cfg.digital_member_role,
            "is_librarian": bool(cfg.is_librarian),
            "enabled": bool(cfg.enabled),
            "model": cfg.model,
            "platform": cfg.platform,
            "generation": cfg.generation,
            "prompt": str(cfg.prompt or "").strip(),
            "auto_prompts": auto_prompts,
            "updated_at": cfg.updated_at,
        })

    return {
        "description": "当前用户下所有 AI 的固定人格与系统自动控制 prompt 内容如下。",
        "total": len(agents),
        "agents": agents,
    }


def _render_intrinsic_personas_body(payload: Dict[str, Any]) -> str:
    lines = [
        "# 固有人格",
        "",
        str(payload.get("description") or ""),
        "",
        f"AI 总数：{int(payload.get('total') or 0)}",
        "",
    ]
    for agent in payload.get("agents") or []:
        lines.append(f"## {agent.get('name') or agent.get('id')}")
        lines.append("")
        lines.append(f"- ID：{agent.get('id')}")
        lines.append(f"- 角色：{agent.get('role') or ''}")
        lines.append(f"- 模型：{agent.get('model') or ''}")
        lines.append("")
        lines.append("### 人格 Prompt")
        lines.append("")
        lines.append(str(agent.get("prompt") or "（空）"))
        lines.append("")
        for prompt in agent.get("auto_prompts") or []:
            lines.append(f"### {prompt.get('label') or prompt.get('key')}")
            lines.append("")
            lines.append(str(prompt.get("content") or "（空）"))
            lines.append("")
    return "\n".join(lines).strip()


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
    out: List[Dict[str, Any]] = []
    if target_status in {"active", "all"} and (scope in {None, "", "global"}):
        out.extend(_builtin_entries(user_id=user_id, with_body=False))
    with Session(engine) as session:
        stmt = select(KnowledgeEntry).where(KnowledgeEntry.user_id == user_id)
        if target_status != "all":
            stmt = stmt.where(KnowledgeEntry.status == target_status)
        rows = session.exec(stmt.order_by(KnowledgeEntry.updated_at.desc())).all()
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
    builtin = _builtin_entry(memory_id, user_id=user_id, with_body=True)
    if builtin is not None:
        return builtin
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

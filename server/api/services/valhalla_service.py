"""英灵殿（Valhalla）落盘服务。

设计原则：
- 真相在文件（Valhalla/<job_id>/g<N>/*.md + *.json），数据库 ValhallaEntry 仅做检索索引；
- 后端钩子自动写入，AI 无感（不依赖 AI 自觉调任何工具）；
- 任一步出错都不应影响主任务链路：所有写入都包在 best-effort try。

参考：Anthropic Claude Memory Tool 的"文件式记忆目录"范式。
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any, Dict, List, Optional

from sqlmodel import Session, select

from ..database import engine
from ..mcp.core import _resolve_ai_workspace, safe_join
from ..models import (
    AITaskJob,
    AssistantAIConfig,
    ChatMessage,
    ValhallaEntry,
)


_VALHALLA_DIR = "Valhalla"
_REGISTRY_FILE = "memorial_registry.json"
_MAX_EXCERPT_LEN = 280


# ---------- 路径工具 ----------

def _valhalla_root(user_id: int, ai_config_id: int) -> str:
    """返回 <workspace_root>/Valhalla 的绝对路径，必要时创建。"""
    ws = _resolve_ai_workspace(user_id, ai_config_id)
    root = os.path.join(ws, _VALHALLA_DIR)
    os.makedirs(root, exist_ok=True)
    return root


def _job_dir(user_id: int, ai_config_id: int, job_id: str) -> str:
    root = _valhalla_root(user_id, ai_config_id)
    safe_id = _safe_slug(job_id) or "unknown"
    job_dir = safe_join(root, safe_id)
    os.makedirs(job_dir, exist_ok=True)
    return job_dir


def _gen_dir(user_id: int, ai_config_id: int, job_id: str, generation: int) -> str:
    base = _job_dir(user_id, ai_config_id, job_id)
    gen = f"g{max(1, int(generation or 1))}"
    gen_dir = safe_join(base, gen)
    os.makedirs(gen_dir, exist_ok=True)
    return gen_dir


def _safe_slug(text: str) -> str:
    raw = str(text or "").strip()
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", raw)
    return cleaned.strip("._") or ""


def _rel_to_valhalla(user_id: int, ai_config_id: int, abs_path: str) -> str:
    root = _valhalla_root(user_id, ai_config_id)
    rel = os.path.relpath(abs_path, root)
    return rel.replace(os.sep, "/")


# ---------- 数据采集 ----------

def _session_messages(
    session: Session,
    user_id: int,
    ai_config_id: int,
    session_id: str,
) -> List[ChatMessage]:
    if not session_id:
        return []
    return list(session.exec(
        select(ChatMessage).where(
            ChatMessage.user_id == user_id,
            ChatMessage.ai_config_id == ai_config_id,
            ChatMessage.session_id == session_id,
        ).order_by(ChatMessage.created_at.asc())
    ).all())


def _session_token_total(messages: List[ChatMessage]) -> int:
    return int(sum(int(m.total_tokens or 0) for m in messages))


_WRITE_TOOL_NAMES = {
    "workspace.run_command",
}


def _extract_artifacts(messages: List[ChatMessage]) -> List[Dict[str, Any]]:
    """从助手消息的 MCP 调用块里粗略提取产出/变更项。

    只看 <mcp-call>{ "tool": "workspace.*" }</mcp-call> 的 JSON 形式，
    够用即可——目的是给"未来代"一个可见的变更清单。
    """
    artifacts: List[Dict[str, Any]] = []
    pattern = re.compile(r"<mcp[-_]call>\s*([\s\S]*?)\s*</mcp[-_]call>", re.IGNORECASE)
    for msg in messages:
        if (msg.role or "") != "assistant":
            continue
        for block in pattern.findall(msg.content or ""):
            tool, args = _parse_mcp_block(block)
            if not tool or tool not in _WRITE_TOOL_NAMES:
                continue
            artifacts.append({
                "tool": tool,
                "path": _pick_artifact_path(tool, args),
                "args_preview": _short_json(args, 240),
                "message_id": msg.id,
                "created_at": msg.created_at,
            })
    return artifacts


def _parse_mcp_block(block: str) -> tuple[str, Dict[str, Any]]:
    text = (block or "").strip()
    if not text:
        return "", {}
    # JSON form: {"tool":"...","arguments":{...}}
    if text.startswith("{"):
        try:
            obj = json.loads(text)
            tool = str(obj.get("tool") or "").strip()
            args = obj.get("arguments")
            return tool, args if isinstance(args, dict) else {}
        except Exception:
            return "", {}
    # XML-like: <tool>...</tool><arguments>{...}</arguments>
    m_tool = re.search(r"<tool>\s*([^<]+?)\s*</tool>", text)
    m_args = re.search(r"<arguments>\s*([\s\S]*?)\s*</arguments>", text)
    tool = (m_tool.group(1).strip() if m_tool else "")
    args: Dict[str, Any] = {}
    if m_args:
        try:
            parsed = json.loads(m_args.group(1).strip())
            if isinstance(parsed, dict):
                args = parsed
        except Exception:
            args = {}
    return tool, args


def _pick_artifact_path(tool: str, args: Dict[str, Any]) -> str:
    if not isinstance(args, dict):
        return ""
    if tool == "workspace.run_command":
        return str(args.get("command") or args.get("cmd") or "")
    return ""


def _short_json(obj: Any, limit: int) -> str:
    try:
        text = json.dumps(obj, ensure_ascii=False)
    except Exception:
        text = str(obj)
    if len(text) > limit:
        return text[:limit] + "…"
    return text


def _extract_unfinished(summary: str) -> List[str]:
    """从 summary 中粗略抽出"未完成 / 风险"条目。

    匹配规则：在中文/英文小标题（未完成、风险、阻塞、unfinished、risk、blocker）下
    出现的连续以 -/*/数字打头的行。失败则返回空。
    """
    src = str(summary or "")
    if not src:
        return []
    lines = src.splitlines()
    out: List[str] = []
    capture = False
    header_pat = re.compile(r"^[\s#>*-]*(未完成|风险|阻塞|未尽|遗留|todo|unfinished|risk|blocker)", re.IGNORECASE)
    item_pat = re.compile(r"^\s*[-*•\d.\)）]+\s+(.+)$")
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if capture and out:
                # blank line after some items ends the section
                capture = False
            continue
        if header_pat.match(stripped):
            capture = True
            continue
        if capture:
            m = item_pat.match(line)
            if m:
                text = m.group(1).strip()
                if text:
                    out.append(text)
            elif stripped.startswith("#"):
                capture = False
    return out[:20]


# ---------- 模板渲染 ----------

def _yaml_frontmatter(meta: Dict[str, Any]) -> str:
    lines = ["---"]
    for k, v in meta.items():
        if v is None:
            continue
        if isinstance(v, str):
            esc = v.replace("\"", "\\\"")
            lines.append(f"{k}: \"{esc}\"")
        elif isinstance(v, bool):
            lines.append(f"{k}: {'true' if v else 'false'}")
        else:
            lines.append(f"{k}: {v}")
    lines.append("---")
    return "\n".join(lines)


def _render_last_words(
    *,
    job: AITaskJob,
    cfg: AssistantAIConfig,
    generation: int,
    summary: str,
    token_used: int,
    artifacts: List[Dict[str, Any]],
    unfinished: List[str],
    created_at: float,
) -> str:
    fm = _yaml_frontmatter({
        "kind": "inherit",
        "job_id": job.job_id,
        "job_title": job.title,
        "generation": generation,
        "ai_config_id": cfg.id,
        "ai_name": _ai_name_static(cfg),
        "token_used": token_used,
        "token_limit": int(cfg.token_limit or 0),
        "created_at": created_at,
    })
    blocks: List[str] = [fm, ""]
    blocks.append(f"# 第 {generation} 代 · {_ai_name_static(cfg)} 的传承遗言")
    blocks.append("")
    blocks.append("## 本代传承摘要")
    blocks.append("")
    blocks.append(summary.strip() or "（未提供摘要）")
    blocks.append("")
    if unfinished:
        blocks.append("## 未完成 / 风险（结构化提取）")
        blocks.append("")
        for item in unfinished:
            blocks.append(f"- {item}")
        blocks.append("")
    if artifacts:
        blocks.append("## 本代变更/产出（来自 workspace.* 调用）")
        blocks.append("")
        for art in artifacts[:30]:
            tool = art.get("tool") or ""
            path = art.get("path") or ""
            if path:
                blocks.append(f"- `{tool}` → `{path}`")
            else:
                blocks.append(f"- `{tool}` → {art.get('args_preview') or ''}")
        if len(artifacts) > 30:
            blocks.append(f"- …其余 {len(artifacts) - 30} 项见 artifacts.json")
        blocks.append("")
    blocks.append("## Token 生命周期")
    blocks.append("")
    blocks.append(f"- 本代消耗：{token_used}")
    blocks.append(f"- 上限：{int(cfg.token_limit or 0)}")
    blocks.append("")
    return "\n".join(blocks)


def _render_final_words(
    *,
    job: AITaskJob,
    cfg: AssistantAIConfig,
    generation: int,
    summary: str,
    token_used: int,
    created_at: float,
) -> str:
    fm = _yaml_frontmatter({
        "kind": "complete",
        "job_id": job.job_id,
        "job_title": job.title,
        "generation": generation,
        "ai_config_id": cfg.id,
        "ai_name": _ai_name_static(cfg),
        "token_used": token_used,
        "token_limit": int(cfg.token_limit or 0),
        "created_at": created_at,
    })
    blocks: List[str] = [fm, ""]
    blocks.append(f"# 第 {generation} 代 · {_ai_name_static(cfg)} 任务完成总结")
    blocks.append("")
    blocks.append("## 任务结论")
    blocks.append("")
    blocks.append(summary.strip() or "（AI 未提供完成摘要）")
    blocks.append("")
    blocks.append("## Token 生命周期")
    blocks.append("")
    blocks.append(f"- 本代消耗：{token_used}")
    blocks.append(f"- 上限：{int(cfg.token_limit or 0)}")
    blocks.append("")
    return "\n".join(blocks)


def _ai_name_static(cfg: AssistantAIConfig) -> str:
    return str(cfg.name or "").strip() or f"AI-{cfg.id}"


# ---------- 注册表维护 ----------

def _read_registry(root: str) -> Dict[str, Any]:
    path = os.path.join(root, _REGISTRY_FILE)
    if not os.path.exists(path):
        return {"entries": []}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"entries": []}
        entries = data.get("entries")
        if not isinstance(entries, list):
            data["entries"] = []
        return data
    except Exception:
        return {"entries": []}


def _write_registry(root: str, data: Dict[str, Any]) -> None:
    path = os.path.join(root, _REGISTRY_FILE)
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def _append_to_registry(root: str, entry_meta: Dict[str, Any]) -> None:
    data = _read_registry(root)
    entries = data.setdefault("entries", [])
    entries.append(entry_meta)
    data["updated_at"] = time.time()
    _write_registry(root, data)


def _write_job_meta_once(job_dir: str, job: AITaskJob, cfg: AssistantAIConfig) -> None:
    path = os.path.join(job_dir, "job_meta.json")
    if os.path.exists(path):
        return
    meta = {
        "job_id": job.job_id,
        "title": job.title,
        "instruction": job.instruction,
        "ai_config_id": cfg.id,
        "ai_name": _ai_name_static(cfg),
        "created_at": job.created_at,
    }
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def _excerpt(text: str) -> str:
    raw = (text or "").strip().replace("\n", " ")
    if len(raw) > _MAX_EXCERPT_LEN:
        return raw[:_MAX_EXCERPT_LEN] + "…"
    return raw


# ---------- 公共写入入口 ----------

def write_inherit(
    *,
    user_id: int,
    ai_config_id: int,
    job_id: str,
    generation: int,
    session_id: str,
    summary: str,
) -> Optional[ValhallaEntry]:
    """task.inherit 成功后调用。落 last_words.md + unfinished/artifacts/token_report
    + ValhallaEntry 索引 + memorial_registry.json 追加。
    """
    try:
        with Session(engine) as session:
            cfg = session.exec(
                select(AssistantAIConfig).where(
                    AssistantAIConfig.user_id == user_id,
                    AssistantAIConfig.id == ai_config_id,
                )
            ).first()
            if not cfg:
                return None
            job = session.exec(
                select(AITaskJob).where(
                    AITaskJob.user_id == user_id,
                    AITaskJob.ai_config_id == ai_config_id,
                    AITaskJob.job_id == job_id,
                )
            ).first()
            if not job:
                return None

            messages = _session_messages(session, user_id, ai_config_id, session_id)
            token_used = _session_token_total(messages)
            artifacts = _extract_artifacts(messages)
            unfinished = _extract_unfinished(summary)
            created_at = time.time()

            gen_dir = _gen_dir(user_id, ai_config_id, job_id, generation)
            _write_job_meta_once(_job_dir(user_id, ai_config_id, job_id), job, cfg)

            last_words_md = _render_last_words(
                job=job, cfg=cfg, generation=generation, summary=summary,
                token_used=token_used, artifacts=artifacts, unfinished=unfinished,
                created_at=created_at,
            )
            _safe_write(os.path.join(gen_dir, "last_words.md"), last_words_md)
            _safe_write_json(os.path.join(gen_dir, "unfinished.json"), {"items": unfinished})
            _safe_write_json(os.path.join(gen_dir, "artifacts.json"), {"items": artifacts})
            _safe_write_json(os.path.join(gen_dir, "token_report.json"), {
                "token_used": token_used,
                "token_limit": int(cfg.token_limit or 0),
                "message_count": len(messages),
            })

            rel_path = _rel_to_valhalla(user_id, ai_config_id, os.path.join(gen_dir, "last_words.md"))
            entry = ValhallaEntry(
                user_id=user_id,
                ai_config_id=ai_config_id,
                ai_name=_ai_name_static(cfg),
                job_id=job_id,
                job_title=str(job.title or ""),
                generation=int(generation or 1),
                kind="inherit",
                session_id=session_id,
                file_path=rel_path,
                summary_excerpt=_excerpt(summary),
                token_used=token_used,
                token_limit=int(cfg.token_limit or 0),
                artifacts_count=len(artifacts),
                unfinished_count=len(unfinished),
                created_at=created_at,
            )
            session.add(entry)
            session.commit()
            session.refresh(entry)

            _append_to_registry(_valhalla_root(user_id, ai_config_id), {
                "entry_id": entry.id,
                "kind": "inherit",
                "job_id": job_id,
                "generation": generation,
                "ai_config_id": ai_config_id,
                "file_path": rel_path,
                "created_at": created_at,
            })
            return entry
    except Exception as exc:
        # best-effort：英灵殿写失败不应阻塞主任务
        print(f"[valhalla.write_inherit] error: {exc}")
        return None


def write_complete(
    *,
    user_id: int,
    ai_config_id: int,
    job_id: str,
    generation: int,
    session_id: Optional[str],
    summary: str,
) -> Optional[ValhallaEntry]:
    """task.complete 成功后调用。"""
    try:
        with Session(engine) as session:
            cfg = session.exec(
                select(AssistantAIConfig).where(
                    AssistantAIConfig.user_id == user_id,
                    AssistantAIConfig.id == ai_config_id,
                )
            ).first()
            if not cfg:
                return None
            job = session.exec(
                select(AITaskJob).where(
                    AITaskJob.user_id == user_id,
                    AITaskJob.ai_config_id == ai_config_id,
                    AITaskJob.job_id == job_id,
                )
            ).first()
            if not job:
                return None

            messages = _session_messages(session, user_id, ai_config_id, session_id or "")
            token_used = _session_token_total(messages)
            created_at = time.time()

            gen_dir = _gen_dir(user_id, ai_config_id, job_id, generation)
            _write_job_meta_once(_job_dir(user_id, ai_config_id, job_id), job, cfg)

            final_words_md = _render_final_words(
                job=job, cfg=cfg, generation=generation, summary=summary,
                token_used=token_used, created_at=created_at,
            )
            _safe_write(os.path.join(gen_dir, "final_words.md"), final_words_md)

            rel_path = _rel_to_valhalla(user_id, ai_config_id, os.path.join(gen_dir, "final_words.md"))
            entry = ValhallaEntry(
                user_id=user_id,
                ai_config_id=ai_config_id,
                ai_name=_ai_name_static(cfg),
                job_id=job_id,
                job_title=str(job.title or ""),
                generation=int(generation or 1),
                kind="complete",
                session_id=session_id,
                file_path=rel_path,
                summary_excerpt=_excerpt(summary),
                token_used=token_used,
                token_limit=int(cfg.token_limit or 0),
                created_at=created_at,
            )
            session.add(entry)
            session.commit()
            session.refresh(entry)

            _append_to_registry(_valhalla_root(user_id, ai_config_id), {
                "entry_id": entry.id,
                "kind": "complete",
                "job_id": job_id,
                "generation": generation,
                "ai_config_id": ai_config_id,
                "file_path": rel_path,
                "created_at": created_at,
            })
            return entry
    except Exception as exc:
        print(f"[valhalla.write_complete] error: {exc}")
        return None


# ---------- 读取接口 ----------

def list_entries(
    *,
    user_id: int,
    ai_config_id: Optional[int] = None,
    job_id: Optional[str] = None,
    limit: int = 200,
) -> List[Dict[str, Any]]:
    with Session(engine) as session:
        stmt = select(ValhallaEntry).where(ValhallaEntry.user_id == user_id)
        if ai_config_id is not None:
            stmt = stmt.where(ValhallaEntry.ai_config_id == ai_config_id)
        if job_id:
            stmt = stmt.where(ValhallaEntry.job_id == job_id)
        stmt = stmt.order_by(ValhallaEntry.created_at.desc()).limit(max(1, int(limit)))
        rows = session.exec(stmt).all()
        return [_entry_to_dict(r) for r in rows]


def read_entry_file(
    *,
    user_id: int,
    entry_id: int,
) -> Dict[str, Any]:
    with Session(engine) as session:
        row = session.get(ValhallaEntry, entry_id)
        if not row or row.user_id != user_id:
            raise FileNotFoundError("entry not found")
        root = _valhalla_root(user_id, row.ai_config_id)
        abs_path = safe_join(root, row.file_path)
        content = ""
        if os.path.exists(abs_path):
            try:
                with open(abs_path, "r", encoding="utf-8") as f:
                    content = f.read()
            except Exception:
                content = ""
        # 同代目录下的附加 json
        gen_dir = os.path.dirname(abs_path)
        sidecars = {}
        for name in ("unfinished.json", "artifacts.json", "token_report.json"):
            p = os.path.join(gen_dir, name)
            if os.path.exists(p):
                try:
                    with open(p, "r", encoding="utf-8") as f:
                        sidecars[name] = json.load(f)
                except Exception:
                    pass
        return {
            "entry": _entry_to_dict(row),
            "content": content,
            "sidecars": sidecars,
        }


def _entry_to_dict(row: ValhallaEntry) -> Dict[str, Any]:
    return {
        "id": row.id,
        "user_id": row.user_id,
        "ai_config_id": row.ai_config_id,
        "ai_name": row.ai_name,
        "job_id": row.job_id,
        "job_title": row.job_title,
        "generation": row.generation,
        "kind": row.kind,
        "session_id": row.session_id,
        "file_path": row.file_path,
        "summary_excerpt": row.summary_excerpt,
        "token_used": row.token_used,
        "token_limit": row.token_limit,
        "artifacts_count": row.artifacts_count,
        "unfinished_count": row.unfinished_count,
        "reason": row.reason,
        "created_at": row.created_at,
    }


# ---------- 文件写入 ----------

def _safe_write(path: str, text: str) -> None:
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
    except Exception as exc:
        print(f"[valhalla._safe_write] {path}: {exc}")


def _safe_write_json(path: str, data: Any) -> None:
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as exc:
        print(f"[valhalla._safe_write_json] {path}: {exc}")

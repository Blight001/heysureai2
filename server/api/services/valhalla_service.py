"""英灵殿（Valhalla）代际传承服务。

设计原则：
- 数据全部存数据库（``ValhallaEntry``）：完整遗言正文存 ``content``，未完成/
  产出/Token 统计存对应的 ``*_json`` 列。不再落任何文件。
- 后端钩子自动写入，AI 无感（不依赖 AI 自觉调任何工具）；
- 任一步出错都不应影响主任务链路：所有写入都包在 best-effort try。
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Dict, List, Optional

from sqlmodel import Session, select

from ..database import engine
from ..models import (
    AITaskJob,
    AssistantAIConfig,
    ChatMessage,
    ValhallaEntry,
)
from . import kb_store


logger = logging.getLogger(__name__)

_MAX_EXCERPT_LEN = 280


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
            blocks.append(f"- …其余 {len(artifacts) - 30} 项见 artifacts 列表")
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
    """task.inherit 成功后调用。把传承遗言正文 + 未完成/产出/Token 统计
    全部写入 ``ValhallaEntry``。"""
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

            content = _render_last_words(
                job=job, cfg=cfg, generation=generation, summary=summary,
                token_used=token_used, artifacts=artifacts, unfinished=unfinished,
                created_at=created_at,
            )
            token_report = {
                "token_used": token_used,
                "token_limit": int(cfg.token_limit or 0),
                "message_count": len(messages),
            }

            entry = ValhallaEntry(
                user_id=user_id,
                ai_config_id=ai_config_id,
                ai_name=_ai_name_static(cfg),
                job_id=job_id,
                job_title=str(job.title or ""),
                generation=int(generation or 1),
                kind="inherit",
                session_id=session_id,
                content=content,
                unfinished_json=json.dumps(unfinished, ensure_ascii=False),
                artifacts_json=json.dumps(artifacts, ensure_ascii=False),
                token_report_json=json.dumps(token_report, ensure_ascii=False),
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
            kb_store.write_valhalla_file(user_id, kb_store._row_valhalla_dict(entry))  # 镜像成文件
            return entry
    except Exception as exc:
        # best-effort：英灵殿写失败不应阻塞主任务
        logger.exception(f"error: {exc}")
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

            content = _render_final_words(
                job=job, cfg=cfg, generation=generation, summary=summary,
                token_used=token_used, created_at=created_at,
            )
            token_report = {
                "token_used": token_used,
                "token_limit": int(cfg.token_limit or 0),
                "message_count": len(messages),
            }

            entry = ValhallaEntry(
                user_id=user_id,
                ai_config_id=ai_config_id,
                ai_name=_ai_name_static(cfg),
                job_id=job_id,
                job_title=str(job.title or ""),
                generation=int(generation or 1),
                kind="complete",
                session_id=session_id,
                content=content,
                token_report_json=json.dumps(token_report, ensure_ascii=False),
                summary_excerpt=_excerpt(summary),
                token_used=token_used,
                token_limit=int(cfg.token_limit or 0),
                created_at=created_at,
            )
            session.add(entry)
            session.commit()
            session.refresh(entry)
            kb_store.write_valhalla_file(user_id, kb_store._row_valhalla_dict(entry))  # 镜像成文件
            return entry
    except Exception as exc:
        logger.exception(f"error: {exc}")
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
    """返回单条英灵殿事件的完整正文 + 附属结构（全部来自数据库）。

    ``sidecars`` 沿用旧文件名作为 key，保持前端零改动。
    """
    with Session(engine) as session:
        row = session.get(ValhallaEntry, entry_id)
        if not row or row.user_id != user_id:
            raise FileNotFoundError("entry not found")

        sidecars: Dict[str, Any] = {}
        unfinished = _safe_load_json(row.unfinished_json, default=[])
        if unfinished:
            sidecars["unfinished.json"] = {"items": unfinished}
        artifacts = _safe_load_json(row.artifacts_json, default=[])
        if artifacts:
            sidecars["artifacts.json"] = {"items": artifacts}
        token_report = _safe_load_json(row.token_report_json, default={})
        if token_report:
            sidecars["token_report.json"] = token_report

        return {
            "entry": _entry_to_dict(row),
            "content": row.content or "",
            "sidecars": sidecars,
        }


def delete_entries(
    *,
    user_id: int,
    entry_ids: List[int],
) -> Dict[str, Any]:
    ids = [int(x) for x in entry_ids if int(x) > 0]
    if not ids:
        return {"deleted": 0, "missing": [], "deleted_ids": []}

    deleted_ids: List[int] = []
    missing: List[int] = []

    with Session(engine) as session:
        for entry_id in ids:
            row = session.get(ValhallaEntry, entry_id)
            if not row or row.user_id != user_id:
                missing.append(entry_id)
                continue
            session.delete(row)
            deleted_ids.append(entry_id)
        session.commit()

    for entry_id in deleted_ids:
        kb_store.delete_valhalla_file(user_id, entry_id)  # 同步删除镜像文件

    return {"deleted": len(deleted_ids), "missing": missing, "deleted_ids": deleted_ids}


def load_previous_unfinished(
    *,
    user_id: int,
    ai_config_id: int,
    job_id: str,
    generation: int,
) -> List[str]:
    """读取某任务上一代（``generation - 1``）的未完成清单。"""
    if generation <= 1 or not job_id:
        return []
    with Session(engine) as session:
        row = session.exec(
            select(ValhallaEntry).where(
                ValhallaEntry.user_id == user_id,
                ValhallaEntry.ai_config_id == ai_config_id,
                ValhallaEntry.job_id == job_id,
                ValhallaEntry.generation == int(generation - 1),
                ValhallaEntry.kind == "inherit",
            ).order_by(ValhallaEntry.created_at.desc())
        ).first()
        if not row:
            return []
        items = _safe_load_json(row.unfinished_json, default=[])
    return [str(i).strip() for i in items if str(i).strip()][:20] if isinstance(items, list) else []


def _safe_load_json(raw: Optional[str], *, default: Any) -> Any:
    try:
        value = json.loads(raw or "")
    except Exception:
        return default
    return value if value is not None else default


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

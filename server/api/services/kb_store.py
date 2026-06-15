"""KnowledgeBase 文件存储层（真相源）。

把原本散落在数据库 / 硬编码里的五类资产统一落成 ``KnowledgeBase/`` 下的分类
Markdown 文件，并让文件成为运行时的真相源：

    KnowledgeBase/
    ├── personas/<id>-<名>.md      固有人格：每个 AI 一个人格 Prompt
    ├── mcp/<namespace>/<tool>.md  固有技能：每个 MCP 工具的介绍与参数
    ├── system/<key>.md            固有思路：每个系统提示一个 md
    ├── skills/                    传承技能（沿用 inheritance_thoughts 落盘，目录占位）
    └── topics/<slug>.md           传承知识（KnowledgeEntry，已是 md）

设计原则（安全优先）：

* **Prompt 文件是真相源**：``personas/`` 和 ``system/`` 运行时直接读文件。
* **数据库保存结构化数据**：AI 元数据、数值设置、Memory 和 EvolutionInput 仍按需入库。
* **Prompt 写入可验证**：上层接口写入文件后应回读确认，不应吞掉 IO 失败。
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import time
from typing import Any, Dict, List, Optional, Tuple

from sqlmodel import Session, select

from ..core.config import _ai_dir_slug, user_shared_knowledge_dir
from ..database import engine
from ..models import AssistantAIConfig, EvolutionInput, Memory, User
from ..models import defaults as _defaults

logger = logging.getLogger(__name__)

# 系统提示字段的内置默认值（列已物理删除后，新用户的 system/*.md 由此播种，
# 运行时文件缺失也回退到这里）。键与 SYSTEM_PROMPT_KEYS 对齐。
_SYSTEM_PROMPT_DEFAULTS: Dict[str, str] = {
    "admin_prompt": "你是一个全能的管理员，负责管理和协调整个项目。",
    "mcp_call_method": _defaults.DEFAULT_MCP_CALL_METHOD,
    "mcp_namespace_hints": _defaults.DEFAULT_MCP_NAMESPACE_HINTS,
    "mcp_dynamic_rule": _defaults.DEFAULT_MCP_DYNAMIC_RULE,
    "mcp_format_error_hint": _defaults.DEFAULT_MCP_FORMAT_ERROR_HINT,
    "default_start_task_prompt": _defaults.DEFAULT_START_TASK_PROMPT,
    "default_resume_task_prompt": _defaults.DEFAULT_RESUME_TASK_PROMPT,
    "default_supervision_prompt": _defaults.DEFAULT_SUPERVISION_PROMPT,
    "default_compression_prompt": _defaults.DEFAULT_COMPRESSION_PROMPT,
    "prompt_ai_message_notify": _defaults.DEFAULT_AI_MESSAGE_NOTIFY_TEMPLATE,
    "prompt_ai_message_inquiry": _defaults.DEFAULT_AI_MESSAGE_INQUIRY_TEMPLATE,
    "prompt_ai_message_inquiry_reminder": _defaults.DEFAULT_AI_MESSAGE_INQUIRY_REMINDER,
    "prompt_ai_message_reply": _defaults.DEFAULT_AI_MESSAGE_REPLY_TEMPLATE,
    "prompt_ai_message_chitchat": _defaults.DEFAULT_AI_MESSAGE_CHITCHAT_TEMPLATE,
    "prompt_ai_message_reply_success": _defaults.DEFAULT_AI_MESSAGE_REPLY_SUCCESS,
    "prompt_user_message_notice": _defaults.DEFAULT_USER_MESSAGE_NOTICE,
}


# ---------- 目录布局 ----------

PERSONAS_DIR = "personas"
MCP_DIR = "mcp"
SYSTEM_DIR = "system"
SKILLS_DIR = "skills"
TOPICS_DIR = "topics"
MEMORIES_DIR = "memories"
EVOLUTION_DIR = "evolution"

# system/ 下每个文件对应一个文本类系统提示。键集合与
# librarian_service._SYSTEM_PROMPT_SECTIONS 的文本项对齐。数值设置项
# （default_supervision_idle_seconds / ai_message_inquiry_reminder_seconds /
# mcp_max_steps 等）是配置而非提示词，仍留在数据库，不在此列。
SYSTEM_PROMPT_KEYS: Tuple[Tuple[str, str], ...] = (
    ("admin_prompt", "text"),
    ("mcp_call_method", "text"),
    ("mcp_namespace_hints", "text"),
    ("mcp_dynamic_rule", "text"),
    ("mcp_format_error_hint", "text"),
    ("default_start_task_prompt", "text"),
    ("default_resume_task_prompt", "text"),
    ("default_supervision_prompt", "text"),
    ("default_compression_prompt", "text"),
    ("prompt_ai_message_notify", "text"),
    ("prompt_ai_message_inquiry", "text"),
    ("prompt_ai_message_inquiry_reminder", "text"),
    ("prompt_ai_message_reply", "text"),
    ("prompt_ai_message_chitchat", "text"),
    ("prompt_ai_message_reply_success", "text"),
    ("prompt_user_message_notice", "text"),
)
_SYSTEM_PROMPT_TYPE = {key: kind for key, kind in SYSTEM_PROMPT_KEYS}

# Markdown 内部用 ``## @key`` 分隔不同 Prompt 段，round-trip 稳定。
_PERSONA_SECTIONS: Tuple[Tuple[str, str], ...] = (
    ("prompt", "人格 Prompt"),
)
_LEGACY_AGENT_THOUGHT_KEYS = (
    "start_task_prompt",
    "resume_task_prompt",
    "supervision_prompt",
    "compression_prompt",
)
_GLOBAL_TASK_PROMPT_KEYS = {
    "start_task_prompt": "default_start_task_prompt",
    "resume_task_prompt": "default_resume_task_prompt",
    "supervision_prompt": "default_supervision_prompt",
    "compression_prompt": "default_compression_prompt",
}


# ---------- 基础 IO ----------

def _kb_root(user_id: int) -> str:
    return user_shared_knowledge_dir(int(user_id))


def _ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def _read_text(path: str) -> Optional[str]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return None
    except Exception as exc:  # pragma: no cover - defensive
        logger.info(f"kb_store read {path} failed: {exc}")
        return None


def _write_text(path: str, content: str) -> None:
    _ensure_dir(os.path.dirname(path))
    tmp = f"{path}.tmp.{os.getpid()}.{int(time.time()*1000)}"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(content)
    os.replace(tmp, path)


def _safe_filename(name: str) -> str:
    return _ai_dir_slug(name)


# ---------- frontmatter ----------

def _split_frontmatter(text: str) -> Tuple[Dict[str, str], str]:
    """解析顶部 ``---`` frontmatter（仅支持简单 ``key: value``）。"""
    src = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    if not src.startswith("---\n"):
        return {}, src
    end = src.find("\n---\n", 4)
    if end < 0:
        return {}, src
    head = src[4:end]
    body = src[end + 5:]
    meta: Dict[str, str] = {}
    for line in head.split("\n"):
        if ":" in line:
            key, _, value = line.partition(":")
            meta[key.strip()] = value.strip()
    return meta, body.lstrip("\n")


def _build_frontmatter(meta: Dict[str, Any]) -> str:
    lines = ["---"]
    for key, value in meta.items():
        lines.append(f"{key}: {value}")
    lines.append("---")
    return "\n".join(lines) + "\n"


# ============================================================
# 1) 系统提示（固有思路）—— system/<key>.md
# ============================================================

def _system_path(user_id: int, key: str) -> str:
    return os.path.join(_kb_root(user_id), SYSTEM_DIR, f"{key}.md")


def read_system_prompt(user_id: int, key: str) -> Optional[str]:
    """返回文件内容（去掉 frontmatter）；文件不存在返回 None。"""
    raw = _read_text(_system_path(user_id, key))
    if raw is None:
        return None
    _meta, body = _split_frontmatter(raw)
    return body.strip()


def write_system_prompt(user_id: int, key: str, value: Any) -> None:
    if key not in _SYSTEM_PROMPT_TYPE:
        return
    header = _build_frontmatter({"key": key, "type": _SYSTEM_PROMPT_TYPE[key]})
    _write_text(_system_path(user_id, key), header + "\n" + str(value if value is not None else "") + "\n")


def seed_system_prompts(user_id: int, user: User) -> None:
    """首次迁移 / 新用户：把系统提示写成文件（已存在的跳过）。

    列存在时用其值；列已物理删除（或为空）时回退到内置默认。"""
    for key, kind in SYSTEM_PROMPT_KEYS:
        if _read_text(_system_path(user_id, key)) is not None:
            continue
        if kind == "number":
            value = getattr(user, key, "")
        else:
            value = getattr(user, key, None)
            if value in (None, ""):
                value = _SYSTEM_PROMPT_DEFAULTS.get(key, "")
        write_system_prompt(user_id, key, value)


# ============================================================
# 2) 固有人格（AI prompt）—— personas/<id>-<名>.md
# ============================================================

def _persona_path(user_id: int, cfg_id: int, name: str) -> str:
    fname = f"{int(cfg_id)}-{_safe_filename(name)}.md"
    return os.path.join(_kb_root(user_id), PERSONAS_DIR, fname)


def _render_persona_fields(cfg_id: Any, name: str, role: str, prompt: str) -> str:
    header = _build_frontmatter({"id": cfg_id, "name": name, "role": role})
    parts: List[str] = [header]
    values = {"prompt": str(prompt or "")}
    for key, label in _PERSONA_SECTIONS:
        parts.append(f"## @{key} {label}\n\n{values.get(key, '').strip()}\n")
    return "\n".join(parts).strip() + "\n"


def _render_persona(cfg: AssistantAIConfig, prompt: Optional[str] = None) -> str:
    if prompt is None:
        prompt = getattr(cfg, "prompt", None)
    return _render_persona_fields(cfg.id, cfg.name, getattr(cfg, "ai_role", ""), prompt or "")


def _parse_persona(text: str) -> Tuple[Dict[str, str], Dict[str, str]]:
    """返回 (frontmatter, {section_key: content})。"""
    meta, body = _split_frontmatter(text)
    sections: Dict[str, str] = {}
    # 按 ``## @key`` 切分；标题行后面可带一个中文 label，忽略之。
    chunks = re.split(r"\n##\s*@", "\n" + body)
    for chunk in chunks:
        chunk = chunk.strip("\n")
        if not chunk:
            continue
        first_nl = chunk.find("\n")
        header_line = chunk if first_nl < 0 else chunk[:first_nl]
        content = "" if first_nl < 0 else chunk[first_nl + 1:]
        key = header_line.strip().split()[0] if header_line.strip() else ""
        if key:
            sections[key] = content.strip()
    return meta, sections


def write_persona(user_id: int, cfg: AssistantAIConfig, prompt: Optional[str] = None) -> None:
    # cfg.prompt 列已物理删除：写入时优先用显式 prompt，其次保留文件中既有的人格段。
    if prompt is None and getattr(cfg, "prompt", None) is None:
        prompt = effective_ai_prompt(user_id, cfg)
    target = _persona_path(user_id, cfg.id, cfg.name)
    _write_text(target, _render_persona(cfg, prompt=prompt))
    # 清理该 AI 改名后遗留的旧文件，避免同一 id 出现多个文件造成同步歧义。
    _prune_stale_personas(user_id, cfg.id, keep=target)


def seed_persona_raw(user_id: int, cfg_id: Any, name: str, role: str, prompt: str, auto_control_json: str) -> None:
    """迁移用：将 AI 人格落盘（已存在则跳过）。"""
    _ = auto_control_json
    path = _persona_path(user_id, cfg_id, name)
    if _read_text(path) is None:
        _write_text(path, _render_persona_fields(cfg_id, name, role, prompt or ""))


def user_prompt_dict(user: User) -> Dict[str, str]:
    """返回该用户 16 个文本系统提示的有效值（文件优先），用于拼装 API 响应，
    不依赖在 ORM 实例上设置瞬态属性。"""
    uid = getattr(user, "id", 0)
    out: Dict[str, str] = {}
    for key, _kind in SYSTEM_PROMPT_KEYS:
        try:
            out[key] = effective_system_value(uid, key, getattr(user, key, None))
        except Exception:
            out[key] = _SYSTEM_PROMPT_DEFAULTS.get(key, "")
    return out


def _prune_stale_personas(user_id: int, cfg_id: int, keep: str) -> None:
    root = os.path.join(_kb_root(user_id), PERSONAS_DIR)
    prefix = f"{int(cfg_id)}-"
    keep_abs = os.path.abspath(keep)
    try:
        for fname in os.listdir(root):
            if not fname.endswith(".md") or not fname.startswith(prefix):
                continue
            path = os.path.join(root, fname)
            if os.path.abspath(path) == keep_abs:
                continue
            try:
                os.remove(path)
            except Exception:
                pass
    except Exception:
        pass


def cleanup_legacy_agent_thoughts(user_id: int, session: Optional[Session] = None) -> None:
    """Remove obsolete per-AI task prompts after switching to unified control."""
    from .task_system import compact_system_auto_control

    own = session is None
    sess = session or Session(engine)
    changed = False
    try:
        rows = sess.exec(
            select(AssistantAIConfig).where(AssistantAIConfig.user_id == int(user_id))
        ).all()
        for cfg in rows:
            compacted = compact_system_auto_control(cfg.system_auto_control)
            if compacted != str(cfg.system_auto_control or ""):
                cfg.system_auto_control = compacted
                sess.add(cfg)
                changed = True
            persona_path = _persona_path(user_id, cfg.id, cfg.name)
            persona_raw = _read_text(persona_path)
            if persona_raw is not None:
                _meta, sections = _parse_persona(persona_raw)
                if any(key in sections for key in _LEGACY_AGENT_THOUGHT_KEYS):
                    _write_text(persona_path, _render_persona_fields(
                        cfg.id,
                        cfg.name,
                        getattr(cfg, "ai_role", ""),
                        sections.get("prompt", ""),
                    ))
        legacy_dir = os.path.join(_kb_root(user_id), SYSTEM_DIR, "agents")
        if os.path.isdir(legacy_dir):
            shutil.rmtree(legacy_dir)
        if changed:
            sess.commit()
    except Exception as exc:  # pragma: no cover - defensive
        logger.info(f"kb_store cleanup_legacy_agent_thoughts user={user_id} failed: {exc}")
    finally:
        if own:
            sess.close()


def seed_personas(user_id: int, session: Optional[Session] = None) -> None:
    own = session is None
    sess = session or Session(engine)
    try:
        rows = sess.exec(
            select(AssistantAIConfig).where(AssistantAIConfig.user_id == int(user_id))
        ).all()
        for cfg in rows:
            if _read_text(_persona_path(user_id, cfg.id, cfg.name)) is None:
                write_persona(user_id, cfg)
    except Exception as exc:  # pragma: no cover - defensive
        logger.info(f"kb_store seed_personas user={user_id} failed: {exc}")
    finally:
        if own:
            sess.close()


# ---------- 直接读文件的运行时访问器（文件优先，缺失时回退内置默认） ----------

def effective_ai_prompt(user_id: int, cfg: Any) -> str:
    """AI 人格 Prompt：直接读 personas/*.md；文件缺失时回退空串。

    ``cfg.prompt`` 列已物理删除，这里的 ``getattr`` 仅为兼容仍带瞬态
    ``prompt`` 属性的旧对象，正常运行时恒为空。"""
    if user_id and cfg is not None and getattr(cfg, "id", None) is not None:
        raw = _read_text(_persona_path(int(user_id), cfg.id, cfg.name))
        if raw is not None:
            try:
                _meta, sections = _parse_persona(raw)
                if "prompt" in sections:
                    return sections["prompt"]
            except Exception:
                pass
    return str(getattr(cfg, "prompt", "") or "") if cfg is not None else ""


def effective_auto_control_json(user_id: int, cfg: Any) -> str:
    """Return per-AI switches/tasks with unified user-level task prompts injected."""
    base = str(getattr(cfg, "system_auto_control", "") or "") if cfg is not None else ""
    try:
        auto = json.loads(base or "{}")
        if not isinstance(auto, dict):
            auto = {}
    except Exception:
        auto = {}
    for key, system_key in _GLOBAL_TASK_PROMPT_KEYS.items():
        auto[key] = effective_system_value(user_id, system_key)
    return json.dumps(auto, ensure_ascii=False)


def effective_system_value(user_id: int, key: str, fallback: Any = None) -> str:
    """系统提示：读 system/<key>.md；文件缺失时回退传入值或内置默认。"""
    if user_id:
        body = read_system_prompt(int(user_id), key)
        if body is not None:
            return body
    fb = str(fallback) if fallback not in (None, "") else ""
    if fb:
        return fb
    return _SYSTEM_PROMPT_DEFAULTS.get(key, "")


# ============================================================
# 3) 固有技能（MCP 介绍 / 参数）—— mcp/<namespace>/<tool>.md
# ============================================================

def _mcp_namespace(name: str) -> str:
    return name.split(".", 1)[0] if "." in name else "other"


def _mcp_path(user_id: int, name: str) -> str:
    return os.path.join(_kb_root(user_id), MCP_DIR, _mcp_namespace(name), f"{name}.md")


def _render_mcp_tool(name: str, description: str, parameters: List[Dict[str, Any]], destructive: bool) -> str:
    header = _build_frontmatter({"name": name, "destructive": "true" if destructive else "false"})
    lines = [header, "## @description 工具介绍", "", str(description or "").strip(), "", "## @parameters 参数说明", ""]
    if parameters:
        for param in parameters:
            pname = str(param.get("name") or "").strip()
            ptype = str(param.get("type") or "any").strip()
            required = "必填" if param.get("required") else "可选"
            pdesc = str(param.get("description") or "").strip()
            lines.append(f"- `{pname}` ({ptype}, {required}): {pdesc}")
    else:
        lines.append("（无参数）")
    return "\n".join(lines).strip() + "\n"


_MCP_PARAM_RE = re.compile(r"^-\s*`([^`]+)`\s*\(([^,]+),\s*([^)]+)\):\s*(.*)$")


def _parse_mcp_tool(text: str) -> Tuple[str, Dict[str, str]]:
    """返回 (description, {param_name: description})。"""
    _meta, body = _split_frontmatter(text)
    chunks = re.split(r"\n##\s*@", "\n" + body)
    description = ""
    params: Dict[str, str] = {}
    for chunk in chunks:
        chunk = chunk.strip("\n")
        if not chunk:
            continue
        first_nl = chunk.find("\n")
        header_line = (chunk if first_nl < 0 else chunk[:first_nl]).strip()
        content = "" if first_nl < 0 else chunk[first_nl + 1:]
        key = header_line.split()[0] if header_line else ""
        if key == "description":
            description = content.strip()
        elif key == "parameters":
            for line in content.splitlines():
                m = _MCP_PARAM_RE.match(line.strip())
                if m:
                    params[m.group(1).strip()] = m.group(4).strip()
    return description, params


def effective_tool_description(user_id: int, name: str, raw: str) -> str:
    """工具描述：文件优先，缺失回退传入的 raw（注册表原始描述）。"""
    if not user_id:
        return str(raw or "").strip()
    text = _read_text(_mcp_path(user_id, name))
    if text is None:
        return str(raw or "").strip()
    try:
        description, _params = _parse_mcp_tool(text)
        return description or str(raw or "").strip()
    except Exception:
        return str(raw or "").strip()


def effective_param_descriptions(user_id: int, name: str) -> Dict[str, str]:
    """参数描述覆盖：文件优先；缺失返回空 dict（交由调用方回退）。"""
    if not user_id:
        return {}
    text = _read_text(_mcp_path(user_id, name))
    if text is None:
        return {}
    try:
        _description, params = _parse_mcp_tool(text)
        return params
    except Exception:
        return {}


def seed_mcp_tools(user_id: int, tools: List[Dict[str, Any]], param_rows_fn) -> None:
    """首次迁移：把注册表工具导出成 md（已存在的跳过）。

    ``param_rows_fn(name, input_schema) -> List[param dict]`` 由调用方注入，
    复用 librarian 现有的参数行渲染，避免本模块依赖 registry。
    """
    for tool in tools or []:
        name = str(tool.get("name") or "").strip()
        if not name:
            continue
        path = _mcp_path(user_id, name)
        if _read_text(path) is not None:
            continue
        schema = tool.get("inputSchema") if isinstance(tool.get("inputSchema"), dict) else {}
        try:
            params = param_rows_fn(name, schema)
        except Exception:
            params = []
        _write_text(path, _render_mcp_tool(
            name,
            str(tool.get("description") or "").strip(),
            params or [],
            bool(tool.get("destructive")),
        ))


def write_mcp_tool(user_id: int, name: str, description: str, parameters: List[Dict[str, Any]], destructive: bool) -> None:
    _write_text(_mcp_path(user_id, name), _render_mcp_tool(name, description, parameters, destructive))


# ============================================================
# 4) README
# ============================================================

_README = """# KnowledgeBase

本目录是该用户所有 AI 共享的知识与配置真相源。子目录：

- `personas/`  固有人格：每个 AI 的人格 Prompt（文件名 `<id>-<名>.md`）。
- `mcp/`       固有技能：每个 MCP 工具的介绍与参数（按 namespace 分目录）。
- `system/`    固有思路：所有 AI 统一使用的系统级提示词。
- `skills/`    传承技能：沉淀的技能卡。
- `topics/`    传承知识：流程性知识条目。

运行时以本目录文件为准：每次对话 / 任务启动会把 `personas/` 与 `system/`
的内容同步回数据库；通过界面保存配置时会同时写回这里的文件。
"""


# ============================================================
# 6) 记忆 / 进化建议 —— memories/<id>.md, evolution/<id>.md
#
# Memory 与 EvolutionInput 原本是纯数据库表。这里沿用 kb_store 的
# “文件为真相源 + DB 兜底” 模式：每次增删改时双写文件，``ensure_user_kb``
# 时先把缺失文件从 DB 导出（seed），再把文件回写 DB（sync，文件赢）。
# 现有的 MCP 读取链路（memory.py 的 search/list）仍走 DB，无需改动即可
# 读到文件内容。frontmatter 每个值用 JSON 编码，保证 round-trip 稳定。
# ============================================================


def _row_to_md(meta: Dict[str, Any], body: str) -> str:
    """frontmatter（值 JSON 编码）+ 正文。"""
    lines = ["---"]
    for key, value in meta.items():
        lines.append(f"{key}: {json.dumps(value, ensure_ascii=False)}")
    lines.append("---")
    return "\n".join(lines) + "\n" + (body or "")


def _md_to_row(text: str) -> Tuple[Dict[str, Any], str]:
    """解析 ``_row_to_md`` 写出的文件：frontmatter 值按 JSON 解码。"""
    meta_raw, body = _split_frontmatter(text)
    meta: Dict[str, Any] = {}
    for key, value in meta_raw.items():
        try:
            meta[key] = json.loads(value)
        except Exception:
            meta[key] = value
    return meta, body


def _memory_path(user_id: int, memory_id: str) -> str:
    return os.path.join(_kb_root(user_id), MEMORIES_DIR, f"{_safe_filename(memory_id)}.md")


def write_memory_file(user_id: int, mem: Dict[str, Any]) -> None:
    """把一条 Memory（``_memory_to_dict`` 的输出）落成文件。best-effort。"""
    try:
        memory_id = str(mem.get("memory_id") or "").strip()
        if not memory_id:
            return
        meta = {
            "memory_id": memory_id,
            "ai_config_id": mem.get("ai_config_id"),
            "project_id": mem.get("project_id"),
            "job_id": mem.get("job_id"),
            "generation": mem.get("generation"),
            "kind": mem.get("kind"),
            "tags": mem.get("tags") or [],
            "confidence": mem.get("confidence"),
            "archived": bool(mem.get("archived")),
            "source": mem.get("source") or {},
            "created_at": mem.get("created_at"),
            "updated_at": mem.get("updated_at"),
        }
        _write_text(_memory_path(user_id, memory_id), _row_to_md(meta, str(mem.get("content") or "")))
    except Exception as exc:  # pragma: no cover - defensive
        logger.info(f"kb_store write_memory_file user={user_id} failed: {exc}")


def _evolution_path(user_id: int, evo_id: str) -> str:
    return os.path.join(_kb_root(user_id), EVOLUTION_DIR, f"{_safe_filename(evo_id)}.md")


def write_evolution_file(user_id: int, evo: Dict[str, Any]) -> None:
    """把一条 EvolutionInput（``_evolution_to_dict`` 的输出）落成文件。best-effort。"""
    try:
        evo_id = str(evo.get("evolution_input_id") or "").strip()
        if not evo_id:
            return
        meta = {
            "evolution_input_id": evo_id,
            "source_ai_config_id": evo.get("source_ai_config_id"),
            "type": evo.get("type"),
            "target_scope": evo.get("target_scope") or {},
            "evidence": evo.get("evidence") or [],
            "risk": evo.get("risk") or "",
            "review_status": evo.get("review_status"),
            "applied_to": evo.get("applied_to"),
            "created_at": evo.get("created_at"),
            "updated_at": evo.get("updated_at"),
        }
        _write_text(_evolution_path(user_id, evo_id), _row_to_md(meta, str(evo.get("proposal") or "")))
    except Exception as exc:  # pragma: no cover - defensive
        logger.info(f"kb_store write_evolution_file user={user_id} failed: {exc}")


def _list_md(user_id: int, sub: str) -> List[str]:
    root = os.path.join(_kb_root(user_id), sub)
    try:
        return [os.path.join(root, n) for n in os.listdir(root) if n.endswith(".md")]
    except FileNotFoundError:
        return []
    except Exception:
        return []


def seed_memories(user_id: int, *, session: Optional[Session] = None) -> None:
    """首次导出：DB 中存在但没有文件的 Memory 行写成文件。幂等。"""
    own = session is None
    sess = session or Session(engine)
    try:
        rows = sess.exec(select(Memory).where(Memory.user_id == int(user_id))).all()
        for row in rows:
            if _read_text(_memory_path(user_id, row.memory_id)) is None:
                write_memory_file(user_id, _row_memory_dict(row))
    except Exception as exc:  # pragma: no cover - defensive
        logger.info(f"kb_store seed_memories user={user_id} failed: {exc}")
    finally:
        if own:
            sess.close()


def seed_evolution(user_id: int, *, session: Optional[Session] = None) -> None:
    own = session is None
    sess = session or Session(engine)
    try:
        rows = sess.exec(select(EvolutionInput).where(EvolutionInput.user_id == int(user_id))).all()
        for row in rows:
            if _read_text(_evolution_path(user_id, row.evolution_input_id)) is None:
                write_evolution_file(user_id, _row_evolution_dict(row))
    except Exception as exc:  # pragma: no cover - defensive
        logger.info(f"kb_store seed_evolution user={user_id} failed: {exc}")
    finally:
        if own:
            sess.close()


def sync_memories_from_files(user_id: int, *, session: Optional[Session] = None) -> None:
    """文件回写 DB（文件赢）：解析 memories/*.md，按 memory_id upsert Memory。"""
    own = session is None
    sess = session or Session(engine)
    try:
        changed = False
        for path in _list_md(user_id, MEMORIES_DIR):
            raw = _read_text(path)
            if raw is None:
                continue
            meta, body = _md_to_row(raw)
            memory_id = str(meta.get("memory_id") or "").strip()
            if not memory_id:
                continue
            row = sess.exec(
                select(Memory).where(Memory.user_id == int(user_id), Memory.memory_id == memory_id)
            ).first() or Memory(memory_id=memory_id, user_id=int(user_id), content="")
            row.ai_config_id = meta.get("ai_config_id")
            row.project_id = meta.get("project_id")
            row.job_id = meta.get("job_id")
            row.generation = int(meta.get("generation") or 1)
            row.kind = str(meta.get("kind") or "fact")
            tags = meta.get("tags") or []
            row.tags = ",".join(str(t) for t in tags) if isinstance(tags, list) else str(tags or "")
            row.content = body
            row.source = json.dumps(meta.get("source") or {}, ensure_ascii=False)
            row.confidence = float(meta.get("confidence") or 0.0)
            row.archived = bool(meta.get("archived"))
            if meta.get("created_at") is not None:
                row.created_at = float(meta.get("created_at"))
            if meta.get("updated_at") is not None:
                row.updated_at = float(meta.get("updated_at"))
            sess.add(row)
            changed = True
        if changed:
            sess.commit()
    except Exception as exc:  # pragma: no cover - defensive
        sess.rollback()
        logger.info(f"kb_store sync_memories_from_files user={user_id} failed: {exc}")
    finally:
        if own:
            sess.close()


def sync_evolution_from_files(user_id: int, *, session: Optional[Session] = None) -> None:
    own = session is None
    sess = session or Session(engine)
    try:
        changed = False
        for path in _list_md(user_id, EVOLUTION_DIR):
            raw = _read_text(path)
            if raw is None:
                continue
            meta, body = _md_to_row(raw)
            evo_id = str(meta.get("evolution_input_id") or "").strip()
            if not evo_id:
                continue
            row = sess.exec(
                select(EvolutionInput).where(
                    EvolutionInput.user_id == int(user_id),
                    EvolutionInput.evolution_input_id == evo_id,
                )
            ).first() or EvolutionInput(evolution_input_id=evo_id, user_id=int(user_id), proposal="")
            row.source_ai_config_id = meta.get("source_ai_config_id")
            row.type = str(meta.get("type") or "lesson")
            row.target_scope = json.dumps(meta.get("target_scope") or {}, ensure_ascii=False)
            row.evidence = json.dumps(meta.get("evidence") or [], ensure_ascii=False)
            row.proposal = body
            row.risk = str(meta.get("risk") or "")
            row.review_status = str(meta.get("review_status") or "queued")
            row.applied_to = meta.get("applied_to")
            if meta.get("created_at") is not None:
                row.created_at = float(meta.get("created_at"))
            if meta.get("updated_at") is not None:
                row.updated_at = float(meta.get("updated_at"))
            sess.add(row)
            changed = True
        if changed:
            sess.commit()
    except Exception as exc:  # pragma: no cover - defensive
        sess.rollback()
        logger.info(f"kb_store sync_evolution_from_files user={user_id} failed: {exc}")
    finally:
        if own:
            sess.close()


def _row_memory_dict(row: Memory) -> Dict[str, Any]:
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
        "tags": [t.strip() for t in str(row.tags or "").split(",") if t.strip()],
        "content": row.content,
        "source": source,
        "confidence": row.confidence,
        "archived": bool(row.archived),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _row_evolution_dict(row: EvolutionInput) -> Dict[str, Any]:
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


def _loads_safe(raw, fallback):
    if raw is None or raw == "":
        return fallback
    try:
        return json.loads(raw)
    except Exception:
        return fallback


def _ensure_layout(user_id: int) -> None:
    root = _kb_root(user_id)
    readme = os.path.join(root, "README.md")
    if _read_text(readme) is None:
        _write_text(readme, _README)


# ============================================================
# 对外编排入口
# ============================================================

def ensure_user_kb(user_id: int, *, session: Optional[Session] = None) -> None:
    """Ensure the KB root exists and export DB-backed content on demand.

    Category directories are created only when a file is actually written.
    """
    try:
        user_id = int(user_id)
        if not user_id:
            return
        _ensure_layout(user_id)
        own = session is None
        sess = session or Session(engine)
        try:
            user = sess.get(User, user_id)
            if user:
                seed_system_prompts(user_id, user)
            seed_personas(user_id, session=sess)
            cleanup_legacy_agent_thoughts(user_id, session=sess)
            # Memory / EvolutionInput：先导出缺失文件，再以文件为准回写 DB。
            seed_memories(user_id, session=sess)
            seed_evolution(user_id, session=sess)
            sync_memories_from_files(user_id, session=sess)
            sync_evolution_from_files(user_id, session=sess)
        finally:
            if own:
                sess.close()
    except Exception as exc:  # pragma: no cover - defensive
        logger.info(f"kb_store ensure_user_kb user={user_id} failed: {exc}")

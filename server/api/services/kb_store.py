"""KnowledgeBase 文件存储层（真相源）。

把原本散落在数据库 / 硬编码里的五类资产统一落成 ``KnowledgeBase/`` 下的分类
Markdown 文件，并让文件成为运行时的真相源：

    KnowledgeBase/
    ├── personas/<id>-<名>.md      固有人格：每个 AI 一个 md（人格 Prompt + 自动控制 Prompt）
    ├── mcp/<namespace>/<tool>.md  固有属性：每个 MCP 工具的介绍与参数
    ├── system/<key>.md            固有思路：User 表里每个系统提示字段一个 md
    ├── skills/                    传承技能（沿用 inheritance_thoughts 落盘，目录占位）
    └── topics/<slug>.md           传承知识（KnowledgeEntry，已是 md）

设计原则（安全优先）：

* **文件优先、DB 兜底**：文件缺失时一律回退到现有 DB 字段 / 注册表描述，
  因此在执行迁移导出之前，系统行为与改造前完全一致。
* **运行时同步**：为避免改动十余处分散的运行时读取点，``sync_from_files``
  在每次对话 / 任务启动时把 ``personas/`` 与 ``system/`` 的内容刷回数据库，
  现有读取链路无需改动即可读到文件内容（文件赢）。
* **保存双写**：上层保存接口在写库的同时调用本模块写文件，二者保持一致。
* **全程 best-effort**：任何解析 / IO 失败都吞掉并回退，绝不影响主链路。
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple

from sqlmodel import Session, select

from ..core.config import _ai_dir_slug, user_shared_knowledge_dir
from ..database import engine
from ..models import AssistantAIConfig, User

logger = logging.getLogger(__name__)


# ---------- 目录布局 ----------

PERSONAS_DIR = "personas"
MCP_DIR = "mcp"
SYSTEM_DIR = "system"
SKILLS_DIR = "skills"
TOPICS_DIR = "topics"

# system/ 下每个文件对应 User 表的一个字段。``number`` 字段以纯文本存储，
# 同步回库时再转成 int。键集合与 librarian_service._SYSTEM_PROMPT_SECTIONS 对齐。
SYSTEM_PROMPT_KEYS: Tuple[Tuple[str, str], ...] = (
    ("admin_prompt", "text"),
    ("mcp_call_method", "text"),
    ("mcp_namespace_hints", "text"),
    ("mcp_dynamic_rule", "text"),
    ("mcp_format_error_hint", "text"),
    ("default_start_task_prompt", "text"),
    ("default_resume_task_prompt", "text"),
    ("default_supervision_prompt", "text"),
    ("default_supervision_idle_seconds", "number"),
    ("default_inheritance_notice", "text"),
    ("prompt_ai_message_notify", "text"),
    ("prompt_ai_message_inquiry", "text"),
    ("ai_message_inquiry_reminder_seconds", "number"),
    ("prompt_ai_message_inquiry_reminder", "text"),
    ("prompt_ai_message_reply", "text"),
    ("prompt_ai_message_chitchat", "text"),
    ("prompt_ai_message_reply_success", "text"),
    ("prompt_user_message_notice", "text"),
)
_SYSTEM_PROMPT_TYPE = {key: kind for key, kind in SYSTEM_PROMPT_KEYS}

# persona md 内部用 ``## @key`` 分隔不同 Prompt 段，round-trip 稳定。
_PERSONA_SECTIONS: Tuple[Tuple[str, str], ...] = (
    ("prompt", "人格 Prompt"),
    ("start_task_prompt", "任务启动 Prompt"),
    ("resume_task_prompt", "任务恢复 Prompt"),
    ("supervision_prompt", "监督 Prompt"),
    ("inheritance_notice", "传承提醒 Prompt"),
)
_PERSONA_AUTO_KEYS = ("start_task_prompt", "resume_task_prompt", "supervision_prompt", "inheritance_notice")


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
    """首次迁移：把 User 表里的系统提示导出成文件（已存在的跳过）。"""
    for key, _kind in SYSTEM_PROMPT_KEYS:
        if _read_text(_system_path(user_id, key)) is None:
            write_system_prompt(user_id, key, getattr(user, key, ""))


def _coerce_number(key: str, raw: str) -> int:
    try:
        value = int(str(raw).strip() or 0)
    except Exception:
        value = 0
    if key == "default_supervision_idle_seconds":
        return max(5, min(3600, value or 25))
    if key == "ai_message_inquiry_reminder_seconds":
        return max(0, min(3600, value))
    return value


def sync_system_prompts_to_db(user_id: int, *, session: Optional[Session] = None) -> bool:
    """把 system/*.md 的内容刷回 User 表（文件赢）。返回是否有改动。"""
    own = session is None
    sess = session or Session(engine)
    changed = False
    try:
        user = sess.get(User, int(user_id))
        if not user:
            return False
        for key, kind in SYSTEM_PROMPT_KEYS:
            body = read_system_prompt(user_id, key)
            if body is None:
                continue
            value: Any = _coerce_number(key, body) if kind == "number" else body
            if getattr(user, key, None) != value:
                setattr(user, key, value)
                changed = True
        if changed:
            sess.add(user)
            if own:
                sess.commit()
    except Exception as exc:  # pragma: no cover - defensive
        logger.info(f"kb_store sync_system_prompts user={user_id} failed: {exc}")
        return False
    finally:
        if own:
            sess.close()
    return changed


# ============================================================
# 2) 固有人格（AI prompt）—— personas/<id>-<名>.md
# ============================================================

def _persona_path(user_id: int, cfg_id: int, name: str) -> str:
    fname = f"{int(cfg_id)}-{_safe_filename(name)}.md"
    return os.path.join(_kb_root(user_id), PERSONAS_DIR, fname)


def _render_persona(cfg: AssistantAIConfig) -> str:
    try:
        auto = json.loads(cfg.system_auto_control or "{}")
        if not isinstance(auto, dict):
            auto = {}
    except Exception:
        auto = {}
    header = _build_frontmatter({
        "id": cfg.id,
        "name": cfg.name,
        "role": cfg.ai_role,
    })
    parts: List[str] = [header]
    values = {"prompt": str(cfg.prompt or "")}
    for key in _PERSONA_AUTO_KEYS:
        values[key] = str(auto.get(key) or "")
    for key, label in _PERSONA_SECTIONS:
        parts.append(f"## @{key} {label}\n\n{values.get(key, '').strip()}\n")
    return "\n".join(parts).strip() + "\n"


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


def write_persona(user_id: int, cfg: AssistantAIConfig) -> None:
    target = _persona_path(user_id, cfg.id, cfg.name)
    _write_text(target, _render_persona(cfg))
    # 清理该 AI 改名后遗留的旧文件，避免同一 id 出现多个文件造成同步歧义。
    _prune_stale_personas(user_id, cfg.id, keep=target)


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


def sync_personas_to_db(user_id: int, *, session: Optional[Session] = None) -> bool:
    """把 personas/*.md 刷回 AssistantAIConfig（文件赢）。返回是否有改动。"""
    own = session is None
    sess = session or Session(engine)
    changed = False
    try:
        root = os.path.join(_kb_root(user_id), PERSONAS_DIR)
        if not os.path.isdir(root):
            return False
        # 预载该用户全部 AI，按 id 建索引。
        rows = sess.exec(
            select(AssistantAIConfig).where(AssistantAIConfig.user_id == int(user_id))
        ).all()
        by_id = {int(c.id): c for c in rows if c.id is not None}
        # 按 mtime 升序处理：万一存在同一 id 的多个文件（历史遗留），最新的最后
        # 处理、覆盖较旧的，保证"最新文件赢"。
        names = [f for f in os.listdir(root) if f.endswith(".md")]
        names.sort(key=lambda f: os.path.getmtime(os.path.join(root, f)))
        for fname in names:
            raw = _read_text(os.path.join(root, fname))
            if raw is None:
                continue
            meta, sections = _parse_persona(raw)
            try:
                cfg_id = int(meta.get("id") or 0)
            except Exception:
                cfg_id = 0
            cfg = by_id.get(cfg_id)
            if not cfg:
                continue
            cfg_changed = False
            new_prompt = sections.get("prompt")
            if new_prompt is not None and str(cfg.prompt or "") != new_prompt:
                cfg.prompt = new_prompt
                cfg_changed = True
            # 合并自动控制 Prompt 段。
            try:
                auto = json.loads(cfg.system_auto_control or "{}")
                if not isinstance(auto, dict):
                    auto = {}
            except Exception:
                auto = {}
            auto_changed = False
            for key in _PERSONA_AUTO_KEYS:
                if key in sections and str(auto.get(key) or "") != sections[key]:
                    auto[key] = sections[key]
                    auto_changed = True
            if auto_changed:
                cfg.system_auto_control = json.dumps(auto, ensure_ascii=False)
                cfg_changed = True
            if cfg_changed:
                sess.add(cfg)
                changed = True
        if changed and own:
            sess.commit()
    except Exception as exc:  # pragma: no cover - defensive
        logger.info(f"kb_store sync_personas user={user_id} failed: {exc}")
        return False
    finally:
        if own:
            sess.close()
    return changed


# ---------- 直接读文件的运行时访问器（方案 A：文件优先、DB 兜底） ----------

def effective_ai_prompt(user_id: int, cfg: Any) -> str:
    """AI 人格 Prompt：直接读 personas/*.md；文件缺失回退 cfg.prompt。"""
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
    """system_auto_control JSON：把 persona 文件里的 4 个 Prompt 段覆盖进 cfg 的
    JSON（保留 enabled / tasks 等其余键）；文件缺失原样返回 cfg 值。"""
    base = str(getattr(cfg, "system_auto_control", "") or "") if cfg is not None else ""
    if not (user_id and cfg is not None and getattr(cfg, "id", None) is not None):
        return base
    raw = _read_text(_persona_path(int(user_id), cfg.id, cfg.name))
    if raw is None:
        return base
    try:
        _meta, sections = _parse_persona(raw)
        try:
            auto = json.loads(base or "{}")
            if not isinstance(auto, dict):
                auto = {}
        except Exception:
            auto = {}
        for key in _PERSONA_AUTO_KEYS:
            if key in sections:
                auto[key] = sections[key]
        return json.dumps(auto, ensure_ascii=False)
    except Exception:
        return base


def effective_system_value(user_id: int, key: str, fallback: Any) -> str:
    """系统提示（文本）：直接读 system/<key>.md；文件缺失回退传入的 DB 值。"""
    if user_id:
        body = read_system_prompt(int(user_id), key)
        if body is not None:
            return body
    return str(fallback if fallback is not None else "")


# ============================================================
# 3) 固有属性（MCP 介绍 / 参数）—— mcp/<namespace>/<tool>.md
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
# 4) 目录占位 / README
# ============================================================

_README = """# KnowledgeBase

本目录是该用户所有 AI 共享的知识与配置真相源。子目录：

- `personas/`  固有人格：每个 AI 的人格 Prompt 与自动控制 Prompt（文件名 `<id>-<名>.md`）。
- `mcp/`       固有属性：每个 MCP 工具的介绍与参数（按 namespace 分目录）。
- `system/`    固有思路：系统级提示词，每个配置项一个文件。
- `skills/`    传承技能：沉淀的技能卡。
- `topics/`    传承知识：流程性知识条目。

运行时以本目录文件为准：每次对话 / 任务启动会把 `personas/` 与 `system/`
的内容同步回数据库；通过界面保存配置时会同时写回这里的文件。
"""


def _ensure_layout(user_id: int) -> None:
    root = _kb_root(user_id)
    for sub in (PERSONAS_DIR, MCP_DIR, SYSTEM_DIR, SKILLS_DIR, TOPICS_DIR):
        _ensure_dir(os.path.join(root, sub))
    readme = os.path.join(root, "README.md")
    if _read_text(readme) is None:
        _write_text(readme, _README)


# ============================================================
# 对外编排入口
# ============================================================

def ensure_user_kb(user_id: int, *, session: Optional[Session] = None) -> None:
    """建目录 + 首次把 DB/注册表内容导出成文件（已存在的跳过）。幂等。"""
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
        finally:
            if own:
                sess.close()
    except Exception as exc:  # pragma: no cover - defensive
        logger.info(f"kb_store ensure_user_kb user={user_id} failed: {exc}")


def sync_from_files(user_id: int, *, session: Optional[Session] = None) -> None:
    """运行时入口：把 system/ 与 personas/ 的文件内容刷回数据库（文件赢）。

    传入 ``session`` 时使用同一会话写入，调用方需自行 ``refresh`` 已加载对象。
    """
    try:
        user_id = int(user_id)
        if not user_id:
            return
        sync_system_prompts_to_db(user_id, session=session)
        sync_personas_to_db(user_id, session=session)
    except Exception as exc:  # pragma: no cover - defensive
        logger.info(f"kb_store sync_from_files user={user_id} failed: {exc}")

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
import copy
import io
import json
import os
import re
import shutil
import time
import uuid
import zipfile
from typing import Any, Dict, List, Optional

from sqlmodel import Session, select

from ..database import engine
from ..integrations import clawhub
from ..models import AssistantAIConfig, KnowledgeEntry, User
from ..sio import sio
from ..core.config import user_shared_knowledge_dir
from mcp_runtime.mcp.core import safe_join
import logging


logger = logging.getLogger(__name__)


_KB_DIR = "KnowledgeBase"
_TOPICS_DIR = "topics"
_ARCHIVE_DIR = "archives"
_INHERITANCE_THOUGHTS_DIR = "inheritance_thoughts"
_CLAWHUB_REMOTE_DIR = "remote/clawhub"
_INDEX_FILE = "index.json"
_CLAWHUB_SKILLS_STATE_FILE = "clawhub_skills.json"
_INTRINSIC_PROPERTIES_OVERRIDES_FILE = "intrinsic_properties_overrides.json"
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
    "builtin.system_prompts": {
        "title": "固有思路",
        "triggers": ["固有思路", "提示词配置", "Prompt"],
        "summary": "系统设置中的 MCP、任务和 AI 通信提示词配置。",
    },
    "builtin.inheritance_skills": {
        "title": "传承技能",
        "triggers": ["传承技能", "Python脚本", "技能沉淀"],
        "summary": "预留给后续沉淀的 Python 脚本技能，目前为空。",
    },
    "builtin.inheritance_tools": {
        "title": "传承思想",
        "triggers": ["传承思想", "Markdown文件", "思想沉淀"],
        "summary": "预留给后续沉淀的 Markdown 思想文档，目前为空。",
    },
}

_INTRINSIC_TOOL_DESCRIPTIONS_ZH = {
    "admin.get_overview": "获取当前工作区概览，包括连接中的 socket Agent、受管 AI 配置和运行状态。",
    "admin.list_agents": "列出当前用户连接中的 socket Agent 和受管 AI 配置。",
    "ai.send_message": "向同一数字社会中的另一个 AI 发送消息，可用于询问、回复、通知或闲聊，并支持按需等待答复。",
    "conversation.create": "为当前 AI 作用域创建一个新的空聊天会话。",
    "conversation.delete": "删除当前 AI 作用域内指定聊天会话及其中所有消息。",
    "conversation.find": "查找或列出当前 AI 作用域内的聊天会话，可按会话名、会话 ID 或消息内容搜索。",
    "conversation.forget_before_current": "删除当前活跃会话中当前用户消息之前的历史消息，用于按用户要求遗忘此前上下文。",
    "evolution.input": "提交一条系统进化建议，供核心管理员评审 prompt、工具或工作流改进。",
    "evolution.list": "列出已提交的系统进化建议，可按评审状态筛选。",
    "evolution.review": "评审系统进化建议，可执行接受、拒绝或应用，并记录应用位置。",
    "librarian.archive": "归档一条流程知识，使其不再出现在默认知识检索中，仅限图书管理员角色使用。",
    "librarian.consult": "按自由文本向图书管理员查询相关流程知识，返回最多 k 条完整步骤。",
    "librarian.list_topics": "列出流程知识标题、触发词和摘要，用于先浏览再按需读取全文。",
    "librarian.propose": "向图书管理员知识库提交新的流程沉淀申请，初始为待审批，用户通过后才可检索。",
    "librarian.read": "根据 memory_id 读取指定流程知识的完整 Markdown 正文。",
    "mcp.describe_tool": "按工具名（支持 tools 批量或 query 关键词搜索）读取已允许 MCP 工具的完整说明和参数 schema。",
    "memory.archive": "归档一条长期记忆，使其不再出现在默认搜索结果中。",
    "memory.list": "列出已保存的长期记忆，可按类型或项目过滤。",
    "memory.search": "按自由文本、类型、项目或标签搜索长期记忆。",
    "memory.update": "更新一条长期记忆的内容、标签、类型或置信度。",
    "memory.write": "写入一条高价值结构化长期记忆，供后续检索和复用。",
    "project.create_project": "创建一个项目，并可设置状态和关联 AI 成员 ID。",
    "project.delete_project": "按 id 或 project_id 删除项目，并清理已关联 AI 配置上的项目关系。",
    "project.list_projects": "列出当前用户的全部进化项目。",
    "project.update_project": "按 id 或 project_id 更新项目字段。",
    "prompt.list_targets": "列出当前 AI prompt 目标和全局/系统 prompt 键；当前 AI 基础 prompt 位于 AI 配置中。",
    "prompt.read_ai": "读取一个 AI 配置实际使用的基础 prompt；未指定目标时读取当前 AI。",
    "prompt.read_system": "读取当前用户的全局/系统 prompt 模板；当前 AI 基础 prompt 请使用 prompt.read_ai。",
    "prompt.write_ai": "按行编辑一个 AI 配置的 prompt；未指定目标时编辑当前 AI。",
    "prompt.write_system": "按行编辑一个全局/系统 prompt 模板；主要用于运行时注入模板或旧版兜底模板。",
    "task.complete": "将当前任务标记为已完成，并可附带完成摘要。",
    "task.create": "创建任务，支持立即执行、一次性定时或循环任务。",
    "task.delete": "管理员或管理者接管工具：硬删除任务，停止活跃运行并清理相关任务会话消息。",
    "task.inherit": "在任务轮换到下一代之前提交传承摘要。",
    "task.list": "列出任务；默认返回排队、运行和暂停任务，也可查看当前任务或历史任务。",
    "task.update": "管理员或管理者接管工具：更新任务标题、说明、优先级、状态或调度信息。",
    "user.send_message": "通过绑定的飞书或 QQ 机器人向人类用户发送文本或媒体消息。",
    "web.search": "使用 Tavily 搜索公网信息，适合查询外部信息或实时信息。",
    "workspace.run_command": "执行 shell 命令，默认在当前用户工作区运行，支持绝对路径和环境变量；需要隔离时可开启 strict_workspace 或 sandbox_env。",
}

_INTRINSIC_PARAM_DESCRIPTIONS_ZH = {
    "ai_config_id": "目标 AI 配置 ID；未提供时默认使用当前 AI。",
    "ai_kind": "AI 类型；未提供时默认使用当前运行或 assistant。",
    "ai_member_ids": "项目关联的 AI 成员 ID 列表。",
    "all": "为 true 时等同于 mode=all，展开全部工具。",
    "applied_to": "应用该进化建议的位置或对象。",
    "channel": "发送渠道；默认使用 AI 配置中的机器人渠道。",
    "chat_id": "receive_id 的别名。",
    "command": "要执行的 shell 命令。",
    "confidence": "置信度，范围 0.0 到 1.0。",
    "content": "正文内容。",
    "current": "current_only 的别名。",
    "current_message_id": "当前用户消息 ID；未提供时默认使用活跃运行中的当前用户消息。",
    "current_session_id": "当前会话 ID；运行时通常会自动补充。",
    "current_only": "仅返回当前任务，优先运行中任务，其次排队或暂停任务。",
    "cwd": "工作目录；相对路径按工作区解析，也可传绝对路径。",
    "decision": "评审决定，例如接受、拒绝或应用。",
    "description": "描述文本。",
    "duration": "媒体时长，单位毫秒，飞书视频上传时可用。",
    "edits": "批量行编辑列表；每项可包含 mode、line、start_line、end_line、text/content/prompt。",
    "end_line": "范围结束行号，从 1 开始。",
    "evidence": "证据或来源信息。",
    "evolution_input_id": "要评审的系统进化建议 ID。",
    "file_name": "上传媒体时使用的文件名。",
    "generation": "任务或 AI 代数。",
    "gotchas": "注意事项、已知坑或风险点列表。",
    "history": "include_history 的别名。",
    "history_only": "仅返回已完成、已取消、已停止或错误等历史任务。",
    "id": "目标记录 ID。",
    "image_path": "media_path 的图片别名。",
    "image_url": "media_url 的图片别名。",
    "include_answer": "是否让 Tavily 返回生成式答案。",
    "include_archived": "是否包含已归档记录。",
    "include_history": "是否在活跃任务之外同时包含已结束历史任务。",
    "include_images": "是否包含图片搜索结果。",
    "include_messages": "是否包含匹配会话中的完整消息。",
    "include_raw_content": "是否包含可用的网页原始内容。",
    "instruction": "任务执行说明或要求。",
    "job_id": "任务 job_id。",
    "k": "最多返回结果数，默认 5。",
    "key": "系统 prompt 键；省略时读取全部。",
    "keyword": "query 的别名。",
    "kind": "记忆类型。",
    "limit": "返回数量上限。",
    "line": "目标行号，从 1 开始。",
    "line_number": "line 的别名。",
    "max_results": "最大搜索结果数，范围 1 到 20，默认 5。",
    "media_path": "服务端本地图片或视频路径。",
    "media_type": "显式媒体类型。",
    "media_url": "图片或视频的 HTTP(S) URL，服务器会下载后发送。",
    "memory_id": "知识或记忆条目的 memory_id。",
    "message_type": "消息语义类型：inquiry=询问并期望答复，reply=回复上一条询问，notify=单向通知，chitchat=闲聊。",
    "mode": "操作模式。",
    "name": "名称；在部分工具中也是 tool 的别名。",
    "namespace": "MCP 命名空间过滤，例如 workspace、task、prompt。",
    "open_id": "receive_id 的飞书 open_id 别名。",
    "priority": "优先级，范围 1 到 10。",
    "project_id": "项目 ID。",
    "prompt": "prompt 文本；仅在 mode=replace_all 时作为完整 prompt 覆盖使用。",
    "proposal": "系统进化建议内容。",
    "query": "查询文本。",
    "receive_id": "接收方 ID；默认使用 AI 配置中的默认接收方。",
    "receive_id_type": "接收方 ID 类型；QQ 可使用 c2c、group、channel 或 dm。",
    "reply_to_message_id": "回复的原始 AI 消息 ID，用于保持消息线程上下文。",
    "require_reply": "是否同步等待对方回复；普通 AI 协作建议保持 false。",
    "review_status": "评审状态过滤条件。",
    "risk": "风险说明。",
    "schedule_at": "一次性执行时间，支持 Unix 秒或带时区的 ISO-8601。",
    "schedule_duration_minutes": "定时延迟或循环间隔，单位分钟。",
    "schedule_run_immediately": "循环任务是否首次立即执行。",
    "scenario": "流程适用场景或触发条件。",
    "scope": "知识作用域。",
    "scope_target": "非全局作用域的目标 ID。",
    "search_depth": "Tavily 搜索深度，默认 advanced。",
    "session_id": "会话 ID。",
    "session_name": "name 的别名。",
    "source": "来源信息，例如聊天消息 ID 或文件路径。",
    "start_line": "范围起始行号，从 1 开始。",
    "status": "状态过滤或目标状态。",
    "steps": "按顺序执行的步骤列表。",
    "tags": "标签列表。",
    "target_ai_config_id": "代理操作的目标 AI 配置 ID。",
    "target_config_id": "target_ai_config_id 的别名。",
    "target_id": "QQ 目标 ID 别名。",
    "target_scope": "建议影响的目标范围。",
    "target_type": "QQ 目标类型。",
    "text": "文本内容。",
    "timeout": "命令超时时间，单位秒，最高 600 秒。",
    "timeout_seconds": "require_reply=true 时最多等待的秒数；默认最长等待 24 小时。",
    "title": "标题。",
    "to_ai_config_id": "目标 AI 的 ai_config_id。",
    "tool": "要查看的精确 MCP 工具名。",
    "triggers": "未来任务自动匹配时使用的关键词列表。",
    "type": "类型。",
    "video_path": "media_path 的视频别名。",
    "video_url": "media_url 的视频别名。",
}


# ---------- 路径与工具 ----------

def _kb_root(user_id: int) -> str:
    """每用户一份 KB（共享所有 AI）。

    知识库固定挂在用户根目录下（``<user_workspace>/KnowledgeBase``），不随
    各 AI 的独立工作目录切割——图书管理员每用户最多一个，知识对该用户的
    所有 AI 可见。"""
    root = user_shared_knowledge_dir(user_id)
    os.makedirs(root, exist_ok=True)
    os.makedirs(os.path.join(root, _TOPICS_DIR), exist_ok=True)
    os.makedirs(os.path.join(root, _ARCHIVE_DIR), exist_ok=True)
    return root


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
        logger.info(f"{exc}")


def _split_csv(value: str) -> List[str]:
    return [piece.strip() for piece in str(value or "").split(",") if piece.strip()]


def _inheritance_thoughts_root(user_id: int) -> str:
    root = os.path.join(_kb_root(user_id), _INHERITANCE_THOUGHTS_DIR)
    os.makedirs(root, exist_ok=True)
    os.makedirs(safe_join(root, _CLAWHUB_REMOTE_DIR), exist_ok=True)
    return root


def _clawhub_state_path(user_id: int) -> str:
    return os.path.join(_inheritance_thoughts_root(user_id), _CLAWHUB_SKILLS_STATE_FILE)


def _load_clawhub_state(user_id: int) -> Dict[str, Any]:
    try:
        with open(_clawhub_state_path(user_id), "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception as exc:
        logger.info(f"load clawhub state failed: {exc}")
        return {}


def _save_clawhub_state(user_id: int, state: Dict[str, Any]) -> None:
    state["updated_at"] = time.time()
    with open(_clawhub_state_path(user_id), "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def _clawhub_installed_items(user_id: int) -> List[Dict[str, Any]]:
    state = _load_clawhub_state(user_id)
    installed = state.get("installed") if isinstance(state.get("installed"), dict) else {}
    items: List[Dict[str, Any]] = []
    for slug, item in installed.items():
        if not isinstance(item, dict):
            continue
        row = dict(item)
        row["slug"] = str(row.get("slug") or slug)
        rel_path = str(row.get("path") or "").strip()
        row["present"] = bool(rel_path and os.path.isdir(safe_join(_kb_root(user_id), rel_path)))
        items.append(row)
    items.sort(key=lambda item: float(item.get("installed_at") or 0), reverse=True)
    return items


def _inheritance_thoughts_payload(user_id: int) -> Dict[str, Any]:
    installed = _clawhub_installed_items(user_id)
    return {
        "description": "传承思想支持从 ClawHub 发现、校验并下载 Skill 到本地 KnowledgeBase 快照；运行时只使用本地文件。",
        "registry_url": clawhub.registry_base_url(),
        "storage_root": f"{_INHERITANCE_THOUGHTS_DIR}/{_CLAWHUB_REMOTE_DIR}",
        "installed_total": len(installed),
        "installed": installed,
    }


def _render_inheritance_thoughts_body(payload: Dict[str, Any]) -> str:
    lines = [
        "# 传承思想",
        "",
        str(payload.get("description") or ""),
        "",
        f"ClawHub：{payload.get('registry_url') or ''}",
        f"本地目录：KnowledgeBase/{payload.get('storage_root') or ''}",
        f"已安装：{int(payload.get('installed_total') or 0)}",
        "",
    ]
    installed = payload.get("installed") if isinstance(payload.get("installed"), list) else []
    if installed:
        lines.append("## 已安装 ClawHub 技能")
        lines.append("")
        for item in installed:
            slug = str(item.get("slug") or "")
            name = str(item.get("displayName") or slug)
            version = str(item.get("version") or "latest")
            owner = str(item.get("ownerHandle") or "")
            present = "可用" if item.get("present") else "文件缺失"
            lines.append(f"- `{slug}` {name} · {version} · {owner} · {present}")
            summary = str(item.get("summary") or "").strip()
            if summary:
                lines.append(f"  - {summary}")
        lines.append("")
    else:
        lines.append("暂无已安装 ClawHub 技能。")
    return "\n".join(lines).strip()


def _builtin_entries(*, user_id: Optional[int] = None, with_body: bool = False) -> List[Dict[str, Any]]:
    return [
        item
        for memory_id in (
            "builtin.intrinsic_properties",
            "builtin.intrinsic_personas",
            "builtin.system_prompts",
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
            intrinsic = _intrinsic_properties_payload(int(user_id or 0))
            out["intrinsic_properties"] = intrinsic
            out["body"] = _render_intrinsic_properties_body(intrinsic)
        elif memory_id == "builtin.intrinsic_personas":
            personas = _intrinsic_personas_payload(int(user_id or 0))
            out["intrinsic_personas"] = personas
            out["body"] = _render_intrinsic_personas_body(personas)
        elif memory_id == "builtin.system_prompts":
            prompts = _system_prompts_payload(int(user_id or 0))
            out["system_prompts"] = prompts
            out["body"] = _render_system_prompts_body(prompts)
        elif memory_id == "builtin.inheritance_skills":
            out["body"] = ""
        elif memory_id == "builtin.inheritance_tools":
            thoughts = _inheritance_thoughts_payload(int(user_id or 0))
            out["inheritance_tools"] = thoughts
            out["body"] = _render_inheritance_thoughts_body(thoughts)
    return out


def _intrinsic_properties_payload(user_id: int = 0) -> Dict[str, Any]:
    from mcp_runtime.mcp import registry

    overrides = _load_intrinsic_properties_overrides(user_id) if user_id else {}
    tools = sorted(registry.list_tools(), key=lambda item: str(item.get("name") or ""))
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for tool in tools:
        name = str(tool.get("name") or "").strip()
        namespace = name.split(".", 1)[0] if "." in name else "other"
        input_schema = tool.get("inputSchema") if isinstance(tool.get("inputSchema"), dict) else {}
        override = overrides.get(name) if isinstance(overrides.get(name), dict) else {}
        grouped.setdefault(namespace, []).append({
            "name": name,
            "description": intrinsic_tool_description(user_id, name, str(tool.get("description") or "").strip()),
            "inputSchema": intrinsic_input_schema(user_id, name, input_schema),
            "parameters": _mcp_schema_parameter_rows(
                name,
                input_schema,
                override.get("parameters") if override else None,
            ),
            "destructive": bool(tool.get("destructive")),
            "source": "server",
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
        "description": "系统当前固定注册的服务端 MCP 工具定义如下；默认中文展示，编辑后会同步影响 [可用MCP工具] 目录与 mcp.describe_tool 的返回。",
        "total": len(tools),
        "categories": categories,
    }


def _mcp_schema_parameter_rows(tool_name: str, schema: Dict[str, Any], overrides: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
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
        param_name = str(name)
        override_description = ""
        if isinstance(overrides, dict):
            override_description = str(overrides.get(param_name) or "").strip()
        rows.append({
            "name": param_name,
            "type": type_name or "any",
            "required": param_name in required_set,
            "description": override_description or _intrinsic_param_description(tool_name, param_name, str(cfg.get("description") or "").strip()),
        })
    rows.sort(key=lambda item: (not bool(item.get("required")), str(item.get("name") or "")))
    return rows


def intrinsic_tool_description(user_id: int, name: str, raw: str) -> str:
    override = _load_intrinsic_properties_overrides(user_id).get(str(name or "").strip()) if user_id else {}
    if isinstance(override, dict):
        description = str(override.get("description") or "").strip()
        if description:
            return description
    return _intrinsic_tool_description(name, raw)


def intrinsic_input_schema(user_id: int, tool_name: str, schema: Dict[str, Any]) -> Dict[str, Any]:
    out = copy.deepcopy(schema) if isinstance(schema, dict) else {}
    properties = out.get("properties")
    if not isinstance(properties, dict):
        return out
    override = _load_intrinsic_properties_overrides(user_id).get(str(tool_name or "").strip()) if user_id else {}
    param_overrides = override.get("parameters") if isinstance(override, dict) else None
    for name, config in properties.items():
        if not isinstance(config, dict):
            continue
        param_name = str(name)
        override_description = ""
        if isinstance(param_overrides, dict):
            override_description = str(param_overrides.get(param_name) or "").strip()
        config["description"] = override_description or _intrinsic_param_description(
            tool_name,
            param_name,
            str(config.get("description") or "").strip(),
        )
    return out


def _intrinsic_tool_description(name: str, raw: str) -> str:
    return str(raw or "").strip()


def _intrinsic_param_description(tool_name: str, name: str, raw: str) -> str:
    return str(raw or "").strip()


def _intrinsic_properties_overrides_path(user_id: int) -> str:
    return os.path.join(_kb_root(user_id), _INTRINSIC_PROPERTIES_OVERRIDES_FILE)


def _load_intrinsic_properties_overrides(user_id: int) -> Dict[str, Any]:
    if not user_id:
        return {}
    path = _intrinsic_properties_overrides_path(user_id)
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        tools = data.get("tools") if isinstance(data, dict) else {}
        return tools if isinstance(tools, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception as exc:
        logger.info(f"{exc}")
        return {}


def save_intrinsic_properties_overrides(*, user_id: int, tools: List[Dict[str, Any]]) -> Dict[str, Any]:
    current = _load_intrinsic_properties_overrides(user_id)
    for item in tools or []:
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        parameters_raw = item.get("parameters")
        parameters: Dict[str, str] = {}
        if isinstance(parameters_raw, list):
            for param in parameters_raw:
                if not isinstance(param, dict):
                    continue
                param_name = str(param.get("name") or "").strip()
                if param_name:
                    parameters[param_name] = str(param.get("description") or "").strip()
        elif isinstance(parameters_raw, dict):
            parameters = {
                str(key).strip(): str(value or "").strip()
                for key, value in parameters_raw.items()
                if str(key).strip()
            }
        current[name] = {
            "description": str(item.get("description") or "").strip(),
            "parameters": parameters,
        }
    with open(_intrinsic_properties_overrides_path(user_id), "w", encoding="utf-8") as f:
        json.dump({"tools": current, "updated_at": time.time()}, f, ensure_ascii=False, indent=2)
    return _builtin_entry("builtin.intrinsic_properties", user_id=user_id, with_body=True) or {}


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
        parsed: Any = None
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
            "system_auto_control_raw": str(cfg.system_auto_control or ""),
            "auto_control_enabled": bool(parsed.get("enabled")) if isinstance(parsed, dict) else False,
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


_SYSTEM_PROMPT_SECTIONS = [
    {
        "key": "mcp",
        "title": "MCP 提示词",
        "items": [
            ("mcp_call_method", "全局 MCP 调用规范", "text"),
            ("mcp_namespace_hints", "MCP namespace 说明（JSON）", "text"),
            ("mcp_dynamic_rule", "MCP 动态工具暴露规则", "text"),
            ("mcp_format_error_hint", "MCP 格式错误提示", "text"),
        ],
    },
    {
        "key": "task",
        "title": "默认任务提示词",
        "items": [
            ("default_start_task_prompt", "启动执行任务提示词", "text"),
            ("default_resume_task_prompt", "继续被暂停任务提示词", "text"),
            ("default_supervision_prompt", "任务监督提示词", "text"),
            ("default_supervision_idle_seconds", "AI 停止思考提醒秒数", "number"),
            ("default_inheritance_notice", "传承提示文案", "text"),
        ],
    },
    {
        "key": "communication",
        "title": "AI 通信提示词",
        "items": [
            ("prompt_ai_message_notify", "AI 间消息·通知模板", "text"),
            ("prompt_ai_message_inquiry", "AI 间消息·询问模板", "text"),
            ("ai_message_inquiry_reminder_seconds", "询问未回复提醒秒数", "number"),
            ("prompt_ai_message_inquiry_reminder", "AI 间询问未回复提醒模板", "text"),
            ("prompt_ai_message_reply", "AI 间消息·回复模板", "text"),
            ("prompt_ai_message_chitchat", "AI 间消息·闲聊模板", "text"),
            ("prompt_ai_message_reply_success", "AI 间消息回复成功提示", "text"),
            ("prompt_user_message_notice", "用户消息发送提示", "text"),
        ],
    },
]


def _system_prompts_payload(user_id: int) -> Dict[str, Any]:
    with Session(engine) as session:
        user = session.get(User, user_id)
        if not user:
            return {"description": "系统设置中的提示词配置。", "total": 0, "sections": []}
        sections: List[Dict[str, Any]] = []
        total = 0
        for section in _SYSTEM_PROMPT_SECTIONS:
            items: List[Dict[str, Any]] = []
            for field, label, value_type in section["items"]:
                value = getattr(user, field, "")
                items.append({
                    "key": field,
                    "label": label,
                    "type": value_type,
                    "content": str(value if value is not None else ""),
                })
            total += len(items)
            sections.append({
                "key": section["key"],
                "title": section["title"],
                "count": len(items),
                "items": items,
            })
        return {
            "description": "系统设置中的 MCP、默认任务和 AI 通信提示词配置如下；编辑保存后会同步系统设置。",
            "total": total,
            "sections": sections,
        }


def save_system_prompts(*, user_id: int, prompts: List[Dict[str, Any]]) -> Dict[str, Any]:
    allowed: Dict[str, str] = {
        field: value_type
        for section in _SYSTEM_PROMPT_SECTIONS
        for field, _label, value_type in section["items"]
    }
    with Session(engine) as session:
        user = session.get(User, user_id)
        if not user:
            raise ValueError("user not found")
        for item in prompts or []:
            key = str(item.get("key") or "").strip()
            if key not in allowed:
                continue
            raw = item.get("content")
            if allowed[key] == "number":
                try:
                    value = int(raw if raw not in {None, ""} else 0)
                except Exception:
                    value = 0
                if key == "default_supervision_idle_seconds":
                    value = max(5, min(3600, value or 25))
                elif key == "ai_message_inquiry_reminder_seconds":
                    value = max(0, min(3600, value))
                setattr(user, key, value)
            elif key == "mcp_namespace_hints":
                raw_text = str(raw or "").strip()
                if raw_text:
                    try:
                        parsed = json.loads(raw_text)
                        if not isinstance(parsed, dict):
                            raise ValueError("mcp_namespace_hints must be a JSON object")
                        raw_text = json.dumps(
                            {str(k).strip(): str(v).strip() for k, v in parsed.items() if str(k).strip() and str(v).strip()},
                            ensure_ascii=False,
                        )
                    except Exception:
                        raise ValueError("mcp_namespace_hints must be a JSON object")
                setattr(user, key, raw_text)
            elif key == "mcp_call_method":
                text = "\n".join(
                    line for line in str(raw or "").splitlines()
                    if "Call exactly one tool per <mcp-call> block; never join two tool names into one name." not in line
                ).strip()
                setattr(user, key, text)
            else:
                setattr(user, key, str(raw or ""))
        session.add(user)
        session.commit()
    return _builtin_entry("builtin.system_prompts", user_id=user_id, with_body=True) or {}


def _render_system_prompts_body(payload: Dict[str, Any]) -> str:
    lines = [
        "# 固有思路",
        "",
        str(payload.get("description") or ""),
        "",
        f"配置项总数：{int(payload.get('total') or 0)}",
        "",
    ]
    for section in payload.get("sections") or []:
        lines.append(f"## {section.get('title') or section.get('key')}")
        lines.append("")
        for item in section.get("items") or []:
            lines.append(f"### {item.get('label') or item.get('key')}")
            lines.append("")
            lines.append(str(item.get("content") or "（空）"))
            lines.append("")
    return "\n".join(lines).strip()


# ---------- 传承思想 / ClawHub ----------

_SAFE_CLAWHUB_SLUG = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.@/-]{0,160}$")


def _normalize_clawhub_slug(slug: str) -> str:
    value = str(slug or "").strip().strip("/")
    if not value or not _SAFE_CLAWHUB_SLUG.match(value) or ".." in value.split("/"):
        raise ValueError("invalid ClawHub skill slug")
    return value


def search_clawhub_skills(*, user_id: int, query: str, limit: int = 20) -> Dict[str, Any]:
    data = clawhub.search_skills(query, limit=limit, non_suspicious_only=True)
    results = data.get("results") if isinstance(data.get("results"), list) else []
    installed = {item["slug"] for item in _clawhub_installed_items(user_id) if item.get("slug")}
    for item in results:
        if isinstance(item, dict):
            slug = str(item.get("slug") or "")
            item["installed"] = slug in installed
    return {
        "registry_url": clawhub.registry_base_url(),
        "results": results,
        "total": len(results),
    }


def clawhub_skill_detail(*, user_id: int, slug: str) -> Dict[str, Any]:
    slug = _normalize_clawhub_slug(slug)
    detail = clawhub.skill_detail(slug)
    version = _latest_clawhub_version(detail)
    skill_card = ""
    scan: Dict[str, Any] = {}
    try:
        skill_card = clawhub.skill_file(slug, "SKILL.md", version=version)
    except Exception as exc:
        skill_card = f"SKILL.md 读取失败：{exc}"
    try:
        scan = clawhub.skill_scan(slug, version=version) if version else clawhub.skill_scan(slug, tag="latest")
    except Exception as exc:
        scan = {"error": str(exc)}
    return {
        "registry_url": clawhub.registry_base_url(),
        "slug": slug,
        "detail": detail,
        "version": version,
        "skill_card": skill_card,
        "scan": scan,
        "installed": any(item.get("slug") == slug for item in _clawhub_installed_items(user_id)),
    }


def install_clawhub_skill(
    *,
    user_id: int,
    slug: str,
    version: Optional[str] = None,
    force: bool = False,
) -> Dict[str, Any]:
    slug = _normalize_clawhub_slug(slug)
    detail = clawhub.skill_detail(slug)
    resolved_version = str(version or _latest_clawhub_version(detail) or "").strip() or None
    scan: Dict[str, Any] = {}
    try:
        scan = clawhub.skill_scan(slug, version=resolved_version) if resolved_version else clawhub.skill_scan(slug, tag="latest")
    except Exception as exc:
        scan = {"error": str(exc)}
    _raise_if_clawhub_blocked(detail, scan)

    safe_dir_name = _slugify(slug.replace("/", "-").replace("@", "at"))
    install_rel = f"{_INHERITANCE_THOUGHTS_DIR}/{_CLAWHUB_REMOTE_DIR}/{safe_dir_name}"
    install_dir = safe_join(_kb_root(user_id), install_rel)
    if os.path.exists(install_dir):
        if not force:
            raise ValueError("skill already installed; set force=true to update")
        shutil.rmtree(install_dir)
    os.makedirs(install_dir, exist_ok=True)

    blob = clawhub.download_skill_zip(slug, version=resolved_version, tag=None if resolved_version else "latest")
    _extract_skill_zip(blob, install_dir)
    _write_clawhub_install_metadata(install_dir, slug=slug, version=resolved_version, detail=detail, scan=scan)

    skill = detail.get("skill") if isinstance(detail.get("skill"), dict) else {}
    owner = detail.get("owner") if isinstance(detail.get("owner"), dict) else {}
    state = _load_clawhub_state(user_id)
    installed = state.get("installed") if isinstance(state.get("installed"), dict) else {}
    installed[slug] = {
        "slug": slug,
        "displayName": str(skill.get("displayName") or slug),
        "summary": str(skill.get("summary") or ""),
        "version": resolved_version,
        "ownerHandle": str(owner.get("handle") or skill.get("ownerHandle") or ""),
        "source": "remote:clawhub",
        "path": install_rel,
        "registry_url": clawhub.registry_base_url(),
        "installed_at": time.time(),
        "auto_enabled": False,
        "trust": _clawhub_trust_summary(detail, scan),
    }
    state["installed"] = installed
    _save_clawhub_state(user_id, state)
    return {
        "installed": True,
        "skill": installed[slug],
        "entry": _builtin_entry("builtin.inheritance_tools", user_id=user_id, with_body=True) or {},
    }


def clawhub_installed_skill_detail(*, user_id: int, slug: str) -> Dict[str, Any]:
    slug = _normalize_clawhub_slug(slug)
    item = _clawhub_installed_item(user_id, slug)
    install_dir = _clawhub_installed_dir(user_id, item)
    skill_card_path = os.path.join(install_dir, "SKILL.md")
    skill_card = ""
    if os.path.exists(skill_card_path):
        with open(skill_card_path, "r", encoding="utf-8") as f:
            skill_card = f.read()
    metadata_path = os.path.join(install_dir, "heysure_clawhub_install.json")
    metadata: Dict[str, Any] = {}
    if os.path.exists(metadata_path):
        try:
            with open(metadata_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            metadata = loaded if isinstance(loaded, dict) else {}
        except Exception as exc:
            logger.info("read ClawHub install metadata failed: %s", exc)
    return {
        "slug": slug,
        "skill": item,
        "skill_card": skill_card,
        "metadata": metadata,
        "path": item.get("path"),
        "present": os.path.isdir(install_dir),
    }


def update_clawhub_installed_skill(*, user_id: int, slug: str, skill_card: str) -> Dict[str, Any]:
    slug = _normalize_clawhub_slug(slug)
    item = _clawhub_installed_item(user_id, slug)
    install_dir = _clawhub_installed_dir(user_id, item)
    if not os.path.isdir(install_dir):
        raise ValueError("installed skill files are missing")
    _safe_write(os.path.join(install_dir, "SKILL.md"), str(skill_card or ""))
    state = _load_clawhub_state(user_id)
    installed = state.get("installed") if isinstance(state.get("installed"), dict) else {}
    if isinstance(installed.get(slug), dict):
        installed[slug]["edited_at"] = time.time()
        state["installed"] = installed
        _save_clawhub_state(user_id, state)
    return {
        "updated": True,
        "detail": clawhub_installed_skill_detail(user_id=user_id, slug=slug),
        "entry": _builtin_entry("builtin.inheritance_tools", user_id=user_id, with_body=True) or {},
    }


def delete_clawhub_installed_skill(*, user_id: int, slug: str) -> Dict[str, Any]:
    slug = _normalize_clawhub_slug(slug)
    item = _clawhub_installed_item(user_id, slug)
    install_dir = _clawhub_installed_dir(user_id, item)
    if os.path.isdir(install_dir):
        shutil.rmtree(install_dir)
    state = _load_clawhub_state(user_id)
    installed = state.get("installed") if isinstance(state.get("installed"), dict) else {}
    installed.pop(slug, None)
    state["installed"] = installed
    _save_clawhub_state(user_id, state)
    return {
        "deleted": True,
        "slug": slug,
        "entry": _builtin_entry("builtin.inheritance_tools", user_id=user_id, with_body=True) or {},
    }


def _clawhub_installed_item(user_id: int, slug: str) -> Dict[str, Any]:
    state = _load_clawhub_state(user_id)
    installed = state.get("installed") if isinstance(state.get("installed"), dict) else {}
    item = installed.get(slug)
    if not isinstance(item, dict):
        raise ValueError("installed skill not found")
    return dict(item)


def _clawhub_installed_dir(user_id: int, item: Dict[str, Any]) -> str:
    rel_path = str(item.get("path") or "").strip()
    if not rel_path:
        raise ValueError("installed skill path is missing")
    return safe_join(_kb_root(user_id), rel_path)


def _latest_clawhub_version(detail: Dict[str, Any]) -> Optional[str]:
    latest = detail.get("latestVersion") if isinstance(detail.get("latestVersion"), dict) else {}
    version = str(latest.get("version") or "").strip()
    if version:
        return version
    skill = detail.get("skill") if isinstance(detail.get("skill"), dict) else {}
    tags = skill.get("tags") if isinstance(skill.get("tags"), dict) else {}
    latest_tag = str(tags.get("latest") or "").strip()
    return latest_tag or None


def _clawhub_trust_summary(detail: Dict[str, Any], scan: Dict[str, Any]) -> Dict[str, Any]:
    moderation = detail.get("moderation") if isinstance(detail.get("moderation"), dict) else {}
    scan_moderation = scan.get("moderation") if isinstance(scan.get("moderation"), dict) else {}
    security = scan.get("security") if isinstance(scan.get("security"), dict) else {}
    return {
        "verdict": str(moderation.get("verdict") or security.get("status") or ""),
        "isSuspicious": bool(moderation.get("isSuspicious") or scan_moderation.get("isSuspicious")),
        "isMalwareBlocked": bool(moderation.get("isMalwareBlocked") or scan_moderation.get("isMalwareBlocked")),
        "hasScanResult": bool(security.get("hasScanResult")),
        "blockedFromDownload": bool(security.get("blockedFromDownload")),
        "capabilityTags": security.get("capabilityTags") if isinstance(security.get("capabilityTags"), list) else [],
    }


def _raise_if_clawhub_blocked(detail: Dict[str, Any], scan: Dict[str, Any]) -> None:
    trust = _clawhub_trust_summary(detail, scan)
    verdict = str(trust.get("verdict") or "").lower()
    if trust.get("blockedFromDownload") or trust.get("isMalwareBlocked") or verdict in {"malicious", "blocked"}:
        raise ValueError("ClawHub blocked this skill as unsafe")
    if trust.get("isSuspicious") or verdict == "suspicious":
        raise ValueError("ClawHub marked this skill as suspicious")


def _extract_skill_zip(blob: bytes, dest_dir: str) -> None:
    try:
        archive = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile as exc:
        raise ValueError("ClawHub download is not a valid zip") from exc
    dest_abs = os.path.abspath(dest_dir)
    for info in archive.infolist():
        name = info.filename.replace("\\", "/")
        if not name or name.startswith("/") or name.startswith("../") or "/../" in name:
            raise ValueError(f"unsafe zip path: {info.filename}")
        target = os.path.abspath(os.path.join(dest_abs, name))
        if not target.startswith(dest_abs + os.sep) and target != dest_abs:
            raise ValueError(f"unsafe zip path: {info.filename}")
    archive.extractall(dest_abs)
    if not os.path.exists(os.path.join(dest_abs, "SKILL.md")):
        entries = [name for name in os.listdir(dest_abs) if name != "__MACOSX"]
        if len(entries) == 1:
            wrapped_root = os.path.join(dest_abs, entries[0])
            wrapped_card = os.path.join(wrapped_root, "SKILL.md")
            if os.path.isdir(wrapped_root) and os.path.exists(wrapped_card):
                for child in os.listdir(wrapped_root):
                    shutil.move(os.path.join(wrapped_root, child), os.path.join(dest_abs, child))
                shutil.rmtree(wrapped_root, ignore_errors=True)
        if not os.path.exists(os.path.join(dest_abs, "SKILL.md")):
            logger.info("installed ClawHub skill without root SKILL.md at %s", dest_abs)


def _write_clawhub_install_metadata(dest_dir: str, *, slug: str, version: Optional[str], detail: Dict[str, Any], scan: Dict[str, Any]) -> None:
    metadata = {
        "source": "remote:clawhub",
        "slug": slug,
        "version": version,
        "registry_url": clawhub.registry_base_url(),
        "installed_at": time.time(),
        "detail": detail,
        "scan": scan,
    }
    with open(os.path.join(dest_dir, "heysure_clawhub_install.json"), "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)


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
            logger.exception(f"move file failed: {exc}")
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
            logger.info(f"{event}: {exc}")

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
                logger.info(f"runner: {exc}")
        threading.Thread(target=_runner, daemon=True).start()

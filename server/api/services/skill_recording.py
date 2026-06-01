"""Skill-card recording service (S4，见 doc/沉淀技能卡片-设计方案.md §4.0/§4.1).

录制思路是「AI 自挂咽喉点」：所有桌面/浏览器操作都必经 ai-runtime ``core.py`` 的
dispatch；录制开着时，流经的**操作类**工具调用被原样抄进一个 buffer。停止时把裸事件
流加工成卡片 steps（锚点提取 / 脱敏 / 断言 / 噪声过滤），存成 draft 卡片。

本模块两层：

- 纯函数 ``build_card_from_events`` —— 不碰数据库，把裸事件流 + teach 标注加工成
  ``{steps, params, capability}``。单测就测它。
- 数据库生命周期 —— ``start_recording`` / ``record_endpoint_event`` /
  ``stop_recording`` / ``cancel_recording`` / ``active_recording``。录制状态必须落库，
  因为 ``recorder.*`` 工具跑在 mcp-runtime 而抄录发生在 ai-runtime，是两个进程
  （见 ``SkillCardRecording`` 模型注释）。

能力契约（capability）与调用方权限的交集校验发生在执行端（§6.2），不在这里。
"""

from __future__ import annotations

import json
import re
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# 工具分类：操作类进卡片，观察类只作锚点提取的上下文（§4.1-4 噪声过滤）。
# ---------------------------------------------------------------------------

# 操作类工具 → 卡片步骤的归一化动词（act）。replay 执行器靠 step.tool 直接回放，
# act 仅为可读语义。
_OPERATION_ACTS: Dict[str, str] = {
    "keyboard.type": "type",
    "keyboard.press": "press",
    "mouse.click": "click",
    "mouse.double_click": "double_click",
    "mouse.right_click": "right_click",
    "mouse.scroll": "scroll",
    "mouse.drag": "drag",
    "mouse.move": "move",
    "clipboard.set": "set_clipboard",
    "window.focus": "focus_window",
    "window.close": "close_window",
    "process.kill": "kill_process",
    "fs.write": "write_file",
    "shell.run": "run_shell",
    # browser surface 的操作类工具（S6 对称实现，先纳入分类避免被当噪声丢弃）。
    "browser.click": "click",
    "browser.type": "type",
    "browser.navigate": "navigate",
    "browser.select": "select",
}

# 点击/移动类：带坐标，需要锚点提取（§2.1）。
_POINTER_TOOLS = {
    "mouse.click", "mouse.double_click", "mouse.right_click", "mouse.scroll",
    "mouse.move", "mouse.drag",
}

# 破坏性工具：即便 trusted 卡也要二次确认（§6.6）。
_DESTRUCTIVE_TOOLS = {"window.close", "process.kill"}
_DESTRUCTIVE_SHELL = re.compile(
    r"\b(rm|rmdir|del|erase|format|mkfs|dd|Remove-Item)\b", re.IGNORECASE
)

# 这些字段是坐标输入；锚点提取后从 args 里剥掉，避免把本机坐标硬编码进 args。
_COORD_KEYS = {"x", "y", "from_x", "from_y", "to_x", "to_y"}

# 高熵 token 形态（auto 模式脱敏的保守启发式，见 §4.1-2 / §6.6）。
_TOKEN_RE = re.compile(r"^[A-Za-z0-9_\-./+=]{20,}$")
_SECRET_KEYWORD_RE = re.compile(
    r"(?i)(password|passwd|pwd|token|secret|api[_-]?key|credential)"
)


def _is_operation(tool: str) -> bool:
    return tool in _OPERATION_ACTS


def _result_payload(result: Any) -> Dict[str, Any]:
    """Dispatch 结果有两层包裹：{tool, result:{success, result/summary, ...}}。
    尽量挖到最内层的业务 payload，供锚点提取读截图路径等。"""
    if not isinstance(result, dict):
        return {}
    inner = result.get("result", result)
    if isinstance(inner, dict):
        deeper = inner.get("result")
        if isinstance(deeper, dict):
            return deeper
        return inner
    return {}


def _extract_image_ref(observation: Optional[Dict[str, Any]]) -> Optional[str]:
    """从紧邻点击之前的 screen.capture_region 观察事件里取一个稳定的图像引用。

    桌面端把区域截图存到服务器工作区并回传路径（catalog.ts），不同部署字段名不一，
    这里按优先级探测常见键。取到才作为 image 锚点，取不到就只留坐标锚点。"""
    if not observation:
        return None
    payload = _result_payload(observation.get("result"))
    for key in ("path", "workspacePath", "workspace_path", "serverPath", "server_path", "file"):
        val = payload.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return None


def looks_secret(text: str, *, key_hint: str = "") -> bool:
    """auto 模式的保守脱敏判定：宁可漏标也别误标，teach 模式由人当场钉死。"""
    if not isinstance(text, str):
        return False
    t = text.strip()
    if not t:
        return False
    if _SECRET_KEYWORD_RE.search(key_hint or ""):
        return True
    # 高熵、无空格的长串（token / key / 随机口令）。含空格的自然语言一律放过。
    if " " not in t and len(t) >= 20 and _TOKEN_RE.match(t):
        # 纯数字（如电话/单号）不算 secret，留给 teach 决定。
        if not t.isdigit():
            return True
    return False


def _coalesce_moves(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """mouse.move 紧跟 click 时合并：把 move 的坐标喂给缺坐标的 click，丢弃 move。

    AI 常「先 move 再 click」，两条都进卡片是噪声。合并后只留一条带坐标的点击。
    末尾未被吸收的 move 仍保留为 move 步（可能是「记住此处特征」的鼠标指示，§2.1）。"""
    out: List[Dict[str, Any]] = []
    pending_move: Optional[Dict[str, Any]] = None
    for ev in events:
        tool = ev.get("tool")
        if tool == "mouse.move":
            pending_move = ev
            continue
        if pending_move is not None and tool in {"mouse.click", "mouse.double_click", "mouse.right_click"}:
            args = dict(ev.get("args") or {})
            if "x" not in args and "y" not in args:
                mv = pending_move.get("args") or {}
                if "x" in mv and "y" in mv:
                    args["x"], args["y"] = mv.get("x"), mv.get("y")
            ev = {**ev, "args": args}
        if pending_move is not None and tool != "mouse.move":
            # move 没被点击吸收（后面跟的是别的动作）→ 作为独立 move 步保留。
            if not (tool in {"mouse.click", "mouse.double_click", "mouse.right_click"}
                    and (ev.get("args") or {}).get("x") == (pending_move.get("args") or {}).get("x")):
                pass
        pending_move = None
        out.append(ev)
    if pending_move is not None:
        out.append(pending_move)
    return out


def _build_target(
    tool: str,
    args: Dict[str, Any],
    prev_observation: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """点击/拖拽类步骤的定位锚点（§2.1 / §3.2）。

    第一版受桌面回传所限（§5.1）：UIA 控件信息缺失，锚点只有 image（紧邻截图）+
    coord（坐标兜底），外加 vision_fallback。锚点越靠前优先级越高。"""
    if tool not in _POINTER_TOOLS:
        return None
    anchors: List[Dict[str, Any]] = []
    image_ref = _extract_image_ref(prev_observation)
    if image_ref:
        anchors.append({"strategy": "image", "ref": image_ref, "threshold": 0.9})
    if "x" in args and "y" in args:
        anchors.append({"strategy": "coord", "x": args.get("x"), "y": args.get("y")})
    if tool == "mouse.drag" and "from_x" in args:
        anchors.append({
            "strategy": "coord", "x": args.get("from_x"), "y": args.get("from_y"),
            "to_x": args.get("to_x"), "to_y": args.get("to_y"),
        })
    target: Dict[str, Any] = {
        "anchors": anchors,
        "expect_count": 1,  # 护栏：命中数≠1 不点（§2.3 铁律二）
        "vision_fallback": {"enabled": True, "hint": ""},
    }
    return target


def _is_destructive(tool: str, args: Dict[str, Any]) -> bool:
    if tool in _DESTRUCTIVE_TOOLS:
        return True
    if tool == "shell.run":
        cmd = str(args.get("command") or "")
        if _DESTRUCTIVE_SHELL.search(cmd):
            return True
    return False


def _redact_args(
    args: Dict[str, Any],
    *,
    forced_secret: bool,
    param_slots: List[Dict[str, Any]],
    seen_names: set,
) -> Dict[str, Any]:
    """把疑似敏感值替换成参数槽 {{slot}} 并登记 secret 参数（§6.6）。

    auto 模式靠 ``looks_secret`` 启发式；teach 模式由 ``forced_secret`` 强制。被替换的
    值**不落库、不随卡片共享**——卡片里只留参数槽。"""
    out = dict(args)
    for key in ("text", "command", "content"):
        if key not in out:
            continue
        value = out[key]
        if not isinstance(value, str) or not value:
            continue
        if forced_secret or looks_secret(value, key_hint=key):
            slot = f"secret_{len(param_slots) + 1}"
            if slot not in seen_names:
                seen_names.add(slot)
                param_slots.append(
                    {"name": slot, "type": "string", "required": True, "secret": True}
                )
            out[key] = f"{{{{{slot}}}}}"
    return out


def build_card_from_events(
    events: List[Dict[str, Any]],
    *,
    annotations: Optional[Dict[str, Any]] = None,
    drop_tail: int = 0,
) -> Dict[str, Any]:
    """把裸事件流加工成 draft 卡片主体：``{steps, params, capability}``。

    纯函数，不碰数据库。停止录制时做四件事（§4.1）：噪声过滤、锚点提取、脱敏、
    断言生成。``annotations`` 是 teach 模式的人工标注，按**操作步序号**（从 0 起，
    即过滤后 steps 的下标）覆盖 assert / 消歧 / secret。
    """
    annotations = annotations or {}

    # 1) 合并 move→click，再保留原始顺序以便锚点提取读「紧邻的前一个观察事件」。
    coalesced = _coalesce_moves(list(events or []))

    param_slots: List[Dict[str, Any]] = []
    seen_param_names: set = set()
    capability: List[str] = []
    cap_seen: set = set()
    steps: List[Dict[str, Any]] = []

    prev_observation: Optional[Dict[str, Any]] = None
    op_index = 0
    for ev in coalesced:
        tool = str(ev.get("tool") or "")
        if not _is_operation(tool):
            # 观察类：不成步，但作为下一个操作步的锚点上下文。
            prev_observation = ev
            continue

        ann = annotations.get(str(op_index)) or annotations.get(op_index) or {}
        if ann.get("drop"):
            prev_observation = None
            op_index += 1
            continue

        raw_args = dict(ev.get("args") or {})
        target = _build_target(tool, raw_args, prev_observation)

        # 锚点提取后剥掉坐标键，避免把本机坐标当成可移植 args 硬编码（§6.1）。
        clean_args = {k: v for k, v in raw_args.items() if k not in _COORD_KEYS}
        clean_args = _redact_args(
            clean_args,
            forced_secret=bool(ann.get("secret")),
            param_slots=param_slots,
            seen_names=seen_param_names,
        )

        if tool not in cap_seen:
            cap_seen.add(tool)
            capability.append(tool)

        step: Dict[str, Any] = {
            "index": len(steps) + 1,
            "act": _OPERATION_ACTS[tool],
            "tool": tool,  # replay 执行器据此直接调用对应 endpoint 工具（确定性回放）
            "args": clean_args,
            "on_fail": "halt",
            "destructive": _is_destructive(tool, raw_args),
        }
        if target is not None:
            step["target"] = target
        # 消歧器（teach 当场钉死，§2.3 铁律三）。
        if ann.get("disambiguate"):
            step.setdefault("target", {})["disambiguate"] = ann["disambiguate"]
        # 断言：teach 人工确认优先；否则给一个「settle」占位（执行器视作等待 + 放过），
        # 既保住 §3.2 的逐步结构，又不凭空捏造可能错误的断言。
        step["assert"] = ann.get("assert") or {"check": "settle", "timeout_ms": 800}

        steps.append(step)
        prev_observation = None
        op_index += 1

    if drop_tail > 0 and steps:
        steps = steps[: max(0, len(steps) - drop_tail)]
        # 重新编号
        for i, s in enumerate(steps):
            s["index"] = i + 1

    # teach 标注里允许声明非 secret 的可移植参数（如 filename）。
    for ann in annotations.values():
        for extra in (ann or {}).get("params", []) or []:
            name = str((extra or {}).get("name") or "").strip()
            if name and name not in seen_param_names:
                seen_param_names.add(name)
                param_slots.append(extra)

    return {"steps": steps, "params": param_slots, "capability": capability}


# ---------------------------------------------------------------------------
# 数据库生命周期。延迟导入 engine/模型，让纯函数部分可脱离 DB 单测。
# ---------------------------------------------------------------------------

_VALID_MODES = {"auto", "teach"}


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


def _session():
    from api.database import engine
    from sqlmodel import Session
    return Session(engine)


def active_recording(user_id: int, ai_config_id: Optional[int]):
    """返回该 (user, ai) 当前 ``recording`` 状态的录制行，没有则 None。"""
    from api.models import SkillCardRecording
    from sqlmodel import select
    with _session() as session:
        return session.exec(
            select(SkillCardRecording).where(
                SkillCardRecording.user_id == user_id,
                SkillCardRecording.ai_config_id == ai_config_id,
                SkillCardRecording.status == "recording",
            ).order_by(SkillCardRecording.created_at.desc())
        ).first()


def start_recording(user_id: int, ai_config_id: Optional[int], meta: Dict[str, Any]) -> Dict[str, Any]:
    from api.models import SkillCardRecording
    name = str(meta.get("name") or "").strip()
    if not name:
        raise ValueError("name is required")
    mode = str(meta.get("mode") or "auto").strip().lower()
    if mode not in _VALID_MODES:
        raise ValueError(f"mode must be one of {sorted(_VALID_MODES)}")

    now = time.time()
    rec_id = f"rec_{uuid.uuid4().hex[:12]}"
    with _session() as session:
        # 一个 (user, ai) 同时只允许一条录制；旧的自动作废（cancelled），避免串台。
        from sqlmodel import select
        existing = session.exec(
            select(SkillCardRecording).where(
                SkillCardRecording.user_id == user_id,
                SkillCardRecording.ai_config_id == ai_config_id,
                SkillCardRecording.status == "recording",
            )
        ).all()
        for row in existing:
            row.status = "cancelled"
            row.updated_at = now
            session.add(row)

        rec = SkillCardRecording(
            recording_id=rec_id,
            user_id=user_id,
            ai_config_id=ai_config_id,
            session_id=str(meta.get("session_id") or "").strip() or None,
            name=name,
            description=str(meta.get("description") or "").strip() or None,
            surface=str(meta.get("surface") or "windows").strip().lower(),
            scope=str(meta.get("scope") or "private").strip().lower(),
            mode=mode,
            domain=_dumps(meta.get("domain") or []),
            app_scope=_dumps(meta.get("app_scope")) if meta.get("app_scope") else None,
            environment_signature=str(meta.get("environment_signature") or "").strip() or None,
            status="recording",
            events=_dumps([]),
            annotations=_dumps({}),
            created_at=now,
            updated_at=now,
        )
        session.add(rec)
        session.commit()
        session.refresh(rec)
        return {
            "recording_id": rec.recording_id,
            "name": rec.name,
            "mode": rec.mode,
            "surface": rec.surface,
            "status": rec.status,
            "replaced_count": len(existing),
        }


def record_endpoint_event(
    user_id: int,
    ai_config_id: Optional[int],
    tool: str,
    arguments: Dict[str, Any],
    result: Any,
) -> bool:
    """咽喉点抄录（被 ai-runtime ``core.py`` dispatch 后调用）。

    若该 (user, ai) 有进行中的录制，则把这次工具调用作为裸事件追加进 buffer。无录制
    时是一次廉价的索引查询后即返回。**绝不能因录制出错而影响主调用链**——调用方已
    用 try/except 兜住，这里也尽量自保。
    """
    rec = active_recording(user_id, ai_config_id)
    if rec is None:
        return False
    from api.models import SkillCardRecording
    from sqlmodel import select
    with _session() as session:
        row = session.exec(
            select(SkillCardRecording).where(
                SkillCardRecording.recording_id == rec.recording_id
            )
        ).first()
        if row is None or row.status != "recording":
            return False
        events = _loads(row.events, [])
        events.append({
            "tool": tool,
            "args": arguments or {},
            "result": _slim_result(result),
            "ts": time.time(),
        })
        row.events = _dumps(events)
        row.updated_at = time.time()
        session.add(row)
        session.commit()
        return True


def _slim_result(result: Any) -> Any:
    """裸事件只需保留锚点提取要用的轻量信息，别把整张截图 base64 抄进 buffer。"""
    payload = _result_payload(result)
    if not payload:
        return {}
    slim: Dict[str, Any] = {}
    for key in ("path", "workspacePath", "workspace_path", "serverPath", "server_path",
                "file", "success", "title", "active_window"):
        if key in payload:
            slim[key] = payload[key]
    return slim


def annotate_recording(
    user_id: int,
    ai_config_id: Optional[int],
    annotation: Dict[str, Any],
    *,
    step_index: Optional[int] = None,
) -> Dict[str, Any]:
    """teach 模式：给某个已抄录的操作步附加人工确认的断言/消歧/脱敏标注。

    ``step_index`` 是过滤后操作步的下标（从 0 起）；缺省落到当前最后一个操作步。"""
    from api.models import SkillCardRecording
    from sqlmodel import select
    with _session() as session:
        row = session.exec(
            select(SkillCardRecording).where(
                SkillCardRecording.user_id == user_id,
                SkillCardRecording.ai_config_id == ai_config_id,
                SkillCardRecording.status == "recording",
            ).order_by(SkillCardRecording.created_at.desc())
        ).first()
        if row is None:
            raise ValueError("no active recording")
        events = _loads(row.events, [])
        op_count = sum(1 for e in events if _is_operation(str(e.get("tool") or "")))
        idx = step_index if step_index is not None else max(0, op_count - 1)
        ann = _loads(row.annotations, {})
        cur = ann.get(str(idx)) or {}
        cur.update({k: v for k, v in annotation.items() if v is not None})
        ann[str(idx)] = cur
        row.annotations = _dumps(ann)
        row.updated_at = time.time()
        session.add(row)
        session.commit()
        return {"annotated_step": idx, "annotation": cur, "op_count": op_count}


def stop_recording(
    user_id: int,
    ai_config_id: Optional[int],
    *,
    drop_tail: int = 0,
    cancel: bool = False,
    create_card,
) -> Dict[str, Any]:
    """收尾：加工 buffer → 调 ``create_card`` 存成 draft，本行置 stopped。

    ``create_card(card_args)`` 由调用方注入（``skill_card.create`` 处理器），避免本服务
    反向依赖 mcp 工具层。``cancel=True`` 则丢弃不建卡。
    """
    from api.models import SkillCardRecording
    from sqlmodel import select
    now = time.time()
    with _session() as session:
        row = session.exec(
            select(SkillCardRecording).where(
                SkillCardRecording.user_id == user_id,
                SkillCardRecording.ai_config_id == ai_config_id,
                SkillCardRecording.status == "recording",
            ).order_by(SkillCardRecording.created_at.desc())
        ).first()
        if row is None:
            raise ValueError("no active recording")

        if cancel:
            row.status = "cancelled"
            row.updated_at = now
            session.add(row)
            session.commit()
            return {"cancelled": True, "recording_id": row.recording_id}

        events = _loads(row.events, [])
        annotations = _loads(row.annotations, {})
        meta = {
            "recording_id": row.recording_id,
            "name": row.name,
            "description": row.description,
            "surface": row.surface,
            "scope": row.scope,
            "mode": row.mode,
            "domain": _loads(row.domain, []),
            "app_scope": _loads(row.app_scope, None),
            "environment_signature": row.environment_signature,
        }

    built = build_card_from_events(events, annotations=annotations, drop_tail=drop_tail)
    if not built["steps"]:
        # 没抄到任何操作步：不建空卡，直接作废。
        with _session() as session:
            row = session.exec(
                select(SkillCardRecording).where(
                    SkillCardRecording.recording_id == meta["recording_id"]
                )
            ).first()
            if row:
                row.status = "cancelled"
                row.updated_at = time.time()
                session.add(row)
                session.commit()
        return {"created": False, "reason": "no operation steps captured", "recording_id": meta["recording_id"]}

    card_args: Dict[str, Any] = {
        "name": meta["name"],
        "description": meta["description"],
        "surface": meta["surface"],
        "scope": meta["scope"],
        "domain": meta["domain"],
        "capability": built["capability"],
        "params": built["params"],
        "steps": built["steps"],
        "environment_signature": meta["environment_signature"],
    }
    if meta.get("app_scope"):
        # app_scope 不是 skill_card.create 的顶层字段，挂到第一步前的 preconditions 同级
        # 暂以 preconditions 形式附带，保持兼容（schema 已含 app_scope 概念，见 §3.1）。
        card_args["app_scope"] = meta["app_scope"]

    created = create_card(card_args)
    new_card = (created or {}).get("card") or {}
    new_card_id = new_card.get("card_id")

    with _session() as session:
        row = session.exec(
            select(SkillCardRecording).where(
                SkillCardRecording.recording_id == meta["recording_id"]
            )
        ).first()
        if row:
            row.status = "stopped"
            row.card_id = new_card_id
            row.updated_at = time.time()
            session.add(row)
            session.commit()

    return {
        "created": True,
        "recording_id": meta["recording_id"],
        "mode": meta["mode"],
        "card": new_card,
        "step_count": len(built["steps"]),
        "param_count": len(built["params"]),
    }


def recording_status(user_id: int, ai_config_id: Optional[int]) -> Dict[str, Any]:
    rec = active_recording(user_id, ai_config_id)
    if rec is None:
        return {"recording": False}
    events = _loads(rec.events, [])
    op_count = sum(1 for e in events if _is_operation(str(e.get("tool") or "")))
    return {
        "recording": True,
        "recording_id": rec.recording_id,
        "name": rec.name,
        "mode": rec.mode,
        "surface": rec.surface,
        "event_count": len(events),
        "operation_count": op_count,
    }

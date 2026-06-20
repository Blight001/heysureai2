"""Phase-aware context compaction for the planned task flow.

When a phase finishes (``phase.complete``) the inference loop folds that phase's
turns out of the live conversation — the deep-thinking (reasoning) and the
verbose MCP results are dropped, and only a compact line of "which tools ran and
whether they succeeded" plus the phase summary is kept. The same turns are
tagged ``compressed_away`` in the persisted history so a resumed run rebuilds
the same compact context instead of replaying the full phase.

This module is deliberately free of inference-loop state: it exposes pure
helpers (status bookkeeping + text rendering) plus a persistence tagging
function that takes an explicit time window.
"""

from typing import List, Optional, Tuple

from sqlmodel import Session, select

from api.models import ChatMessage

# Flow-control tools are not "real work"; they should not appear in a phase's
# MCP-status line (they are how the phase boundary itself is driven).
_FLOW_TOOLS = {
    "plan.create",
    "plan.get",
    "phase.complete",
    "task.finish",
    "mcp.describe_tool",
}


def record_status(statuses: List[Tuple[str, bool]], tool: str, failed: bool) -> None:
    """Append a tool's outcome to the current phase's status list (in place)."""
    name = str(tool or "").strip()
    if not name or name in _FLOW_TOOLS:
        return
    statuses.append((name, not failed))


def render_status_lines(statuses: List[Tuple[str, bool]]) -> str:
    if not statuses:
        return "（本阶段无 MCP 工具调用）"
    return "；".join(f"{tool} {'✓' if ok else '✗'}" for tool, ok in statuses)


def build_phase_compaction_text(
    finished_phase: Optional[dict],
    statuses: List[Tuple[str, bool]],
) -> str:
    """Compact replacement text for one finished phase's conversation slice."""
    phase = finished_phase or {}
    seq_human = int(phase.get("seq", 0)) + 1
    title = str(phase.get("title") or f"阶段{seq_human}")
    status = str(phase.get("status") or "completed")
    badge = "已完成" if status == "completed" else "未达成(failed)"
    summary = str(phase.get("summary") or "").strip()
    lines = [
        f"[阶段{seq_human} {badge}] {title}",
        f"阶段小结：{summary}" if summary else "",
        f"MCP 调用状态：{render_status_lines(statuses)}",
        "（为节省上下文并保持方向清晰，本阶段的深度思考与 MCP 详细结果已隐藏，仅保留以上状态与小结。）",
    ]
    return "\n".join(line for line in lines if line)


def render_plan_required_notice() -> str:
    """System directive: a task must be planned before any real work."""
    return (
        "[系统要求 · 先制定计划]\n"
        "这是一个需要分阶段完成的任务。在执行任何实际操作前，你必须先调用 plan.create "
        "制定一份完整的分阶段计划：把总体目标拆成有序的多个阶段，每个阶段写清目标(goal)"
        "与结束标志(done_signal)，可在 actions 里列出子行动。\n"
        "在计划登记完成前，系统只接受 plan.create 调用，其它工具一律拒绝。"
    )


def render_phase_directive(phase: Optional[dict], total: int) -> str:
    """System directive that hands the AI the current phase to execute."""
    phase = phase or {}
    seq_human = int(phase.get("seq", 0)) + 1
    title = str(phase.get("title") or f"阶段{seq_human}")
    goal = str(phase.get("goal") or "")
    done = str(phase.get("done_signal") or "")
    lines = [
        f"[系统调度 · 阶段 {seq_human}/{total}] {title}",
        "现在开始执行这个阶段，不要跳过、也不要提前结束整个任务。",
        f"- 阶段目标: {goal}",
        f"- 结束标志: {done}",
    ]
    actions = phase.get("actions") or []
    if isinstance(actions, list) and actions:
        lines.append("- 子行动:")
        for action in actions:
            if isinstance(action, dict):
                a_goal = str(action.get("goal") or "").strip()
                a_done = str(action.get("done_signal") or "").strip()
            else:
                a_goal, a_done = str(action).strip(), ""
            if not a_goal:
                continue
            lines.append(f"  - {a_goal}" + (f"（结束标志：{a_done}）" if a_done else ""))
    lines.append("达成本阶段结束标志后，调用 phase.complete 收尾本阶段（无需总结），由系统安排下一步。")
    return "\n".join(lines)


def render_finish_required_notice(goal: str) -> str:
    """System directive: all phases done, the run must close via task.finish."""
    return (
        "[系统要求 · 收尾总结]\n"
        f"计划「{str(goal or '').strip()}」的所有阶段均已完成。"
        "现在必须调用 task.finish 对整个任务做完整总结并收尾："
        "outcome 填 success 或 failure，summary 给出完整复盘。\n"
        "系统只接受 task.finish 调用，其它工具一律拒绝。"
    )


def render_continue_phase_notice() -> str:
    """System directive: don't end a task by talking; keep executing the phase."""
    return (
        "[系统要求 · 继续执行]\n"
        "当前阶段尚未收尾。请继续执行本阶段，达成结束标志后调用 phase.complete；"
        "不要用普通回复结束任务。"
    )


def mark_phase_messages_compressed(
    session: Session,
    *,
    user_id: int,
    ai_config_id: Optional[int],
    ai_kind: str,
    session_id: str,
    since_ts: float,
    until_ts: float,
) -> int:
    """Tag a phase's assistant turns + MCP tool bubbles ``compressed_away``.

    Mirrors :mod:`api.services.conversation_compress`: ``compressed_away`` rows
    are excluded from the model context on subsequent runs. User-visible turns
    and the persisted phase-summary message are left intact.
    """
    stmt = select(ChatMessage).where(
        ChatMessage.user_id == user_id,
        ChatMessage.session_id == session_id,
        ChatMessage.ai_kind == ai_kind,
        ChatMessage.created_at >= since_ts,
        ChatMessage.created_at <= until_ts,
    )
    if ai_config_id is not None:
        stmt = stmt.where(ChatMessage.ai_config_id == ai_config_id)

    marked = 0
    for message in session.exec(stmt).all():
        tags = str(getattr(message, "tags", "") or "")
        is_mcp_bubble = "mcp_tool_call" in tags
        if message.role != "assistant" and not is_mcp_bubble:
            continue
        tag_list = [t for t in tags.split(",") if t.strip()]
        if "compressed_away" in tag_list:
            continue
        tag_list.append("compressed_away")
        message.tags = ",".join(tag_list)
        message.total_tokens = 0
        session.add(message)
        marked += 1
    return marked

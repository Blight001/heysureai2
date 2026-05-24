"""通信类 MCP 工具：
- user.send_message  → 向用户发送消息（沿用飞书底座，名字改为业务语义）
- ai.send_message    → 向另一个 AI 发送消息。所有"回信"都走它本身：带
                       message_type="reply" 与 reply_to_message_id。
                       系统按 (target_session_id, status) 严格匹配，并由
                       cascade_depth 限制 chitchat 链路最多 5 条。
"""

from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlmodel import Session

from ...database import engine
from ...integrations.feishu.service import send_feishu_text_message
from ...models import User
from ...models.defaults import CHITCHAT_MAX_DEPTH
from ...services import ai_message_service
from ...services.agent_dispatch import get_run_session_context


_ALLOWED_MESSAGE_TYPES = {"inquiry", "reply", "chitchat", "notify"}


def _coerce_message_type(raw: Any, *, require_reply: bool) -> str:
    text = str(raw or "").strip().lower()
    if text in _ALLOWED_MESSAGE_TYPES:
        return text
    return "inquiry" if require_reply else "notify"


# ---------- 与用户通信 ----------

def _user_send_message(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    """主动向用户推送一条消息。当前底座：飞书机器人。

    未来可扩展按 AI 配置选择其它渠道（如 socket 推送到 dashboard / 邮件等），
    保留接口签名稳定。
    """
    text = str(args.get("text") or args.get("content") or args.get("message") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required for user.send_message")
    receive_id = str(args.get("receive_id") or args.get("chat_id") or args.get("open_id") or "").strip()
    receive_id_type = str(args.get("receive_id_type") or ("open_id" if args.get("open_id") else "")).strip()
    channel = str(args.get("channel") or "feishu").strip().lower()

    if channel != "feishu":
        # 预留：未来支持其它渠道。当前先严格返错以暴露配置问题。
        raise HTTPException(status_code=400, detail=f"channel '{channel}' not supported yet; use 'feishu'")

    result = send_feishu_text_message(
        user_id,
        ai_config_id,
        text=text,
        receive_id=receive_id,
        receive_id_type=receive_id_type,
    )
    # 套一层 user 语义包装 + 拼出"已送达"提示
    notice_template = ""
    try:
        with Session(engine) as session:
            user = session.get(User, user_id)
            if user:
                notice_template = str(getattr(user, "prompt_user_message_notice", "") or "")
    except Exception:
        notice_template = ""
    notice = ""
    if notice_template:
        try:
            notice = notice_template.format(channel=channel)
        except Exception:
            notice = notice_template

    return {
        "delivered": True,
        "channel": channel,
        "result": result,
        "notice": notice,
    }


# ---------- AI 间通信 ----------


def _reply_result(
    *,
    completed_reply: Dict[str, Any],
    ai_config_id: int,
    to_id: int,
    return_session_id: str,
) -> Dict[str, Any]:
    target_session_id = str(completed_reply.get("from_session_id") or return_session_id or "").strip()
    return {
        "message_id": completed_reply.get("message_id"),
        "queued": False,
        "replied": True,
        "status": "replied",
        "from_ai_config_id": ai_config_id,
        "to_ai_config_id": to_id,
        "target_session_id": target_session_id,
        "return_to_session_id": target_session_id or None,
        "reply_to_message_id": completed_reply.get("reply_to_message_id") or completed_reply.get("message_id"),
        "reply_content": completed_reply.get("reply_content"),
        "waiter_resolved": bool(completed_reply.get("waiter_resolved")),
        "note": "已作为上一封 AI 消息的回信送达原会话。",
    }


def _wrap_return_content(return_route: Dict[str, Any], content: str, replier_ai_config_id: int) -> str:
    route_message_id = str(return_route.get("message_id") or "").strip()
    if not route_message_id:
        return content
    if "你之前发送的 AI 间消息已收到回复" in content:
        return content
    return (
        "你之前发送的 AI 间消息已收到回复。\n"
        f"- 原消息编号: {route_message_id}\n"
        f"- 回复方 ai_config_id: {replier_ai_config_id}\n\n"
        f"[回复内容]\n{content}"
    )


async def _ai_send_message(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    if ai_config_id is None:
        raise HTTPException(status_code=400, detail="ai.send_message must be called by an AI runtime")
    to_raw = args.get("to_ai_config_id") or args.get("target_ai_config_id") or args.get("target")
    if to_raw is None:
        raise HTTPException(status_code=400, detail="to_ai_config_id is required")
    try:
        to_id = int(to_raw)
    except Exception:
        raise HTTPException(status_code=400, detail="to_ai_config_id must be an integer")
    if to_id == int(ai_config_id):
        raise HTTPException(status_code=400, detail="cannot send message to self")
    content = str(args.get("content") or args.get("text") or args.get("message") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="content is required")
    require_reply = bool(args.get("require_reply", False))
    timeout_seconds = int(args.get("timeout_seconds") or 120)
    message_type = _coerce_message_type(args.get("message_type"), require_reply=require_reply)

    sender_ctx = get_run_session_context() or {}
    from_session_id = str(
        args.get("current_session_id")
        or args.get("source_session_id")
        or args.get("from_session_id")
        or args.get("session_id")
        or sender_ctx.get("session_id")
        or ""
    ).strip()
    reply_to_message_id = str(
        args.get("reply_to_message_id")
        or args.get("in_reply_to_message_id")
        or args.get("original_message_id")
        or ""
    ).strip()

    return_route = ai_message_service.find_return_route(
        user_id=user_id,
        current_ai_config_id=int(ai_config_id),
        target_ai_config_id=to_id,
        current_session_id=from_session_id,
    )
    return_session_id = str(return_route.get("from_session_id") or "").strip()

    # 显式 reply_to_message_id：尝试直接落库为对那条消息的回复。
    if reply_to_message_id:
        completed_reply = ai_message_service.resolve_waiting_reply_to_message_id_from_send_message(
            user_id=user_id,
            current_ai_config_id=int(ai_config_id),
            target_ai_config_id=to_id,
            message_id=reply_to_message_id,
            content=content,
        )
        if completed_reply is not None:
            return _reply_result(
                completed_reply=completed_reply,
                ai_config_id=int(ai_config_id),
                to_id=to_id,
                return_session_id=return_session_id,
            )
        if not return_session_id:
            explicit_route = ai_message_service.find_return_route_by_message_id(
                user_id=user_id,
                current_ai_config_id=int(ai_config_id),
                target_ai_config_id=to_id,
                message_id=reply_to_message_id,
            )
            return_session_id = str(explicit_route.get("from_session_id") or "").strip()
            if explicit_route:
                return_route = explicit_route

    if return_session_id:
        completed_reply = ai_message_service.resolve_waiting_reply_from_send_message(
            user_id=user_id,
            current_ai_config_id=int(ai_config_id),
            target_ai_config_id=to_id,
            current_session_id=from_session_id,
            content=content,
        )
        if completed_reply is not None:
            return _reply_result(
                completed_reply=completed_reply,
                ai_config_id=int(ai_config_id),
                to_id=to_id,
                return_session_id=return_session_id,
            )

    # 提前确定目标 AI 应该在哪个 session 处理本消息：
    #   - 回信场景   → 优先投回原始发送方 session（from_session_id）
    #   - 普通信件   → 复用“发信方当前会话 ↔ 目标 AI”绑定的目标侧 session
    #   - 新信件     → 生成稳定 session_id，稍后由 wake_idle_target_for_message
    #                   按同一 id 创建会话，pop 时严格匹配。
    if return_session_id:
        prebound_session_id = return_session_id
    elif from_session_id:
        prebound_session_id = ai_message_service.find_corresponding_target_session_id(
            user_id=user_id,
            from_ai_config_id=int(ai_config_id),
            to_ai_config_id=to_id,
            from_session_id=from_session_id,
        )
    else:
        import uuid as _uuid
        prebound_session_id = f"ai_message_{_uuid.uuid4().hex[:14]}"

    target_active_initial = ai_message_service.target_session_has_active_run(user_id, to_id, prebound_session_id)

    # 推导本条消息在链路里的 cascade_depth：优先看显式 reply_to，否则看
    # find_return_route 推出的原始消息。chitchat 链路靠这个 +1 累计计数。
    parent_depth: Optional[int] = None
    parent_type: Optional[str] = None
    parent_candidate_id = reply_to_message_id or str(return_route.get("message_id") or "").strip()
    if parent_candidate_id:
        parent_row = ai_message_service.fetch_cascade_parent(
            user_id=user_id, message_id=parent_candidate_id
        )
        if parent_row is not None:
            parent_depth = int(getattr(parent_row, "cascade_depth", 0) or 0)
            parent_type = str(getattr(parent_row, "message_type", "") or "").lower() or None
    cascade_depth = (parent_depth + 1) if parent_depth is not None else 0

    # 闲聊硬上限：同一条链路累计最多 CHITCHAT_MAX_DEPTH 条消息。
    if message_type == "chitchat" and cascade_depth >= CHITCHAT_MAX_DEPTH:
        raise HTTPException(
            status_code=400,
            detail=(
                f"chitchat round limit reached (max {CHITCHAT_MAX_DEPTH} messages per thread). "
                "Stop replying and resume your real work; if you genuinely need follow-up, "
                "start a fresh thread with message_type=\"inquiry\"."
            ),
        )
    # 闭环防呆：对方已显式标记 reply（=对话结束），再回就拒绝。
    if parent_type == "reply" and message_type in {"reply", "chitchat", "inquiry"}:
        raise HTTPException(
            status_code=400,
            detail=(
                "this thread is already closed by a previous 'reply'. Do not respond further. "
                "If you have a brand-new question, send a new ai.send_message without reply_to_message_id."
            ),
        )

    try:
        delivery_content = _wrap_return_content(return_route, content, int(ai_config_id)) if return_session_id else content
        msg = ai_message_service.send(
            user_id=user_id,
            from_ai_config_id=int(ai_config_id),
            to_ai_config_id=to_id,
            content=delivery_content,
            target_session_id=prebound_session_id,
            from_session_id=from_session_id,
            require_reply=require_reply,
            timeout_seconds=timeout_seconds,
            message_type=message_type,
            cascade_depth=cascade_depth,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    wakeup = None
    target_active = target_active_initial
    if not target_active:
        try:
            wakeup = ai_message_service.wake_idle_target_for_message(
                message_id=msg.message_id,
                user_id=user_id,
            )
            # wake 内部会把 msg.target_session_id 改为它实际创建的 session_id
            # （等于我们预算的 prebound_session_id，所以这里就是同一个）。
            target_active = bool(wakeup.get("started") or wakeup.get("run_id"))
        except Exception as exc:
            wakeup = {"started": False, "error": str(exc)}

    base_out: Dict[str, Any] = {
        "message_id": msg.message_id,
        "queued": True,
        "target_active_run": target_active,
        "from_ai_config_id": ai_config_id,
        "to_ai_config_id": to_id,
        "target_session_id": msg.target_session_id,
        "return_to_session_id": return_session_id or None,
        "current_session_id": from_session_id or None,
        "require_reply": require_reply,
        "timeout_seconds": timeout_seconds,
        "message_type": message_type,
        "cascade_depth": cascade_depth,
    }
    if message_type == "chitchat":
        base_out["chitchat_remaining_rounds"] = max(0, CHITCHAT_MAX_DEPTH - cascade_depth - 1)
    if wakeup is not None:
        base_out["target_wakeup"] = wakeup

    if not require_reply:
        # Fire-and-forget 路径：不阻塞。
        if return_session_id and wakeup and wakeup.get("started"):
            base_out["note"] = "已入队（不等待回复）；系统已投回原发送方会话并唤醒目标 AI 处理。"
        elif return_session_id:
            base_out["note"] = "已入队（不等待回复）；系统已投回原发送方会话，目标 AI 会在该会话下一轮顶部处理。"
        elif wakeup and wakeup.get("started"):
            base_out["note"] = "已入队（不等待回复）；目标 AI 空闲，系统已创建新对话处理本消息。"
        elif target_active:
            base_out["note"] = "已入队（不等待回复）；目标 AI 会在下一轮顶部处理。"
        else:
            base_out["note"] = "已入队（不等待回复），但目标 AI 唤醒失败。"
        return base_out

    if not target_active:
        # 没人会消费这条消息，立刻返回失败而不是干等到超时。
        base_out["replied"] = False
        base_out["status"] = "failed"
        base_out["failure_reason"] = "target AI is idle and wakeup failed"
        return base_out

    # 事件驱动等待：reply_message 落库后立即唤醒，无轮询、无 5 秒 idle 误判。
    final = await ai_message_service.wait_for_reply(
        message_id=msg.message_id,
        user_id=user_id,
        timeout_seconds=timeout_seconds,
    )
    base_out.update({
        "replied": final.get("status") == "replied",
        "status": final.get("status"),
        "reply_content": final.get("reply_content"),
        "failure_reason": final.get("failure_reason"),
        "replied_at": final.get("replied_at"),
    })
    if final.get("status") == "replied":
        base_out["note"] = "目标 AI 已回复，见 reply_content。"
    elif final.get("status") == "timeout":
        base_out["note"] = f"等待 {timeout_seconds}s 后未收到回复（超时）。"
    else:
        base_out["note"] = "未能拿到回复，详见 status / failure_reason。"
    return base_out



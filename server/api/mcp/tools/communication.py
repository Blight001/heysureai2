"""通信类 MCP 工具：
- user.send_message  → 向用户发送消息（沿用飞书底座，名字改为业务语义）
- ai.send_message    → 向另一个 AI 发送消息（事件驱动；默认阻塞等回复，可关）
- ai.reply_message   → 目标 AI 用此回复对方；落库即刻唤醒等待方
- ai.list_inbox      → 查看自己的未处理消息（一般不需要主动看，强插已经会注入）
"""

from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from ...database import engine
from ...integrations.feishu.service import send_feishu_text_message
from ...models import AssistantAIConfig, User
from ...services import ai_message_service
from ...services.agent_dispatch import get_run_session_context


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
    require_reply = bool(args.get("require_reply", True))
    timeout_seconds = int(args.get("timeout_seconds") or 120)

    # 提前确定目标 AI 应该在哪个 session 处理本消息：
    #   - 已有活跃 run → 复用其 session，强插到该会话顶部
    #   - 空闲       → 预生成一个新 session_id，稍后由 wake_idle_target_for_message
    #                   按同一 id 创建会话，pop 时严格匹配。
    active_session_id = ai_message_service.get_active_session_id(user_id, to_id)
    target_active_initial = active_session_id is not None

    # 先生成 message_id 是为了把 session_id 预先确定下来；这里通过预算
    # session_id 再 send 的方式实现：reserve_idle_session_id 用占位
    # message_id，send 后再回写实际 id。最简单做法是先 send 占位、再
    # 立刻把 target_session_id 改为 ai_message_<message_id>。这里直接
    # 复用：先 send 给一个临时 token，然后 wake 时同步。但为了让
    # pop_pending_for 能在新 session 启动后第一时间命中，我们必须在
    # send 时就写入最终的 session_id。
    #
    # 采用两步：(1) 若目标活跃，直接用其 session_id；(2) 否则先用
    # uuid 占位生成 session_id，send + wake 都使用同一个。
    if active_session_id:
        prebound_session_id = active_session_id
    else:
        import uuid as _uuid
        prebound_session_id = f"ai_message_{_uuid.uuid4().hex[:14]}"

    sender_ctx = get_run_session_context() or {}
    from_session_id = str(sender_ctx.get("session_id") or "").strip()

    try:
        msg = ai_message_service.send(
            user_id=user_id,
            from_ai_config_id=int(ai_config_id),
            to_ai_config_id=to_id,
            content=content,
            target_session_id=prebound_session_id,
            from_session_id=from_session_id,
            require_reply=require_reply,
            timeout_seconds=timeout_seconds,
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
        "require_reply": require_reply,
        "timeout_seconds": timeout_seconds,
    }
    if wakeup is not None:
        base_out["target_wakeup"] = wakeup

    if not require_reply:
        # Fire-and-forget 路径：不阻塞。
        if wakeup and wakeup.get("started"):
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


def _ai_reply_message(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    if ai_config_id is None:
        raise HTTPException(status_code=400, detail="ai.reply_message must be called by an AI runtime")
    message_id = str(args.get("message_id") or "").strip()
    if not message_id:
        raise HTTPException(status_code=400, detail="message_id is required")
    content = str(args.get("content") or args.get("text") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="content is required")
    try:
        msg = ai_message_service.reply(
            message_id=message_id,
            user_id=user_id,
            replier_ai_config_id=int(ai_config_id),
            content=content,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {
        "replied": True,
        "message_id": msg.message_id,
        "to_ai_config_id": msg.to_ai_config_id,
        "from_ai_config_id": msg.from_ai_config_id,
        "status": msg.status,
    }


def _ai_list_inbox(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    if ai_config_id is None:
        raise HTTPException(status_code=400, detail="ai.list_inbox must be called by an AI runtime")
    include_resolved = bool(args.get("include_resolved", False))
    items = ai_message_service.list_inbox(
        user_id=user_id,
        ai_config_id=int(ai_config_id),
        include_resolved=include_resolved,
    )
    return {"count": len(items), "items": items}

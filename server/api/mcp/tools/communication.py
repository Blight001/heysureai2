"""通信类 MCP 工具：
- user.send_message  → 向用户发送消息（沿用飞书底座，名字改为业务语义）
- ai.send_message    → 向另一个 AI 发送消息（可选阻塞等待回复）
- ai.reply_message   → 目标 AI 用此回复对方
- ai.list_inbox      → 查看自己的未处理消息（一般不需要主动看，强插已经会注入）
"""

from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from ...database import engine
from ...integrations.feishu.service import send_feishu_text_message
from ...models import AssistantAIConfig, User
from ...services import ai_message_service


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

    try:
        msg = ai_message_service.send(
            user_id=user_id,
            from_ai_config_id=int(ai_config_id),
            to_ai_config_id=to_id,
            content=content,
            require_reply=require_reply,
            timeout_seconds=timeout_seconds,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    target_active = ai_message_service.target_has_active_run(user_id, to_id)
    wakeup = None
    if not target_active:
        try:
            wakeup = ai_message_service.wake_idle_target_for_message(
                message_id=msg.message_id,
                user_id=user_id,
            )
            target_active = bool(wakeup.get("started") or wakeup.get("run_id"))
        except Exception as exc:
            wakeup = {"started": False, "error": str(exc)}
    out = {
        "message_id": msg.message_id,
        "queued": True,
        "target_active_run": target_active,
        "from_ai_config_id": ai_config_id,
        "to_ai_config_id": to_id,
        "require_reply": require_reply,
        "timeout_seconds": timeout_seconds,
    }
    if wakeup is not None:
        out["target_wakeup"] = wakeup
    if not require_reply:
        if wakeup and wakeup.get("started"):
            out["note"] = "已入队，不等待回复；目标 AI 原本空闲，系统已创建新对话并唤醒处理本消息。"
        elif target_active:
            out["note"] = "已入队，不等待回复；目标 AI 工作循环到下一轮顶部会捕获并处理本消息。"
        else:
            out["note"] = "已入队，但目标 AI 唤醒失败；它要等被唤起执行任务时才能看到。"
        return out

    # 阻塞等待回复
    final = await ai_message_service.wait_for_reply(
        message_id=msg.message_id,
        user_id=user_id,
        timeout_seconds=timeout_seconds,
    )
    out["status"] = final.get("status")
    out["reply_content"] = final.get("reply_content")
    if final.get("failure_reason"):
        out["failure_reason"] = final.get("failure_reason")
    out["replied_at"] = final.get("replied_at")
    return out


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

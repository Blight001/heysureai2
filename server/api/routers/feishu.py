import threading
import uuid
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Request
from sqlmodel import Session, select

from api.database import engine
from api.feishu_service import parse_feishu_text_event, send_feishu_text_message
from api.models import AssistantAIConfig, ChatMessage, ChatMessageCreate, ChatRun, User
from api.routers.chat_persistence import _save_message
from api.routers.chat_runtime_helpers import _resolve_ai_runtime
from api.routers.chat_worker import _run_worker

router = APIRouter()
PREFIX = "/api/feishu"


def _verify_token(cfg: AssistantAIConfig, payload: Dict[str, Any]) -> None:
    expected = str(cfg.feishu_verification_token or "").strip()
    if not expected:
        return
    header = payload.get("header") if isinstance(payload.get("header"), dict) else {}
    token = str(payload.get("token") or header.get("token") or "").strip()
    if token != expected:
        raise HTTPException(status_code=403, detail="Invalid Feishu verification token")


def _build_feishu_runtime_prompt(base_prompt: str, event: Dict[str, str]) -> str:
    chat_id = event.get("chat_id") or ""
    open_id = event.get("open_id") or ""
    target_hint = f"chat_id={chat_id}" if chat_id else f"open_id={open_id}"
    return (
        f"{base_prompt}\n\n"
        "[飞书通知前置模板]\n"
        "本轮消息来自飞书事件回调。请直接生成要回复给飞书用户的最终内容，保持清晰、可直接发送。\n"
        "服务端会在本轮运行结束后自动把最终回复作为飞书通知发回来源会话。\n"
        "如果你确实需要在过程中主动发送飞书消息，可以调用 MCP 工具 `feishu.send_message`。\n"
        f"- 来源接收目标: {target_hint or '未识别'}\n"
        "- 默认回传策略: 优先使用 chat_id；chat_id 为空时使用 open_id 且 receive_id_type=open_id。"
    )


def _has_successful_feishu_send(
    session: Session,
    *,
    user_id: int,
    ai_config_id: int,
    session_id: str,
    after_message_id: int,
) -> bool:
    rows = session.exec(
        select(ChatMessage).where(
            ChatMessage.user_id == user_id,
            ChatMessage.ai_config_id == ai_config_id,
            ChatMessage.ai_kind == "assistant",
            ChatMessage.session_id == session_id,
            ChatMessage.id > after_message_id,
            ChatMessage.tags == "mcp_tool_call",
        )
    ).all()
    for row in rows:
        content = str(row.content or "")
        if "工具: feishu.send_message" in content and "状态: 成功" in content:
            return True
    return False


def _notify_feishu_after_run(
    *,
    run_id: str,
    user_id: int,
    ai_config_id: int,
    session_id: str,
    after_message_id: int,
    receive_id: str,
    receive_id_type: str,
) -> None:
    with Session(engine) as session:
        row = session.exec(select(ChatRun).where(ChatRun.run_id == run_id)).first()
        if not row:
            return
        if _has_successful_feishu_send(
            session,
            user_id=user_id,
            ai_config_id=ai_config_id,
            session_id=session_id,
            after_message_id=after_message_id,
        ):
            return

        final_text = ""
        if str(row.status or "") == "error":
            final_text = f"飞书机器人处理失败：{row.error_message or '未知错误'}"
        else:
            final_msg = session.exec(
                select(ChatMessage).where(
                    ChatMessage.user_id == user_id,
                    ChatMessage.ai_config_id == ai_config_id,
                    ChatMessage.ai_kind == "assistant",
                    ChatMessage.session_id == session_id,
                    ChatMessage.role == "assistant",
                    ChatMessage.id > after_message_id,
                ).order_by(ChatMessage.created_at.desc())
            ).first()
            final_text = str(final_msg.content or "").strip() if final_msg else ""

        if not final_text:
            return

    try:
        send_feishu_text_message(
            user_id,
            ai_config_id,
            text=final_text,
            receive_id=receive_id,
            receive_id_type=receive_id_type,
        )
    except Exception:
        # Event callbacks must not be retried just because the post-run notification failed.
        return


def _run_feishu_worker_and_notify(worker_kwargs: Dict[str, Any], notify_kwargs: Dict[str, Any]) -> None:
    _run_worker(**worker_kwargs)
    _notify_feishu_after_run(**notify_kwargs)


@router.post("/events/{config_id}")
async def receive_feishu_event(config_id: int, request: Request):
    payload = await request.json()
    result = handle_feishu_event_payload(config_id, payload, verify_token=True)
    return result


def handle_feishu_event_payload(config_id: int, payload: Dict[str, Any], verify_token: bool = True) -> Dict[str, Any]:
    with Session(engine) as session:
        cfg = session.get(AssistantAIConfig, config_id)
        if not cfg:
            raise HTTPException(status_code=404, detail="AI config not found")
        if not cfg.feishu_enabled:
            raise HTTPException(status_code=400, detail="Feishu bot is disabled for this AI")
        if verify_token:
            _verify_token(cfg, payload)

        challenge = payload.get("challenge")
        if challenge:
            return {"challenge": challenge}

        event = parse_feishu_text_event(payload)
        if not event:
            return {"success": True, "ignored": True}

        chat_id = event.get("chat_id") or ""
        open_id = event.get("open_id") or ""
        session_key = chat_id or open_id or "unknown"
        session_id = f"feishu_{config_id}_{session_key}"
        session_name = f"飞书对话 {session_key}"
        visible_content = f"[飞书用户]\n{event['text']}"
        model_content = visible_content

        user = session.get(User, cfg.user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        _, _, _, _, system_prompt = _resolve_ai_runtime(session, user, "assistant", cfg.id)
        merged_system_prompt = _build_feishu_runtime_prompt(system_prompt, event)

        inbound_msg = _save_message(
            session,
            cfg.user_id,
            ChatMessageCreate(
                role="user",
                content=visible_content,
                ai_config_id=cfg.id,
                ai_kind="assistant",
                session_id=session_id,
                session_name=session_name,
                tags="feishu_inbound",
                total_tokens=0,
            ),
        )

        active = session.exec(
            select(ChatRun).where(
                ChatRun.user_id == cfg.user_id,
                ChatRun.ai_config_id == cfg.id,
                ChatRun.ai_kind == "assistant",
                ChatRun.session_id == session_id,
                ChatRun.status.in_(["queued", "running"]),
            )
        ).first()
        if active:
            return {"success": True, "run_id": active.run_id, "already_active": True}

        run_id = f"run_{uuid.uuid4().hex}"
        row = ChatRun(
            run_id=run_id,
            user_id=cfg.user_id,
            ai_config_id=cfg.id,
            ai_kind="assistant",
            session_id=session_id,
            session_name=session_name,
            status="queued",
            stop_requested=False,
        )
        session.add(row)
        session.commit()
        cfg_id = int(cfg.id or 0)
        cfg_user_id = int(cfg.user_id)
        inbound_message_id = int(inbound_msg.id or 0)

    receive_id = chat_id or open_id
    receive_id_type = "chat_id" if chat_id else "open_id"
    worker_kwargs = {
        "run_id": run_id,
        "user_id": cfg_user_id,
        "ai_config_id": cfg_id,
        "ai_kind": "assistant",
        "session_id": session_id,
        "session_name": session_name,
        "model_user_content": model_content,
        "merged_system_prompt": merged_system_prompt,
        "max_steps": 6,
    }
    notify_kwargs = {
        "run_id": run_id,
        "user_id": cfg_user_id,
        "ai_config_id": cfg_id,
        "session_id": session_id,
        "after_message_id": inbound_message_id,
        "receive_id": receive_id,
        "receive_id_type": receive_id_type,
    }
    worker = threading.Thread(
        target=_run_feishu_worker_and_notify,
        kwargs={"worker_kwargs": worker_kwargs, "notify_kwargs": notify_kwargs},
        daemon=True,
    )
    worker.start()
    return {"success": True, "run_id": run_id}

import threading
import time
import uuid
from typing import Any, Dict, Tuple

from fastapi import APIRouter, HTTPException, Request
from sqlmodel import Session, select

from api.database import engine
from api.integrations.feishu.service import parse_feishu_text_event, send_feishu_text_message
from api.models import AIMessage, AssistantAIConfig, ChatMessage, ChatMessageCreate, ChatRun, User
from api.services.chat_persistence import _save_message
from api.routers.chat_base import _RUN_THREADS
from api.routers.chat_runtime_helpers import _resolve_ai_runtime
from api.routers.chat_worker import _run_worker

router = APIRouter()
PREFIX = "/api/feishu"
# Feishu text messages have a length cap; split only inside one logical reply segment.
FEISHU_TEXT_MAX_CHARS = 1800


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
        "本轮消息来自飞书事件回调。请直接生成要回复给飞书用户的内容，保持清晰、可直接发送。\n"
        "服务端只会把实际回复内容发回来源会话，不需要输出处理状态或工具调用状态。\n"
        "除非用户明确要求额外通知其他飞书会话，否则不要调用 MCP 工具 `user.send_message`，避免重复回复。\n"
        "如果用户要求忘掉/清除/重置/忽略此前对话或上下文，请先调用 MCP 工具 "
        "`conversation.forget_before_current`；该工具只删除当前用户消息之前的内容，不会清空当前消息。\n"
        f"- 来源接收目标: {target_hint or '未识别'}\n"
        "- 默认回传策略: 优先使用 chat_id；chat_id 为空时使用 open_id 且 receive_id_type=open_id。"
    )


def _send_feishu_text(
    *,
    user_id: int,
    ai_config_id: int,
    receive_id: str,
    receive_id_type: str,
    text: str,
) -> bool:
    body = str(text or "").strip()
    if not body:
        return False
    ok = False
    for start in range(0, len(body), FEISHU_TEXT_MAX_CHARS):
        chunk = body[start:start + FEISHU_TEXT_MAX_CHARS].strip()
        if not chunk:
            continue
        try:
            send_feishu_text_message(
                user_id,
                ai_config_id,
                text=chunk,
                receive_id=receive_id,
                receive_id_type=receive_id_type,
            )
            ok = True
        except Exception as exc:
            print(f"[feishu_notify] send failed config_id={ai_config_id}: {exc}")
            return ok
    return ok


def _has_successful_feishu_send(
    session: Session,
    *,
    user_id: int,
    ai_config_id: int,
    ai_kind: str,
    session_id: str,
    after_message_id: int,
) -> bool:
    rows = session.exec(
        select(ChatMessage).where(
            ChatMessage.user_id == user_id,
            ChatMessage.ai_config_id == ai_config_id,
            ChatMessage.ai_kind == ai_kind,
            ChatMessage.session_id == session_id,
            ChatMessage.id > after_message_id,
            ChatMessage.tags == "mcp_tool_call",
        )
    ).all()
    for row in rows:
        content = str(row.content or "")
        if ("工具: user.send_message" in content or "工具: feishu.send_message" in content) and "状态: 成功" in content:
            return True
    return False


def _send_new_feishu_reply_segments(
    *,
    user_id: int,
    ai_config_id: int,
    ai_kind: str,
    session_id: str,
    after_message_id: int,
    receive_id: str,
    receive_id_type: str,
) -> Tuple[int, bool]:
    with Session(engine) as session:
        if _has_successful_feishu_send(
            session,
            user_id=user_id,
            ai_config_id=ai_config_id,
            ai_kind=ai_kind,
            session_id=session_id,
            after_message_id=after_message_id,
        ):
            return after_message_id, False
        assistant_msgs = session.exec(
            select(ChatMessage).where(
                ChatMessage.user_id == user_id,
                ChatMessage.ai_config_id == ai_config_id,
                ChatMessage.ai_kind == ai_kind,
                ChatMessage.session_id == session_id,
                ChatMessage.role == "assistant",
                ChatMessage.id > after_message_id,
            ).order_by(ChatMessage.id.asc())
        ).all()

    last_message_id = after_message_id
    sent_any = False
    for msg in assistant_msgs:
        msg_id = int(msg.id or 0)
        segment = str(msg.content or "").strip()
        if msg_id:
            last_message_id = msg_id
        if not segment:
            continue
        if not _send_feishu_text(
            user_id=user_id,
            ai_config_id=ai_config_id,
            receive_id=receive_id,
            receive_id_type=receive_id_type,
            text=segment,
        ):
            return last_message_id, sent_any
        sent_any = True
    return last_message_id, sent_any


def _send_feishu_error_if_needed(
    *,
    run_id: str,
    user_id: int,
    ai_config_id: int,
    receive_id: str,
    receive_id_type: str,
    sent_any: bool,
) -> None:
    with Session(engine) as session:
        row = session.exec(select(ChatRun).where(ChatRun.run_id == run_id)).first()
        if not row or str(row.status or "") != "error" or sent_any:
            return
        error_text = f"飞书机器人处理失败：{row.error_message or '未知错误'}"

    _send_feishu_text(
        user_id=user_id,
        ai_config_id=ai_config_id,
        receive_id=receive_id,
        receive_id_type=receive_id_type,
        text=error_text,
    )


def _feishu_session_has_live_run(
    *,
    user_id: int,
    ai_config_id: int,
    ai_kind: str,
    session_id: str,
) -> bool:
    now = time.time()
    with Session(engine) as session:
        rows = session.exec(
            select(ChatRun).where(
                ChatRun.user_id == user_id,
                ChatRun.ai_config_id == ai_config_id,
                ChatRun.ai_kind == ai_kind,
                ChatRun.session_id == session_id,
                ChatRun.status.in_(["queued", "running"]),
            ).order_by(ChatRun.updated_at.desc())
        ).all()
    for row in rows:
        run_id = str(row.run_id or "")
        worker = _RUN_THREADS.get(run_id)
        if worker and worker.is_alive():
            return True
        # A newly inserted run may not have reached _RUN_THREADS yet.
        if str(row.status or "") == "queued" and now - float(row.created_at or now) < 5:
            return True
    return False


def _feishu_session_has_pending_ai_reply(
    *,
    user_id: int,
    ai_config_id: int,
    session_id: str,
) -> bool:
    now = time.time()
    with Session(engine) as session:
        rows = session.exec(
            select(AIMessage).where(
                AIMessage.user_id == user_id,
                AIMessage.from_ai_config_id == ai_config_id,
                AIMessage.from_session_id == session_id,
                AIMessage.status.in_(["pending", "delivered"]),
                AIMessage.message_type.in_(["inquiry", "chitchat"]),
            ).order_by(AIMessage.created_at.desc())
        ).all()
    for row in rows:
        timeout_seconds = max(1, min(600, int(row.timeout_seconds or 120)))
        if now <= float(row.created_at or now) + timeout_seconds + 5:
            return True
    return False


def _feishu_session_has_recent_ai_activity(
    *,
    user_id: int,
    ai_config_id: int,
    session_id: str,
    window_seconds: int = 30,
) -> bool:
    now = time.time()
    cutoff = now - max(1, int(window_seconds or 30))
    rows = []
    with Session(engine) as session:
        rows.extend(
            session.exec(
                select(AIMessage).where(
                    AIMessage.user_id == user_id,
                    AIMessage.from_ai_config_id == ai_config_id,
                    AIMessage.from_session_id == session_id,
                    AIMessage.created_at >= cutoff,
                )
            ).all()
        )
        rows.extend(
            session.exec(
                select(AIMessage).where(
                    AIMessage.user_id == user_id,
                    AIMessage.to_ai_config_id == ai_config_id,
                    AIMessage.target_session_id == session_id,
                    AIMessage.created_at >= cutoff,
                )
            ).all()
        )
    for row in rows:
        activity_at = max(
            float(row.created_at or 0),
            float(row.delivered_at or 0),
            float(row.replied_at or 0),
        )
        if activity_at >= cutoff:
            return True
    return False


def _run_feishu_worker_and_notify(worker_kwargs: Dict[str, Any], notify_kwargs: Dict[str, Any]) -> None:
    worker = threading.Thread(target=_run_worker, kwargs=worker_kwargs, daemon=True)
    _RUN_THREADS[str(notify_kwargs["run_id"])] = worker
    worker.start()

    last_sent_message_id = int(notify_kwargs["after_message_id"])
    sent_any = False
    send_kwargs = {
        "user_id": int(notify_kwargs["user_id"]),
        "ai_config_id": int(notify_kwargs["ai_config_id"]),
        "ai_kind": str(notify_kwargs["ai_kind"]),
        "session_id": str(notify_kwargs["session_id"]),
        "receive_id": str(notify_kwargs["receive_id"]),
        "receive_id_type": str(notify_kwargs["receive_id_type"]),
    }
    idle_deadline = 0.0
    while True:
        next_message_id, did_send = _send_new_feishu_reply_segments(
            **send_kwargs,
            after_message_id=last_sent_message_id,
        )
        if did_send:
            sent_any = True
        if next_message_id > last_sent_message_id:
            last_sent_message_id = next_message_id

        active = _feishu_session_has_live_run(
            user_id=send_kwargs["user_id"],
            ai_config_id=send_kwargs["ai_config_id"],
            ai_kind=send_kwargs["ai_kind"],
            session_id=send_kwargs["session_id"],
        )
        pending_ai_reply = _feishu_session_has_pending_ai_reply(
            user_id=send_kwargs["user_id"],
            ai_config_id=send_kwargs["ai_config_id"],
            session_id=send_kwargs["session_id"],
        )
        recent_ai_activity = _feishu_session_has_recent_ai_activity(
            user_id=send_kwargs["user_id"],
            ai_config_id=send_kwargs["ai_config_id"],
            session_id=send_kwargs["session_id"],
        )
        if active or pending_ai_reply or recent_ai_activity:
            idle_deadline = time.time() + 3
        elif idle_deadline <= 0:
            idle_deadline = time.time() + 3
        elif time.time() >= idle_deadline:
            break

        time.sleep(0.5)

    next_message_id, did_send = _send_new_feishu_reply_segments(
        **send_kwargs,
        after_message_id=last_sent_message_id,
    )
    if did_send:
        sent_any = True

    _send_feishu_error_if_needed(
        run_id=str(notify_kwargs["run_id"]),
        user_id=int(notify_kwargs["user_id"]),
        ai_config_id=int(notify_kwargs["ai_config_id"]),
        receive_id=str(notify_kwargs["receive_id"]),
        receive_id_type=str(notify_kwargs["receive_id_type"]),
        sent_any=sent_any,
    )


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
        ai_kind = "assistant" if cfg.ai_role == "assistant_admin" else "core"
        session_key = chat_id or open_id or "unknown"
        session_id = f"feishu_{config_id}_{session_key}"
        session_name = f"飞书对话 {session_key}"
        visible_content = event["text"]
        model_content = visible_content

        user = session.get(User, cfg.user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        _, _, _, _, system_prompt = _resolve_ai_runtime(session, user, ai_kind, cfg.id)
        merged_system_prompt = _build_feishu_runtime_prompt(system_prompt, event)

        inbound_msg = _save_message(
            session,
            cfg.user_id,
            ChatMessageCreate(
                role="user",
                content=visible_content,
                ai_config_id=cfg.id,
                ai_kind=ai_kind,
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
                ChatRun.ai_kind == ai_kind,
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
            ai_kind=ai_kind,
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
        "ai_kind": ai_kind,
        "session_id": session_id,
        "session_name": session_name,
        "model_user_content": model_content,
        "merged_system_prompt": merged_system_prompt,
        "max_steps": 6,
        "current_user_message_id": inbound_message_id,
    }
    notify_kwargs = {
        "run_id": run_id,
        "user_id": cfg_user_id,
        "ai_config_id": cfg_id,
        "ai_kind": ai_kind,
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

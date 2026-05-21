import json
import time
from typing import Any, Dict, Optional

import requests
from fastapi import HTTPException
from sqlmodel import Session, select

from .database import engine
from .models import AssistantAIConfig

FEISHU_OPEN_API_BASE = "https://open.feishu.cn/open-apis"
_TOKEN_CACHE: Dict[int, Dict[str, Any]] = {}


def _load_feishu_config(user_id: int, ai_config_id: Optional[int]) -> AssistantAIConfig:
    if not ai_config_id:
        raise HTTPException(status_code=400, detail="feishu tool requires ai_config_id")
    with Session(engine) as session:
        cfg = session.exec(
            select(AssistantAIConfig).where(
                AssistantAIConfig.id == ai_config_id,
                AssistantAIConfig.user_id == user_id,
            )
        ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="AI config not found")
    if not cfg.feishu_enabled:
        raise HTTPException(status_code=400, detail="Feishu bot is not enabled for this AI")
    if not cfg.feishu_webhook_url and (not cfg.feishu_app_id or not cfg.feishu_app_secret):
        raise HTTPException(status_code=400, detail="Feishu webhook_url or app_id/app_secret not configured")
    return cfg


def get_tenant_access_token(user_id: int, ai_config_id: Optional[int]) -> str:
    cfg = _load_feishu_config(user_id, ai_config_id)
    now = time.time()
    cache = _TOKEN_CACHE.get(int(cfg.id or 0))
    if cache and cache.get("token") and float(cache.get("expires_at") or 0) > now + 120:
        return str(cache["token"])

    res = requests.post(
        f"{FEISHU_OPEN_API_BASE}/auth/v3/tenant_access_token/internal",
        headers={"Content-Type": "application/json; charset=utf-8"},
        json={"app_id": cfg.feishu_app_id, "app_secret": cfg.feishu_app_secret},
        timeout=20,
    )
    data = res.json() if res.headers.get("content-type", "").lower().startswith("application/json") else {}
    if not res.ok or int(data.get("code") or 0) != 0:
        raise HTTPException(status_code=502, detail=f"Feishu token failed: {data or res.text}")
    token = str(data.get("tenant_access_token") or "").strip()
    if not token:
        raise HTTPException(status_code=502, detail="Feishu token response missing tenant_access_token")
    expire = int(data.get("expire") or 7200)
    _TOKEN_CACHE[int(cfg.id or 0)] = {"token": token, "expires_at": now + max(60, expire)}
    return token


def send_feishu_text_message(
    user_id: int,
    ai_config_id: Optional[int],
    *,
    text: str,
    receive_id: str = "",
    receive_id_type: str = "",
) -> Dict[str, Any]:
    cfg = _load_feishu_config(user_id, ai_config_id)
    target_id = str(receive_id or cfg.feishu_default_receive_id or "").strip()
    target_type = str(receive_id_type or cfg.feishu_default_receive_id_type or "chat_id").strip()
    can_send_to_target = bool(target_id and cfg.feishu_app_id and cfg.feishu_app_secret)
    if cfg.feishu_webhook_url and not can_send_to_target:
        res = requests.post(
            cfg.feishu_webhook_url,
            headers={"Content-Type": "application/json; charset=utf-8"},
            json={"msg_type": "text", "content": {"text": str(text or "")}},
            timeout=20,
        )
        data = res.json() if res.headers.get("content-type", "").lower().startswith("application/json") else {}
        code = data.get("code", data.get("StatusCode", 0)) if isinstance(data, dict) else 0
        if not res.ok or int(code or 0) != 0:
            raise HTTPException(status_code=502, detail=f"Feishu webhook send failed: {data or res.text}")
        return {"success": True, "mode": "webhook", "raw": data}

    if not target_id:
        raise HTTPException(status_code=400, detail="Feishu receive_id is required")
    if target_type not in {"chat_id", "open_id", "user_id", "union_id", "email"}:
        raise HTTPException(status_code=400, detail=f"Unsupported Feishu receive_id_type: {target_type}")

    token = get_tenant_access_token(user_id, ai_config_id)
    res = requests.post(
        f"{FEISHU_OPEN_API_BASE}/im/v1/messages",
        params={"receive_id_type": target_type},
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
        },
        json={
            "receive_id": target_id,
            "msg_type": "text",
            "content": json.dumps({"text": str(text or "")}, ensure_ascii=False),
        },
        timeout=20,
    )
    data = res.json() if res.headers.get("content-type", "").lower().startswith("application/json") else {}
    if not res.ok or int(data.get("code") or 0) != 0:
        raise HTTPException(status_code=502, detail=f"Feishu send_message failed: {data or res.text}")
    return {
        "success": True,
        "receive_id": target_id,
        "receive_id_type": target_type,
        "message_id": (data.get("data") or {}).get("message_id"),
        "raw": data,
    }


def parse_feishu_text_event(payload: Dict[str, Any]) -> Optional[Dict[str, str]]:
    event = payload.get("event") if isinstance(payload.get("event"), dict) else {}
    message = event.get("message") if isinstance(event.get("message"), dict) else {}
    if not message:
        return None
    sender = event.get("sender") if isinstance(event.get("sender"), dict) else {}
    sender_type = str(sender.get("sender_type") or "").strip()
    if sender_type == "bot":
        return None
    message_type = str(message.get("message_type") or "").strip()
    if message_type and message_type != "text":
        return None
    content_raw = str(message.get("content") or "")
    text = ""
    try:
        content = json.loads(content_raw)
        text = str(content.get("text") or "").strip()
    except Exception:
        text = content_raw.strip()
    mentions = message.get("mentions") if isinstance(message.get("mentions"), list) else []
    for item in mentions:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip()
        if key:
            text = text.replace(key, "")
    text = " ".join(text.split()).strip()
    if not text:
        return None
    sender_id = sender.get("sender_id") if isinstance(sender.get("sender_id"), dict) else {}
    return {
        "text": text,
        "chat_id": str(message.get("chat_id") or "").strip(),
        "message_id": str(message.get("message_id") or "").strip(),
        "open_id": str(sender_id.get("open_id") or "").strip(),
        "user_id": str(sender_id.get("user_id") or "").strip(),
        "chat_type": str(message.get("chat_type") or "").strip(),
        "sender_type": sender_type,
    }

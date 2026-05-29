import json
import base64
import re
import time
from typing import Any, Dict, Optional

import requests
from fastapi import HTTPException
from sqlmodel import Session, select

from api.database import engine
from api.integrations.media_source import MediaSource, infer_media_kind, resolve_media_source
from api.models import AssistantAIConfig
from ._config import read_qq_config

QQ_TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken"
QQ_API_BASE = "https://api.sgroup.qq.com"
QQ_SANDBOX_API_BASE = "https://sandbox.api.sgroup.qq.com"
_TOKEN_CACHE: Dict[int, Dict[str, Any]] = {}


def normalize_qq_text(text: str) -> str:
    body = str(text or "")
    if not body:
        return ""
    body = body.replace("\r\n", "\n").replace("\r", "\n")
    body = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", body)
    body = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1", body)
    body = re.sub(r"```[^\n]*\n?", "", body).replace("```", "")
    lines = []
    for raw_line in body.split("\n"):
        line = raw_line.rstrip()
        line = re.sub(r"^\s{0,3}#{1,6}\s*", "", line)
        line = re.sub(r"^\s{0,3}>\s?", "", line)
        line = re.sub(r"^\s*[-*+]\s+", "", line)
        line = re.sub(r"^\s*\d+[.)]\s+", "", line)
        lines.append(line)
    body = "\n".join(lines)
    body = re.sub(r"(?<!\w)([*_~]{1,3})(\S(?:.*?\S)?)\1(?!\w)", r"\2", body)
    body = body.replace("`", "")
    body = re.sub(r"\[\s*[xX ]\s*\]\s*", "", body)
    body = re.sub(r"\\([\\`*_{}\[\]()#+\-.!|>])", r"\1", body)
    body = re.sub(r"[ \t]{2,}", " ", body)
    body = re.sub(r"\n{3,}", "\n\n", body)
    return body.strip()


def _normalize_target_type(raw: str) -> str:
    value = str(raw or "c2c").strip().lower()
    aliases = {
        "user": "c2c",
        "private": "c2c",
        "openid": "c2c",
        "guild": "channel",
        "direct": "dm",
    }
    value = aliases.get(value, value)
    if value not in {"c2c", "group", "channel", "dm"}:
        raise HTTPException(status_code=400, detail=f"Unsupported QQ target_type: {value}")
    return value


def _load_qq_config(user_id: int, ai_config_id: Optional[int]) -> AssistantAIConfig:
    if not ai_config_id:
        raise HTTPException(status_code=400, detail="qq tool requires ai_config_id")
    with Session(engine) as session:
        cfg = session.exec(
            select(AssistantAIConfig).where(
                AssistantAIConfig.id == ai_config_id,
                AssistantAIConfig.user_id == user_id,
            )
        ).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="AI config not found")
    if str(cfg.bot_channel or "feishu").strip().lower() != "qq":
        raise HTTPException(status_code=400, detail="QQ bot is not the active channel for this AI")
    bot_cfg = read_qq_config(cfg)
    if not bot_cfg.get("enabled"):
        raise HTTPException(status_code=400, detail="QQ bot is not enabled for this AI")
    if not bot_cfg.get("app_id") or not bot_cfg.get("app_secret"):
        raise HTTPException(status_code=400, detail="QQ App ID / App Secret not configured")
    return cfg


def get_qq_access_token(user_id: int, ai_config_id: Optional[int]) -> str:
    cfg = _load_qq_config(user_id, ai_config_id)
    bot_cfg = read_qq_config(cfg)
    now = time.time()
    cache = _TOKEN_CACHE.get(int(cfg.id or 0))
    if cache and cache.get("token") and float(cache.get("expires_at") or 0) > now + 120:
        return str(cache["token"])

    res = requests.post(
        QQ_TOKEN_URL,
        headers={"Content-Type": "application/json"},
        json={"appId": str(bot_cfg.get("app_id") or ""), "clientSecret": str(bot_cfg.get("app_secret") or "")},
        timeout=20,
    )
    data = res.json() if res.headers.get("content-type", "").lower().startswith("application/json") else {}
    if not res.ok or not data.get("access_token"):
        raise HTTPException(status_code=502, detail=f"QQ token failed: {data or res.text}")
    token = str(data.get("access_token") or "").strip()
    expire = int(data.get("expires_in") or 7200)
    _TOKEN_CACHE[int(cfg.id or 0)] = {"token": token, "expires_at": now + max(60, expire)}
    return token


def _qq_api_base(cfg: AssistantAIConfig) -> str:
    return QQ_SANDBOX_API_BASE if bool(read_qq_config(cfg).get("sandbox")) else QQ_API_BASE


def _message_endpoint(cfg: AssistantAIConfig, target_type: str, target_id: str) -> str:
    base = _qq_api_base(cfg)
    if target_type == "c2c":
        return f"{base}/v2/users/{target_id}/messages"
    if target_type == "group":
        return f"{base}/v2/groups/{target_id}/messages"
    if target_type == "channel":
        return f"{base}/channels/{target_id}/messages"
    if target_type == "dm":
        return f"{base}/dms/{target_id}/messages"
    raise HTTPException(status_code=400, detail=f"Unsupported QQ target_type: {target_type}")


def _qq_headers(cfg: AssistantAIConfig, token: str) -> Dict[str, str]:
    return {
        "Authorization": f"QQBot {token}",
        "Content-Type": "application/json",
        "X-Union-Appid": str(read_qq_config(cfg).get("app_id") or ""),
    }


def _qq_media_file_endpoint(cfg: AssistantAIConfig, target_type: str, target_id: str) -> str:
    base = _qq_api_base(cfg)
    if target_type == "c2c":
        return f"{base}/v2/users/{target_id}/files"
    if target_type == "group":
        return f"{base}/v2/groups/{target_id}/files"
    raise HTTPException(status_code=400, detail="QQ media upload currently supports c2c or group targets")


def upload_qq_media_file_info(
    user_id: int,
    ai_config_id: Optional[int],
    *,
    source: MediaSource,
    target_id: str,
    target_type: str,
    media_type: str,
) -> str:
    cfg = _load_qq_config(user_id, ai_config_id)
    final_target_type = _normalize_target_type(target_type)
    if final_target_type not in {"c2c", "group"}:
        raise HTTPException(status_code=400, detail="QQ image/video messages are supported for c2c or group targets")
    kind = infer_media_kind(source, media_type)
    file_type = 1 if kind == "image" else 2
    payload: Dict[str, Any] = {
        "file_type": file_type,
        "srv_send_msg": False,
    }
    if source.source_url:
        payload["url"] = source.source_url
    else:
        with open(source.path, "rb") as fh:
            payload["file_data"] = base64.b64encode(fh.read()).decode("ascii")
    token = get_qq_access_token(user_id, ai_config_id)
    res = requests.post(
        _qq_media_file_endpoint(cfg, final_target_type, target_id),
        headers=_qq_headers(cfg, token),
        json=payload,
        timeout=60,
    )
    data = res.json() if res.headers.get("content-type", "").lower().startswith("application/json") else {}
    if not res.ok or (isinstance(data, dict) and data.get("code") not in (None, 0)):
        raise HTTPException(status_code=502, detail=f"QQ media upload failed: {data or res.text}")
    file_info = str(data.get("file_info") or (data.get("data") or {}).get("file_info") or "").strip()
    if not file_info:
        raise HTTPException(status_code=502, detail="QQ media upload response missing file_info")
    return file_info


def send_qq_text_message(
    user_id: int,
    ai_config_id: Optional[int],
    *,
    text: str,
    target_id: str = "",
    target_type: str = "",
    msg_id: str = "",
    event_id: str = "",
    msg_seq: Optional[int] = None,
) -> Dict[str, Any]:
    cfg = _load_qq_config(user_id, ai_config_id)
    bot_cfg = read_qq_config(cfg)
    body = normalize_qq_text(text)
    if not body:
        raise HTTPException(status_code=400, detail="QQ message text is required")
    final_target_id = str(target_id or bot_cfg.get("default_target_id") or "").strip()
    final_target_type = _normalize_target_type(target_type or bot_cfg.get("default_target_type") or "c2c")
    if not final_target_id:
        raise HTTPException(status_code=400, detail="QQ target_id is required")

    payload: Dict[str, Any] = {"content": body, "msg_type": 0}
    if msg_id:
        payload["msg_id"] = str(msg_id)
        if msg_seq is not None:
            payload["msg_seq"] = int(msg_seq)
    if event_id and not msg_id:
        payload["event_id"] = str(event_id)

    token = get_qq_access_token(user_id, ai_config_id)
    res = requests.post(
        _message_endpoint(cfg, final_target_type, final_target_id),
        headers=_qq_headers(cfg, token),
        json=payload,
        timeout=20,
    )
    data = res.json() if res.headers.get("content-type", "").lower().startswith("application/json") else {}
    if not res.ok or (isinstance(data, dict) and data.get("code") not in (None, 0)):
        raise HTTPException(status_code=502, detail=f"QQ send_message failed: {data or res.text}")
    return {
        "success": True,
        "target_id": final_target_id,
        "target_type": final_target_type,
        "message_id": data.get("id") if isinstance(data, dict) else None,
        "raw": data,
    }


def diagnose_qq_config(user_id: int, ai_config_id: Optional[int]) -> Dict[str, Any]:
    cfg = _load_qq_config(user_id, ai_config_id)
    bot_cfg = read_qq_config(cfg)
    token = get_qq_access_token(user_id, ai_config_id)
    return {
        "success": True,
        "ai_config_id": int(cfg.id or 0),
        "bot_channel": str(cfg.bot_channel or ""),
        "qq_enabled": bool(bot_cfg.get("enabled")),
        "app_id_configured": bool(str(bot_cfg.get("app_id") or "").strip()),
        "app_secret_configured": bool(str(bot_cfg.get("app_secret") or "").strip()),
        "sandbox": bool(bot_cfg.get("sandbox")),
        "api_base": _qq_api_base(cfg),
        "default_target_id_configured": bool(str(bot_cfg.get("default_target_id") or "").strip()),
        "default_target_type": str(bot_cfg.get("default_target_type") or "c2c"),
        "token_ok": bool(token),
        "token_preview": f"{token[:6]}..." if token else "",
    }


def send_qq_media_message(
    user_id: int,
    ai_config_id: Optional[int],
    *,
    media_url: str = "",
    media_path: str = "",
    media_type: str = "",
    file_name: str = "",
    target_id: str = "",
    target_type: str = "",
    text: str = "",
    msg_id: str = "",
    event_id: str = "",
    msg_seq: Optional[int] = None,
) -> Dict[str, Any]:
    cfg = _load_qq_config(user_id, ai_config_id)
    bot_cfg = read_qq_config(cfg)
    final_target_id = str(target_id or bot_cfg.get("default_target_id") or "").strip()
    final_target_type = _normalize_target_type(target_type or bot_cfg.get("default_target_type") or "c2c")
    if not final_target_id:
        raise HTTPException(status_code=400, detail="QQ target_id is required")
    if final_target_type not in {"c2c", "group"}:
        raise HTTPException(status_code=400, detail="QQ image/video messages are supported for c2c or group targets")
    source = resolve_media_source(
        url=media_url,
        path=media_path,
        filename=file_name,
        max_bytes=30 * 1024 * 1024,
    )
    try:
        file_info = upload_qq_media_file_info(
            user_id,
            ai_config_id,
            source=source,
            target_id=final_target_id,
            target_type=final_target_type,
            media_type=media_type,
        )
    finally:
        source.cleanup()

    payload: Dict[str, Any] = {
        "msg_type": 7,
        "media": {"file_info": file_info},
    }
    content = normalize_qq_text(text)
    if content:
        payload["content"] = content
    if msg_id:
        payload["msg_id"] = str(msg_id)
        if msg_seq is not None:
            payload["msg_seq"] = int(msg_seq)
    if event_id and not msg_id:
        payload["event_id"] = str(event_id)

    token = get_qq_access_token(user_id, ai_config_id)
    res = requests.post(
        _message_endpoint(cfg, final_target_type, final_target_id),
        headers=_qq_headers(cfg, token),
        json=payload,
        timeout=20,
    )
    data = res.json() if res.headers.get("content-type", "").lower().startswith("application/json") else {}
    if not res.ok or (isinstance(data, dict) and data.get("code") not in (None, 0)):
        raise HTTPException(status_code=502, detail=f"QQ send_media failed: {data or res.text}")
    return {
        "success": True,
        "target_id": final_target_id,
        "target_type": final_target_type,
        "message_id": data.get("id") if isinstance(data, dict) else None,
        "raw": data,
    }


def parse_qq_text_event(payload: Dict[str, Any]) -> Optional[Dict[str, str]]:
    event_type = str(payload.get("t") or "").strip()
    data = payload.get("d") if isinstance(payload.get("d"), dict) else {}
    if not data:
        return None
    if event_type not in {
        "C2C_MESSAGE_CREATE",
        "GROUP_AT_MESSAGE_CREATE",
        "AT_MESSAGE_CREATE",
        "MESSAGE_CREATE",
        "DIRECT_MESSAGE_CREATE",
    }:
        return None

    text = str(data.get("content") or "").strip()
    if not text:
        return None
    # QQ group/channel events may include the bot mention in content.
    text = re.sub(r"<@!?\d+>", "", text).strip()
    text = " ".join(text.split()).strip()
    if not text:
        return None

    message_id = str(data.get("id") or "").strip()
    event_id = str(payload.get("id") or data.get("event_id") or "").strip()
    if event_type == "C2C_MESSAGE_CREATE":
        author = data.get("author") if isinstance(data.get("author"), dict) else {}
        target_id = str(data.get("author_id") or author.get("user_openid") or author.get("id") or data.get("user_openid") or "").strip()
        target_type = "c2c"
    elif event_type == "GROUP_AT_MESSAGE_CREATE":
        target_id = str(data.get("group_openid") or data.get("group_id") or "").strip()
        target_type = "group"
    elif event_type == "DIRECT_MESSAGE_CREATE":
        target_id = str(data.get("guild_id") or "").strip()
        target_type = "dm"
    else:
        target_id = str(data.get("channel_id") or "").strip()
        target_type = "channel"

    if not target_id:
        return None
    return {
        "text": text,
        "message_id": message_id,
        "event_id": event_id,
        "target_id": target_id,
        "target_type": target_type,
        "event_type": event_type,
        "raw": json.dumps(data, ensure_ascii=False),
    }

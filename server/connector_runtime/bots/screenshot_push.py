"""Deliver a captured screenshot straight to the user, bypassing the AI.

Used when a screenshot MCP tool (``browser_screenshot`` / ``screen.capture`` /
``vision.capture`` …) is called with ``send_to_user=true``: instead of feeding
the captured image back into the model context, the picture must reach the
human directly — through whichever bot (Feishu / QQ) backs the chat session.

The captured image is already persisted by ``screenshot_store`` (so it owns a
server path and, when ``public_base_url`` is configured, a public URL); here we
just look up the session's outbound route and hand the image to the matching
:class:`BotAdapter` via ``send_media``. Failures never raise — they are logged
and reported so the caller can tell the model what happened.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from sqlmodel import Session, select

from api.models import BotSessionRoute

from .base import channel_for_session_id
from .registry import get as get_bot, iter_bots

logger = logging.getLogger(__name__)


def _route_target(
    session: Session,
    *,
    channel: str,
    user_id: int,
    ai_config_id: int,
    ai_kind: str,
    session_id: str,
) -> Optional[Dict[str, Any]]:
    """Return the bot-specific addressing payload for an outbound message.

    ``BotSessionRoute.target_json`` already stores exactly the ``target`` dict
    each adapter's ``send_media`` expects (Feishu ``receive_id`` /
    ``receive_id_type``; QQ ``target_id`` / ``target_type``). We also fold in
    the QQ reply bookkeeping (``source_message_id`` / ``source_event_id``) so a
    proactive push can ride the last inbound message when the channel needs it.
    """
    row = session.exec(
        select(BotSessionRoute).where(
            BotSessionRoute.channel == channel,
            BotSessionRoute.user_id == int(user_id),
            BotSessionRoute.ai_config_id == int(ai_config_id),
            BotSessionRoute.ai_kind == str(ai_kind or "core"),
            BotSessionRoute.session_id == str(session_id or ""),
        )
    ).first()
    if row is None:
        return None
    try:
        target = json.loads(row.target_json or "{}")
    except Exception:
        target = {}
    if not isinstance(target, dict):
        target = {}
    src_msg = str(getattr(row, "source_message_id", "") or "")
    src_evt = str(getattr(row, "source_event_id", "") or "")
    if src_msg:
        target.setdefault("msg_id", src_msg)
    if src_evt:
        target.setdefault("event_id", src_evt)
    return target


def deliver_screenshot_to_user(
    session: Session,
    *,
    user_id: int,
    ai_config_id: Optional[int],
    ai_kind: str,
    session_id: str,
    tool: str,
    image: Dict[str, Any],
    text: str = "",
) -> Dict[str, Any]:
    """Push a captured screenshot to the user through the session's bot.

    ``image`` carries ``url`` / ``path`` / ``file_name``. Returns a small,
    JSON-friendly delivery report; never raises.
    """
    media_url = str((image or {}).get("url") or "").strip()
    media_path = str((image or {}).get("path") or "").strip()
    if not media_url and not media_path:
        return {"delivered": False, "reason": "no_image_payload"}

    channel = channel_for_session_id(str(session_id or ""), iter_bots())
    if not channel:
        # Web / non-bot session: the screenshot chat bubble already shows it to
        # the user, so there is no separate bot to push through.
        return {"delivered": False, "reason": "no_bot_session", "via": "chat"}
    if ai_config_id is None:
        return {"delivered": False, "reason": "missing_ai_config", "channel": channel}

    bot = get_bot(channel)
    if bot is None:
        return {"delivered": False, "reason": "channel_unavailable", "channel": channel}

    target = _route_target(
        session,
        channel=channel,
        user_id=int(user_id),
        ai_config_id=int(ai_config_id),
        ai_kind=str(ai_kind or "core"),
        session_id=str(session_id or ""),
    )
    if not target:
        return {"delivered": False, "reason": "no_route", "channel": channel}

    media = {
        "url": media_url,
        "path": media_path,
        "type": "image",
        "file_name": str((image or {}).get("file_name") or "screenshot.png"),
    }
    try:
        result = bot.send_media(
            user_id=int(user_id),
            ai_config_id=int(ai_config_id),
            text=str(text or ""),
            media=media,
            target=target,
        )
        return {"delivered": True, "channel": channel, "result": result}
    except Exception as exc:
        logger.exception("screenshot bot delivery failed: %s", exc)
        return {"delivered": False, "reason": str(exc), "channel": channel}

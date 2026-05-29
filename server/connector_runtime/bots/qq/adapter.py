"""QQ bot adapter (Tencent's botpy backend).

Thin façade over ``service.py`` / ``long_connection.py``; same shape as
:class:`FeishuBot` so cross-cutting code can stay channel-agnostic.
"""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Any, Dict, Optional

from ..base import BotAdapter
from ..registry import register
from ._config import QQ_DEFAULTS


logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from sqlmodel import Session

    from api.models import AssistantAIConfig, ChatMessage
    from .routes_store import QQRouteHandle


class QQBot(BotAdapter):
    channel = "qq"
    label = "QQ"
    session_prefix = "qq_"

    # ---- config -----------------------------------------------------------

    def default_config(self) -> dict:
        return dict(QQ_DEFAULTS)

    # ---- enablement --------------------------------------------------------

    def is_enabled(self, cfg: "AssistantAIConfig") -> bool:
        channel = str(getattr(cfg, "bot_channel", "") or "feishu").strip().lower()
        if channel != self.channel:
            return False
        return bool(self.read_config(cfg).get("enabled"))

    # ---- long-connection lifecycle ----------------------------------------

    def start_long_connections(self) -> int:
        from .long_connection import start_qq_long_connection_clients
        return start_qq_long_connection_clients()

    def get_long_connection_state(self, ai_config_id: int) -> Dict[str, str]:
        from .long_connection import get_qq_long_connection_state
        return get_qq_long_connection_state(ai_config_id)

    # ---- outbound messaging -----------------------------------------------

    def send_text(
        self,
        *,
        user_id: int,
        ai_config_id: Optional[int],
        text: str,
        target: Dict[str, Any],
    ) -> Any:
        from .service import send_qq_text_message
        return send_qq_text_message(
            user_id,
            ai_config_id,
            text=text,
            target_id=str(target.get("target_id") or ""),
            target_type=str(target.get("target_type") or ""),
            msg_id=str(target.get("msg_id") or ""),
            event_id=str(target.get("event_id") or ""),
            msg_seq=int(target["msg_seq"]) if target.get("msg_seq") is not None else None,
        )

    def send_media(
        self,
        *,
        user_id: int,
        ai_config_id: Optional[int],
        text: str,
        media: Dict[str, Any],
        target: Dict[str, Any],
    ) -> Any:
        from .service import send_qq_media_message
        return send_qq_media_message(
            user_id,
            ai_config_id,
            media_url=str(media.get("url") or ""),
            media_path=str(media.get("path") or ""),
            media_type=str(media.get("type") or ""),
            file_name=str(media.get("file_name") or ""),
            target_id=str(target.get("target_id") or ""),
            target_type=str(target.get("target_type") or ""),
            text=text,
            msg_id=str(target.get("msg_id") or ""),
            event_id=str(target.get("event_id") or ""),
            msg_seq=int(target["msg_seq"]) if target.get("msg_seq") is not None else None,
        )

    def normalize_text(self, text: str, *, strip_markdown: bool = True) -> str:
        # ``normalize_qq_text`` already strips markdown unconditionally —
        # we accept the kwarg for interface uniformity and ignore it.
        from .service import normalize_qq_text
        return normalize_qq_text(text)

    # ---- notify dispatch --------------------------------------------------

    def load_session_route(
        self, session: "Session", message: "ChatMessage"
    ) -> Optional["QQRouteHandle"]:
        from .routes_store import load_qq_route
        return load_qq_route(session, message)

    def notify_assistant_message(
        self,
        session: "Session",
        message: "ChatMessage",
        *,
        rendered_content: str,
        route: Any,
    ) -> None:
        from .service import send_qq_text_message

        # ``route`` is a QQRouteHandle (see routes_store). Its ``.row`` is the
        # live BotSessionRoute we mutate to bump msg_seq atomically.
        msg_seq = max(1, int(route.next_msg_seq or 1))
        try:
            send_qq_text_message(
                int(message.user_id),
                int(message.ai_config_id or 0),
                text=rendered_content,
                target_id=route.target_id,
                target_type=route.target_type or "c2c",
                msg_id=route.source_message_id,
                event_id=route.source_event_id,
                msg_seq=msg_seq if route.source_message_id else None,
            )
            # Bump the per-conversation sequence so the next reply lands
            # in order even when QQ enforces strict msg_seq ordering.
            route.row.next_msg_seq = msg_seq + 1
            route.row.updated_at = time.time()
            session.add(route.row)
            session.commit()
        except Exception as exc:
            logger.exception(f"send failed message_id={message.id}: {exc}")

    # ---- diagnostics ------------------------------------------------------

    def diagnose(self, cfg: "AssistantAIConfig", *, user_id: int) -> Dict[str, Any]:
        """End-to-end check: config presence + access-token fetch + state."""
        from .long_connection import get_qq_long_connection_state
        from .service import diagnose_qq_config

        out: Dict[str, Any] = {"supported": True}
        try:
            out.update(diagnose_qq_config(user_id, int(cfg.id or 0)))
        except Exception as exc:
            # Surface but don't raise — the UI should still get a structured
            # result even when token fetch fails.
            out.update({"success": False, "error": str(exc)})
        bot_state = get_qq_long_connection_state(int(cfg.id or 0))
        out["bot_status"] = bot_state
        out["status"] = bot_state.get("status") or out.get("status") or "failed"
        out["connection_mode"] = "botpy_websocket"
        out["callback_path"] = f"/api/qq/events/{int(cfg.id or 0)}"
        out["ok"] = bool(out.get("success") and bot_state.get("status") == "success")
        return out

    # ---- status -----------------------------------------------------------

    def build_status(
        self,
        cfg: "AssistantAIConfig",
        *,
        remote_state: Optional[Dict[str, str]] = None,
        remote_error: Optional[str] = None,
    ) -> Dict[str, str]:
        if str(cfg.bot_channel or "feishu").strip().lower() != self.channel:
            return {"status": "disabled", "mode": "off", "label": "未启用", "message": "当前机器人类型不是 QQ"}
        bot_cfg = self.read_config(cfg)
        if not bot_cfg.get("enabled"):
            return {"status": "disabled", "mode": "off", "label": "未启用", "message": "QQ机器人未启用"}
        app_id = str(bot_cfg.get("app_id") or "").strip()
        app_secret = str(bot_cfg.get("app_secret") or "").strip()
        if not app_id or not app_secret:
            return {
                "status": "failed",
                "mode": "long_connection",
                "label": "失败",
                "message": "App ID / Secret 配置不完整",
            }
        state = remote_state
        if state is None:
            if remote_error:
                return {
                    "status": "failed",
                    "mode": "long_connection",
                    "label": "失败",
                    "message": f"connector-runtime 状态不可用: {remote_error}",
                }
            state = self.get_long_connection_state(int(cfg.id or 0))
        label = "成功" if state.get("status") == "success" and "启动中" not in str(state.get("message") or "") else "失败"
        if "启动中" in str(state.get("message") or ""):
            label = "启动中"
        return {
            "status": state.get("status") or "failed",
            "mode": "long_connection",
            "label": label,
            "message": state.get("message") or "botpy 长连接未运行",
        }


# Self-register the singleton at import time.
register(QQBot())

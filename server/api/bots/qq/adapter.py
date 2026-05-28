"""QQ bot adapter (Tencent's botpy backend).

Thin façade over ``service.py`` / ``long_connection.py``; same shape as
:class:`FeishuBot` so cross-cutting code can stay channel-agnostic.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any, Dict, Optional

from ..base import BotAdapter
from ..registry import register

if TYPE_CHECKING:
    from sqlmodel import Session

    from ...models import AssistantAIConfig, ChatMessage
    from .models import QQSessionRoute


class QQBot(BotAdapter):
    channel = "qq"
    label = "QQ"
    session_prefix = "qq_"

    # ---- enablement --------------------------------------------------------

    def is_enabled(self, cfg: "AssistantAIConfig") -> bool:
        channel = str(getattr(cfg, "bot_channel", "") or "feishu").strip().lower()
        return channel == self.channel and bool(getattr(cfg, "qq_enabled", False))

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
    ) -> Optional["QQSessionRoute"]:
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
        from sqlmodel import Session as _Session  # noqa: F401 — for type, route mutation only

        msg_seq = max(1, int(getattr(route, "next_msg_seq", 1) or 1))
        try:
            send_qq_text_message(
                int(message.user_id),
                int(message.ai_config_id or 0),
                text=rendered_content,
                target_id=str(getattr(route, "target_id", "") or ""),
                target_type=str(getattr(route, "target_type", "") or "c2c"),
                msg_id=str(getattr(route, "source_message_id", "") or ""),
                event_id=str(getattr(route, "source_event_id", "") or ""),
                msg_seq=msg_seq if getattr(route, "source_message_id", "") else None,
            )
            # Bump the per-conversation sequence so the next reply lands
            # in order even when QQ enforces strict msg_seq ordering.
            route.next_msg_seq = msg_seq + 1
            route.updated_at = time.time()
            session.add(route)
            session.commit()
        except Exception as exc:
            print(f"[qq_auto_notify] send failed message_id={message.id}: {exc}")

    # ---- config writeback -------------------------------------------------

    def disable_in_config_updates(self, updates: Dict[str, Any]) -> None:
        updates["qq_enabled"] = False

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
        if not cfg.qq_enabled:
            return {"status": "disabled", "mode": "off", "label": "未启用", "message": "QQ机器人未启用"}
        app_id = str(cfg.qq_app_id or "").strip()
        app_secret = str(cfg.qq_app_secret or "").strip()
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

"""Feishu (Lark) bot adapter.

Wraps the existing service / long-connection helpers behind the uniform
:class:`BotAdapter` interface. The adapter is a thin façade — the real
work continues to live in ``service.py`` / ``long_connection.py`` and the
``router.py`` HTTP handlers.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, Optional

from ..base import BotAdapter
from ..registry import register

if TYPE_CHECKING:
    from sqlmodel import Session

    from ...models import AssistantAIConfig, ChatMessage
    from .routes_store import FeishuRouteView


# Feishu's open API caps single text messages at ~2KB; we chunk well below
# that to leave room for the assistant-prefix icons we glue on the front.
FEISHU_TEXT_MAX_CHARS = 1800


class FeishuBot(BotAdapter):
    channel = "feishu"
    label = "飞书"
    session_prefix = "feishu_"

    # ---- enablement --------------------------------------------------------

    def is_enabled(self, cfg: "AssistantAIConfig") -> bool:
        channel = str(getattr(cfg, "bot_channel", "") or "feishu").strip().lower()
        return channel == self.channel and bool(getattr(cfg, "feishu_enabled", False))

    # ---- long-connection lifecycle ----------------------------------------

    def start_long_connections(self) -> int:
        from .long_connection import start_feishu_long_connection_clients
        return start_feishu_long_connection_clients()

    def get_long_connection_state(self, ai_config_id: int) -> Dict[str, str]:
        from .long_connection import get_feishu_long_connection_state
        return get_feishu_long_connection_state(ai_config_id)

    # ---- outbound messaging -----------------------------------------------

    def send_text(
        self,
        *,
        user_id: int,
        ai_config_id: Optional[int],
        text: str,
        target: Dict[str, Any],
    ) -> Any:
        from .service import send_feishu_text_message
        return send_feishu_text_message(
            user_id,
            ai_config_id,
            text=text,
            receive_id=str(target.get("receive_id") or ""),
            receive_id_type=str(target.get("receive_id_type") or ""),
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
        from .service import send_feishu_media_message, send_feishu_text_message

        media_url = str(media.get("url") or "").strip()
        media_path = str(media.get("path") or "").strip()
        media_type = str(media.get("type") or "").strip()
        file_name = str(media.get("file_name") or "").strip()
        duration = media.get("duration")
        receive_id = str(target.get("receive_id") or "")
        receive_id_type = str(target.get("receive_id_type") or "")

        results = []
        # Feishu requires text and media to ride on separate messages.
        if text and (media_url or media_path):
            results.append(
                send_feishu_text_message(
                    user_id,
                    ai_config_id,
                    text=text,
                    receive_id=receive_id,
                    receive_id_type=receive_id_type,
                )
            )
        results.append(
            send_feishu_media_message(
                user_id,
                ai_config_id,
                media_url=media_url,
                media_path=media_path,
                media_type=media_type,
                file_name=file_name,
                receive_id=receive_id,
                receive_id_type=receive_id_type,
                duration=int(duration) if duration is not None else None,
            )
        )
        if len(results) > 1:
            return {"success": True, "results": results}
        return results[-1]

    def normalize_text(self, text: str, *, strip_markdown: bool = True) -> str:
        from .service import normalize_feishu_text
        return normalize_feishu_text(text, strip_markdown=strip_markdown)

    # ---- notify dispatch --------------------------------------------------

    def load_session_route(
        self, session: "Session", message: "ChatMessage"
    ) -> Optional["FeishuRouteView"]:
        from .routes_store import load_feishu_route
        return load_feishu_route(session, message)

    def notify_assistant_message(
        self,
        session: "Session",
        message: "ChatMessage",
        *,
        rendered_content: str,
        route: Any,
    ) -> None:
        from .service import send_feishu_text_message

        receive_id = str(getattr(route, "receive_id", "") or "")
        receive_id_type = str(getattr(route, "receive_id_type", "") or "chat_id")
        for start in range(0, len(rendered_content), FEISHU_TEXT_MAX_CHARS):
            chunk = rendered_content[start:start + FEISHU_TEXT_MAX_CHARS].strip()
            if not chunk:
                continue
            try:
                send_feishu_text_message(
                    int(message.user_id),
                    int(message.ai_config_id or 0),
                    text=chunk,
                    receive_id=receive_id,
                    receive_id_type=receive_id_type,
                )
            except Exception as exc:
                print(f"[feishu_auto_notify] send failed message_id={message.id}: {exc}")
                return

    # ---- runtime tool requirements ---------------------------------------

    def extra_required_mcp_tools(self) -> set:
        # Feishu conversations need a self-service context-trim path even
        # for older AI configs whose saved MCP allowlist predates this tool.
        return {"conversation.forget_before_current"}

    # ---- config writeback -------------------------------------------------

    def disable_in_config_updates(self, updates: Dict[str, Any]) -> None:
        updates["feishu_enabled"] = False

    # ---- status -----------------------------------------------------------

    def build_status(
        self,
        cfg: "AssistantAIConfig",
        *,
        remote_state: Optional[Dict[str, str]] = None,
        remote_error: Optional[str] = None,
    ) -> Dict[str, str]:
        if str(cfg.bot_channel or "feishu").strip().lower() != self.channel:
            return {"status": "disabled", "mode": "off", "label": "未启用", "message": "当前机器人类型不是飞书"}
        if not cfg.feishu_enabled:
            return {"status": "disabled", "mode": "off", "label": "未启用", "message": "飞书机器人未启用"}
        app_id = str(cfg.feishu_app_id or "").strip()
        app_secret = str(cfg.feishu_app_secret or "").strip()
        webhook_url = str(cfg.feishu_webhook_url or "").strip()
        if app_id or app_secret:
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
            return {
                "status": state.get("status") or "failed",
                "mode": "long_connection",
                "label": "成功" if state.get("status") == "success" else "失败",
                "message": state.get("message") or "",
            }
        if webhook_url:
            return {
                "status": "success",
                "mode": "webhook",
                "label": "成功",
                "message": "仅通知发送配置已完成",
            }
        return {"status": "failed", "mode": "none", "label": "失败", "message": "未配置 App ID/Secret 或 仅通知 URL"}


# Self-register the singleton at import time.
register(FeishuBot())

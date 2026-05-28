"""Abstract base class every bot adapter must implement.

Each :class:`BotAdapter` is a thin façade over a per-bot ``service`` /
``long_connection`` module. Cross-cutting code (gateway lifespan,
connector keepalive, notify dispatcher, status routes) talks to bots
through this interface only.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any, Dict, Iterable, Optional, Set

if TYPE_CHECKING:
    from sqlmodel import Session

    from ..models import AssistantAIConfig, ChatMessage


class BotAdapter(ABC):
    """Uniform interface a bot plugin exposes to the rest of the server.

    Concrete subclasses are expected to be cheap singletons — one instance
    per supported channel. The instance is registered with
    :func:`bots.register` at import time and is then reused everywhere.
    """

    #: Stable identifier used by ``AssistantAIConfig.bot_channel`` and by
    #: ``session_id`` prefixes (e.g. ``"feishu"`` -> ``"feishu_<id>_..."``).
    channel: str = ""

    #: Human-facing label shown in admin UI / diagnostics.
    label: str = ""

    #: Prefix used on ``ChatMessage.session_id`` to identify rows that came
    #: from this bot. ``""`` disables prefix-based routing.
    session_prefix: str = ""

    # ---- config / enablement ------------------------------------------------

    @abstractmethod
    def is_enabled(self, cfg: "AssistantAIConfig") -> bool:
        """Return True iff this bot should run for the given AI config."""

    # ---- long connection lifecycle -----------------------------------------

    @abstractmethod
    def start_long_connections(self) -> int:
        """(Re)start any long-running upstream client for this bot.

        Returns the number of configs that were brought up / refreshed.
        Implementations must be idempotent so the gateway / connector can
        call them on every keepalive tick.
        """

    @abstractmethod
    def get_long_connection_state(self, ai_config_id: int) -> Dict[str, str]:
        """Return ``{"status": "...", "label": "...", "message": "..."}``."""

    # ---- outbound messaging -------------------------------------------------

    @abstractmethod
    def send_text(
        self,
        *,
        user_id: int,
        ai_config_id: Optional[int],
        text: str,
        target: Dict[str, Any],
    ) -> Any:
        """Send a plain-text message via this bot.

        ``target`` is the bot-specific addressing payload (e.g. Feishu
        ``{"receive_id": ..., "receive_id_type": ...}`` or QQ
        ``{"target_id": ..., "target_type": ..., "msg_id": ..., ...}``).
        """

    @abstractmethod
    def send_media(
        self,
        *,
        user_id: int,
        ai_config_id: Optional[int],
        text: str,
        media: Dict[str, Any],
        target: Dict[str, Any],
    ) -> Any:
        """Send a media message (image/video/file) via this bot.

        ``media`` carries ``url`` / ``path`` / ``type`` / ``file_name`` /
        ``duration``. Adapters pick the fields relevant to their channel.
        """

    # ---- runtime tool requirements ----------------------------------------

    def extra_required_mcp_tools(self) -> Set[str]:
        """Extra MCP tools every chat that runs under this bot must allow.

        Default empty — most bots don't change the allowlist. Override per
        bot when the channel needs a tool that a stripped-down user config
        would otherwise omit (e.g. Feishu sessions always get
        ``conversation.forget_before_current``).
        """
        return set()

    # ---- config writeback --------------------------------------------------

    @abstractmethod
    def disable_in_config_updates(self, updates: Dict[str, Any]) -> None:
        """Mutate ``updates`` so this bot is turned off in ``AssistantAIConfig``.

        Used by the config switch route: when the user picks channel ``X``,
        every other registered bot has its enable flag flipped off via
        this hook so we don't leave two backends fighting over the same
        AI config.
        """


    # ---- formatting --------------------------------------------------------

    @abstractmethod
    def normalize_text(self, text: str, *, strip_markdown: bool = True) -> str:
        """Channel-specific text normalization for outbound messages."""

    # ---- notify dispatch ---------------------------------------------------

    @abstractmethod
    def load_session_route(
        self, session: "Session", message: "ChatMessage"
    ) -> Optional[Any]:
        """Look up the bot-specific routing row for an outbound message.

        Returns ``None`` when the message does not belong to this bot or
        no route is registered. Otherwise returns whatever bookkeeping
        object :meth:`notify_assistant_message` needs to deliver the reply.
        """

    @abstractmethod
    def notify_assistant_message(
        self,
        session: "Session",
        message: "ChatMessage",
        *,
        rendered_content: str,
        route: Any,
    ) -> None:
        """Deliver an already-rendered assistant message to the channel.

        ``rendered_content`` has already had MCP blocks stripped and any
        UI prefix (thinking / tool icons) applied. Adapters handle their
        own chunking, ack/sequence numbering, etc.
        """

    # ---- status -------------------------------------------------------------

    @abstractmethod
    def build_status(
        self,
        cfg: "AssistantAIConfig",
        *,
        remote_state: Optional[Dict[str, str]] = None,
        remote_error: Optional[str] = None,
    ) -> Dict[str, str]:
        """Return a UI status summary for the bots panel.

        ``remote_state`` is the state reported by connector-runtime for
        this config (when split deployment is in use). ``remote_error``
        is the connector-runtime error string when the remote call failed.
        When both are absent the adapter falls back to its in-process
        long-connection state.
        """


def channel_for_session_id(session_id: str, bots: Iterable[BotAdapter]) -> Optional[str]:
    """Identify which bot a ``ChatMessage.session_id`` belongs to via prefix.

    Returns the matching ``channel`` string or ``None`` if no bot claims it.
    """
    sid = str(session_id or "")
    for bot in bots:
        prefix = bot.session_prefix
        if prefix and sid.startswith(prefix):
            return bot.channel
    return None

"""Default config schema + read helper for the QQ bot."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict

from ..config_store import get_channel_config

if TYPE_CHECKING:
    from ...models import AssistantAIConfig


CHANNEL = "qq"

QQ_DEFAULTS: Dict[str, Any] = {
    "enabled": False,
    "app_id": "",
    "app_secret": "",
    "sandbox": False,
    "default_target_id": "",
    "default_target_type": "c2c",
}


def read_qq_config(cfg: "AssistantAIConfig") -> Dict[str, Any]:
    """Return QQ's slice of ``cfg.bot_configs`` with defaults applied."""
    return get_channel_config(cfg, CHANNEL, QQ_DEFAULTS)

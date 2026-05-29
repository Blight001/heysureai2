"""Bot plugin system — one self-contained package per chat channel.

Every supported bot (Feishu, QQ, …) lives under ``bots/<name>/`` and is
exposed through a uniform :class:`BotAdapter` interface. Code outside this
package never branches on ``"feishu"`` / ``"qq"`` directly — it asks the
registry for the right adapter and invokes the methods it needs.

Adding a new bot:
    1. Create ``bots/<name>/`` with an ``adapter.py`` that subclasses
       :class:`BotAdapter` and instantiates the adapter at import time.
    2. Import that module here so the adapter registers on package load.
    3. Add the per-bot config columns / DB models in ``bots/<name>/models.py``
       and run a migration to add them to ``assistantaiconfig``.
"""

from .base import BotAdapter
from .registry import all_channels, get, iter_active_for_config, iter_bots, register

# Importing the adapter modules triggers registration. Keep this list as the
# canonical "which bots ship with the server" enumeration.
from .feishu import adapter as _feishu_adapter  # noqa: F401 — side-effect import
from .qq import adapter as _qq_adapter  # noqa: F401 — side-effect import


__all__ = [
    "BotAdapter",
    "all_channels",
    "get",
    "iter_active_for_config",
    "iter_bots",
    "register",
]

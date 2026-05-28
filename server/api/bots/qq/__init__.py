"""QQ bot plugin (tencent.com/qq botpy backend).

Self-contained module — service / long-connection / router / models all
live here. Registration with the bot registry happens in :mod:`.adapter`,
which is imported by the top-level ``bots`` package.
"""

from .models import QQSessionRoute

__all__ = ["QQSessionRoute"]

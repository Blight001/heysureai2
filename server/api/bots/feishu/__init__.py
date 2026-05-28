"""Feishu (Lark) bot plugin.

Self-contained module — service / long-connection / router / models all
live here. Registration with the bot registry happens in :mod:`.adapter`,
which is imported by the top-level ``bots`` package.
"""

from .models import FeishuSessionRoute

__all__ = ["FeishuSessionRoute"]

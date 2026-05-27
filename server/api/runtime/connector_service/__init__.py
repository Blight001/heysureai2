"""``connector-runtime`` package.

Hosts the Socket.IO server that desktop / browser agents connect to, plus
HTTP endpoints used by ai-runtime to dispatch agent tasks and outbound
connector messages (Feishu / QQ).
"""

from .app import create_app

__all__ = ["create_app"]

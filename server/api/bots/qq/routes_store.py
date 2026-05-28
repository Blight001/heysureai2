"""QQ-specific session-route bookkeeping.

Tracks the upstream QQ addressing (``target_id`` + ``target_type``) plus
the per-message metadata QQ needs to keep replies ordered (``msg_id`` /
``event_id`` / ``next_msg_seq``).
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Optional

from sqlmodel import select

from .models import QQSessionRoute

if TYPE_CHECKING:
    from sqlmodel import Session

    from ...models import ChatMessage


def register_qq_session_route(
    session: "Session",
    *,
    user_id: int,
    ai_config_id: int,
    ai_kind: str,
    session_id: str,
    target_id: str,
    target_type: str,
    source_message_id: str = "",
    source_event_id: str = "",
    next_msg_seq: int = 1,
) -> None:
    session_id = str(session_id or "").strip()
    target_id = str(target_id or "").strip()
    target_type = str(target_type or "c2c").strip() or "c2c"
    if not session_id or not target_id:
        return
    row = session.exec(
        select(QQSessionRoute).where(
            QQSessionRoute.user_id == int(user_id),
            QQSessionRoute.ai_config_id == int(ai_config_id),
            QQSessionRoute.ai_kind == str(ai_kind or "core"),
            QQSessionRoute.session_id == session_id,
        )
    ).first()
    now = time.time()
    if row is None:
        row = QQSessionRoute(
            user_id=int(user_id),
            ai_config_id=int(ai_config_id),
            ai_kind=str(ai_kind or "core"),
            session_id=session_id,
            target_id=target_id,
            target_type=target_type,
            source_message_id=str(source_message_id or ""),
            source_event_id=str(source_event_id or ""),
            next_msg_seq=max(1, int(next_msg_seq or 1)),
        )
    else:
        row.target_id = target_id
        row.target_type = target_type
        row.source_message_id = str(source_message_id or row.source_message_id or "")
        row.source_event_id = str(source_event_id or row.source_event_id or "")
        row.next_msg_seq = max(int(row.next_msg_seq or 1), int(next_msg_seq or 1))
        row.updated_at = now
    session.add(row)
    session.commit()


def load_qq_route(
    session: "Session", message: "ChatMessage"
) -> Optional[QQSessionRoute]:
    if not message.ai_config_id:
        return None
    return session.exec(
        select(QQSessionRoute).where(
            QQSessionRoute.user_id == int(message.user_id),
            QQSessionRoute.ai_config_id == int(message.ai_config_id),
            QQSessionRoute.ai_kind == str(message.ai_kind or "core"),
            QQSessionRoute.session_id == str(message.session_id or ""),
        )
    ).first()

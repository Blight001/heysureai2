"""``ai-runtime`` worker pool — consume chat runs from the queue.

The dispatcher is dialect-aware:
- **Postgres**: a single LISTEN connection waits on the ``ai_run_queued``
  channel. Each NOTIFY wakes the dispatcher, which then claims one row via
  ``SELECT … FROM chatrun WHERE status='queued' ORDER BY id FOR UPDATE
  SKIP LOCKED LIMIT 1``. Multiple ai-runtime instances can run side by
  side and the database arbitrates fairly.
- **SQLite**: polling fallback, since SQLite has neither LISTEN/NOTIFY
  nor real row-level locking. Only one ai-runtime instance is supported
  in this mode.

In both cases the actual heavy lifting is delegated to ``_run_worker``
exactly like the monolith thread does today; the worker just runs it in
a dedicated thread per claimed run and the dispatcher loops back for the
next NOTIFY.
"""

from __future__ import annotations

import os
import threading
import time
import traceback
from typing import Any, Callable, Dict, List, Optional

from sqlmodel import Session, select

from ..core.config import database_dialect, DATABASE_URL
from ..database import engine
from ..models import ChatRun
from . import heartbeat


QUEUE_CHANNEL = "ai_run_queued"
POLL_INTERVAL_SECONDS = 2.0  # SQLite fallback only


def notify_queue(run_id: str) -> None:
    """Best-effort NOTIFY for Postgres; no-op on SQLite.

    Callers must have already INSERTed the queued ChatRun row + committed.
    The payload carries the ``run_id`` so the dispatcher could (in theory)
    skip the SKIP LOCKED query, but we keep that path for fairness with
    multiple workers.
    """
    if database_dialect() != "postgresql":
        return
    try:
        import psycopg  # local import keeps SQLite-only deployments lean
    except Exception:
        return
    try:
        # psycopg accepts ``postgresql://`` URLs directly.
        with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
            # Channel/payload identifiers are constants; payload is the
            # run_id which we sanitize defensively.
            safe_payload = str(run_id or "").replace("'", "")
            conn.execute(f"NOTIFY {QUEUE_CHANNEL}, '{safe_payload}'")
    except Exception as exc:
        print(f"[ai-runtime] NOTIFY failed for {run_id}: {exc}")


def _claim_one_queued_run() -> Optional[ChatRun]:
    """Atomically claim one queued run; mark it running with a heartbeat."""
    dialect = database_dialect()
    with Session(engine) as session:
        if dialect == "postgresql":
            from sqlalchemy import text

            row_proxy = session.exec(
                text(
                    "SELECT id FROM chatrun WHERE status = 'queued' "
                    "ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1"
                )
            ).first()
            if not row_proxy:
                return None
            row_id = row_proxy[0] if isinstance(row_proxy, tuple) else row_proxy
            run = session.get(ChatRun, int(row_id))
        else:
            run = session.exec(
                select(ChatRun).where(ChatRun.status == "queued").order_by(ChatRun.id)
            ).first()
        if not run:
            return None
        now = time.time()
        run.status = "running"
        run.started_at = run.started_at or now
        run.heartbeat_at = now
        run.updated_at = now
        session.add(run)
        session.commit()
        session.refresh(run)
        return run


def _load_worker_kwargs(run: ChatRun) -> Dict[str, Any]:
    """Re-derive the kwargs needed by ``_run_worker`` from a ChatRun row.

    A subset of fields that ``start_chat_run`` originally passed
    (``model_user_content`` / ``merged_system_prompt`` / ``current_user_message_id``)
    are not persisted on ChatRun; ``_run_worker`` recovers them from the
    most recent user message in the session.
    """
    from ..routers.chat_runtime_helpers import _resolve_ai_runtime
    from ..models import ChatMessage, User

    with Session(engine) as session:
        user = session.get(User, run.user_id)
        if not user:
            raise RuntimeError(f"user {run.user_id} not found for run {run.run_id}")
        _, _, _, _, system_prompt = _resolve_ai_runtime(
            session, user, run.ai_kind, run.ai_config_id
        )
        last_user_msg = session.exec(
            select(ChatMessage)
            .where(
                ChatMessage.user_id == run.user_id,
                ChatMessage.session_id == run.session_id,
                ChatMessage.ai_kind == run.ai_kind,
                ChatMessage.role == "user",
            )
            .order_by(ChatMessage.created_at.desc())
        ).first()
    return {
        "run_id": run.run_id,
        "user_id": run.user_id,
        "ai_config_id": run.ai_config_id,
        "ai_kind": run.ai_kind,
        "session_id": run.session_id,
        "session_name": run.session_name or "",
        "model_user_content": last_user_msg.content if last_user_msg else "",
        "merged_system_prompt": system_prompt,
        "current_user_message_id": last_user_msg.id if last_user_msg else None,
    }


def _start_heartbeat(run_id: str, stop_evt: threading.Event) -> threading.Thread:
    def loop() -> None:
        while not stop_evt.is_set():
            try:
                heartbeat.tick(run_id)
            except Exception:
                pass
            if stop_evt.wait(heartbeat.TICK_INTERVAL_SECONDS):
                return

    th = threading.Thread(target=loop, name=f"hb-{run_id}", daemon=True)
    th.start()
    return th


def _execute_run(run: ChatRun) -> None:
    from ..routers.chat_worker import _run_worker

    try:
        kwargs = _load_worker_kwargs(run)
    except Exception as exc:
        traceback.print_exc()
        # Mark as error so the UI moves on.
        with Session(engine) as session:
            row = session.get(ChatRun, run.id)
            if row:
                row.status = "error"
                row.error_message = f"worker setup failed: {exc}"
                row.finished_at = time.time()
                row.updated_at = time.time()
                session.add(row)
                session.commit()
        return

    stop_evt = threading.Event()
    hb = _start_heartbeat(run.run_id, stop_evt)
    try:
        _run_worker(**kwargs)
    except Exception as exc:
        traceback.print_exc()
        with Session(engine) as session:
            row = session.get(ChatRun, run.id)
            if row and row.status not in {"completed", "stopped", "error"}:
                row.status = "error"
                row.error_message = f"_run_worker crashed: {exc}"
                row.finished_at = time.time()
                row.updated_at = time.time()
                session.add(row)
                session.commit()
    finally:
        stop_evt.set()
        hb.join(timeout=1.0)


def _drain_dispatcher(limit: int = 32) -> int:
    """Claim and dispatch as many queued runs as we can find in one sweep."""
    dispatched = 0
    while dispatched < limit:
        run = _claim_one_queued_run()
        if not run:
            return dispatched
        th = threading.Thread(
            target=_execute_run,
            args=(run,),
            name=f"runworker-{run.run_id}",
            daemon=True,
        )
        th.start()
        dispatched += 1
    return dispatched


def _listen_postgres(stop_evt: threading.Event) -> None:
    import psycopg

    backoff = 1.0
    while not stop_evt.is_set():
        try:
            with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
                conn.execute(f"LISTEN {QUEUE_CHANNEL}")
                # Drain anything that landed before we started listening.
                _drain_dispatcher()
                backoff = 1.0
                gen = conn.notifies()
                for _notify in gen:
                    if stop_evt.is_set():
                        return
                    _drain_dispatcher()
        except Exception as exc:
            print(f"[ai-runtime] listen loop failed, retrying: {exc}")
            if stop_evt.wait(backoff):
                return
            backoff = min(backoff * 2, 30.0)


def _poll_sqlite(stop_evt: threading.Event) -> None:
    while not stop_evt.is_set():
        try:
            _drain_dispatcher()
        except Exception as exc:
            print(f"[ai-runtime] poll sweep failed: {exc}")
        if stop_evt.wait(POLL_INTERVAL_SECONDS):
            return


def run_dispatcher_forever(stop_evt: Optional[threading.Event] = None) -> None:
    """Block forever, dispatching queued runs as they appear.

    Designed to be called from ``main_ai_runtime.py``. Catches dialect once
    at start and chooses the LISTEN/NOTIFY or polling path accordingly.
    """
    evt = stop_evt or threading.Event()
    print(
        f"[ai-runtime] dispatcher starting (dialect={database_dialect()}, "
        f"db={DATABASE_URL.split('@')[-1]})"
    )
    # Boot-time recovery sweep — re-enqueue any 'running' rows whose worker
    # died across the restart. The watchdog will reap if heartbeats are
    # already stale, but on fresh boot we also retry orphans.
    try:
        reaped = heartbeat.reap_stale_runs()
        if reaped:
            print(f"[ai-runtime] boot watchdog reaped {len(reaped)} stale runs")
    except Exception as exc:
        print(f"[ai-runtime] boot reap failed: {exc}")
    if database_dialect() == "postgresql":
        _listen_postgres(evt)
    else:
        _poll_sqlite(evt)

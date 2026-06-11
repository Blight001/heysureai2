"""SQLModel engine + session dependency.

Schema is owned by Alembic (see ``api.db`` / ``migrations/`` /
``doc/db-migrations.md``). This module only builds the engine and exposes the
session dependency; bringing the schema up to date is delegated to
``api.db.ensure_schema`` via :func:`create_db_and_tables`.
"""

import contextlib
import logging
import os
import time

from sqlmodel import Session, create_engine

from .core.config import DATABASE_URL, SERVER_DIR, database_dialect

# Importing the models package side-effect populates ``SQLModel.metadata``.
from . import models  # noqa: F401

logger = logging.getLogger(__name__)
_BOOTSTRAP_LOCK_PATH = os.path.join(SERVER_DIR, "data", "bootstrap.lock")
_BOOTSTRAP_ADVISORY_LOCK_KEY = 518_329_771_405_339_013


@contextlib.contextmanager
def _bootstrap_lock():
    """Serialize schema/bootstrap work across concurrently starting services."""
    if database_dialect() == "postgresql":
        deadline = time.time() + 120.0
        with engine.connect() as conn:
            while True:
                locked = conn.exec_driver_sql(
                    f"SELECT pg_try_advisory_lock({_BOOTSTRAP_ADVISORY_LOCK_KEY})"
                ).scalar()
                if locked:
                    try:
                        yield
                    finally:
                        try:
                            conn.exec_driver_sql(
                                f"SELECT pg_advisory_unlock({_BOOTSTRAP_ADVISORY_LOCK_KEY})"
                            )
                        except Exception:
                            logger.exception("failed to release postgres bootstrap lock")
                    return
                if time.time() >= deadline:
                    raise RuntimeError(
                        "database is busy; another process is still bootstrapping the Postgres database"
                    )
                time.sleep(0.5)

    lock_path = os.path.abspath(_BOOTSTRAP_LOCK_PATH)
    lock_dir = os.path.dirname(lock_path)
    os.makedirs(lock_dir, exist_ok=True)
    deadline = time.time() + 120.0
    pid = os.getpid()
    while True:
        try:
            fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            try:
                age = time.time() - os.path.getmtime(lock_path)
            except Exception:
                age = 0.0
            if age > 600.0:
                try:
                    os.remove(lock_path)
                    continue
                except Exception:
                    pass
            if time.time() >= deadline:
                raise RuntimeError(
                    f"database file is busy or locked by another process: {lock_path}"
                )
            time.sleep(0.5)
            continue
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fp:
                fp.write(f"pid={pid}\nstarted_at={time.time()}\n")
            yield
        finally:
            try:
                os.remove(lock_path)
            except FileNotFoundError:
                pass
        break

if database_dialect() == "sqlite":
    # Keep startup from hanging indefinitely if another process is holding
    # the SQLite file. A short timeout is preferable to a silent stall.
    connect_args = {"check_same_thread": False, "timeout": 5.0}
    engine = create_engine(DATABASE_URL, connect_args=connect_args)
else:
    # Postgres: pool_pre_ping handles dropped connections after server
    # restarts; pool_recycle prevents stale long-lived connections.
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=300)


def create_db_and_tables() -> None:
    """Ensure the database schema is current. Called by each runtime at startup.

    Backwards-compatible entry point. By default it runs Alembic
    ``upgrade head`` (adopting pre-Alembic databases on first boot). Set
    ``HEYSURE_DB_AUTO_MIGRATE=0`` to decouple migration from startup — run
    ``python -m api.db migrate`` as a separate deploy step instead, and the
    app will only verify the schema is present.
    """
    from .core.settings import settings
    from . import db as _db

    if settings.db_auto_migrate:
        _db.ensure_schema()
        return

    has_version, has_core = _db._db_state(engine)
    if not (has_version or has_core):
        raise RuntimeError(
            "database schema is not initialized and HEYSURE_DB_AUTO_MIGRATE is off; "
            "run `python -m api.db migrate` before starting the app"
        )


def get_session():
    with Session(engine) as session:
        yield session

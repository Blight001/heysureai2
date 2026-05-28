"""SQLModel engine + session dependency.

Schema bootstrap is split in two phases:
- ``SQLModel.metadata.create_all`` creates tables that do not yet exist.
- ``run_pending_migrations`` adds missing columns on legacy SQLite
  installations (see ``api.core.migrations``). Postgres deployments either
  start from scratch (``create_all`` builds everything) or come from
  ``scripts/migrate_sqlite_to_postgres.py``, so they do not need the legacy
  ALTER TABLE patches.
"""

from sqlmodel import Session, SQLModel, create_engine

from .core.config import DATABASE_URL, database_dialect
from .core.migrations import run_pending_migrations

# Importing the models package side-effect populates ``SQLModel.metadata``.
from . import models  # noqa: F401

if database_dialect() == "sqlite":
    connect_args = {"check_same_thread": False}
    engine = create_engine(DATABASE_URL, connect_args=connect_args)
else:
    # Postgres: pool_pre_ping handles dropped connections after server
    # restarts; pool_recycle prevents stale long-lived connections.
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=300)


def create_db_and_tables() -> None:
    SQLModel.metadata.create_all(engine)
    run_pending_migrations()


def get_session():
    with Session(engine) as session:
        yield session

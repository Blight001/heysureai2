"""SQLModel engine + session dependency.

Schema bootstrap is split in two phases:
- ``SQLModel.metadata.create_all`` creates tables that do not yet exist.
- ``run_pending_migrations`` adds missing columns on legacy installations
  (see ``api.core.migrations``).
"""

from fastapi import Depends
from sqlmodel import Session, SQLModel, create_engine

from .core.config import SQLITE_URL
from .core.migrations import run_pending_migrations

# Importing the models package side-effect populates ``SQLModel.metadata``.
from . import models  # noqa: F401

connect_args = {"check_same_thread": False}
engine = create_engine(SQLITE_URL, connect_args=connect_args)


def create_db_and_tables() -> None:
    SQLModel.metadata.create_all(engine)
    run_pending_migrations()


def get_session():
    with Session(engine) as session:
        yield session

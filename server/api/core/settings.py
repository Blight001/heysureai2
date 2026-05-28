"""Single source of truth for environment-driven configuration.

Every ``HEYSURE_*`` / ``DATABASE_URL`` / runtime-toggle env var the server
reads lives here. Other modules import :data:`settings` instead of
calling ``os.environ`` directly so:

- adding / renaming a knob is one diff;
- IDE jump-to-definition works;
- ``.env.example`` can be generated from field metadata;
- typos surface at startup, not three hours into a debug session.

The module is *also* re-exported from :mod:`api.core.config` under the
historical constant names (``DATABASE_URL`` / ``INTERNAL_TOKEN`` / …)
so existing call sites keep working until they're individually migrated.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Literal, Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


SERVER_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(SERVER_DIR, "data")
SQLITE_FILE = os.path.join(DATA_DIR, "heysure.db")
SQLITE_URL = f"sqlite:///{SQLITE_FILE}"


class Settings(BaseSettings):
    """All env-driven knobs.

    Fields without an ``HEYSURE_`` prefix in the env (``DATABASE_URL``,
    ``AGENT_TOKEN``, ``MCP_RUNTIME_URL``, ``CONNECTOR_RUNTIME_URL``,
    ``AI_DISPATCH_MODE``, ``TAVILY_API_KEY``) keep their historical names
    via ``alias=`` so the .env files we already ship don't need editing.
    """

    model_config = SettingsConfigDict(
        env_prefix="HEYSURE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        populate_by_name=True,
    )

    # ---- Identity / role -----------------------------------------------------

    service_role: Literal["gateway", "worker", "mcp", "connector"] = Field(
        default="gateway",
        description="Which process is running. ``api.sio`` flips between a real "
        "Socket.IO server and a remote proxy based on this value.",
    )

    # ---- Database ------------------------------------------------------------

    database_url: str = Field(
        default=SQLITE_URL,
        alias="DATABASE_URL",
        description="SQLAlchemy URL; ``sqlite:///...`` or ``postgresql+psycopg://...``.",
    )

    # ---- Service mesh --------------------------------------------------------

    internal_token: str = Field(
        default="",
        description="Bearer secret guarding /internal/* endpoints between split "
        "processes. Empty = monolith (loopback-only).",
    )
    api_gateway_url: str = Field(
        default="",
        description="HTTP base of api-gateway (used by ai-runtime to relay Socket.IO emits).",
    )
    mcp_runtime_url: str = Field(
        default="",
        alias="MCP_RUNTIME_URL",
        description="HTTP base of mcp-runtime; empty = in-process registry.",
    )
    connector_runtime_url: str = Field(
        default="",
        alias="CONNECTOR_RUNTIME_URL",
        description="HTTP base of connector-runtime; empty = in-process bots.",
    )
    connector_runtime_port: int = Field(default=3002)
    mcp_runtime_port: int = Field(default=3001)

    # ---- Chat / AI runtime ---------------------------------------------------

    chat_max_steps: int = Field(
        default=48,
        description="Default ceiling on chat-worker tool-call iterations.",
    )
    ai_runtime_max_concurrent: int = Field(
        default=16,
        description="Concurrency cap per ai-runtime worker process.",
    )
    ai_dispatch_mode: Literal["local", "remote"] = Field(
        default="local",
        alias="AI_DISPATCH_MODE",
        description="``remote`` routes chat runs through the shared queue + ai-runtime.",
    )
    ai_debug: bool = Field(default=False, description="Verbose ai-runtime stdout.")
    ai_debug_color: bool = Field(default=True, description="ANSI color for ai-runtime logs.")

    # ---- Gateway -------------------------------------------------------------

    server_reload: bool = Field(
        default=False,
        description="Enable uvicorn --reload (only useful in dev).",
    )

    # ---- Auth / Socket.IO ----------------------------------------------------

    jwt_secret: str = Field(
        default="heysure-ai-secret-key-change-this-in-production",
        description="HS256 key. MUST be changed in production.",
    )
    agent_token: str = Field(
        default="",
        alias="AGENT_TOKEN",
        description="Static bearer agents present when registering on the Socket.IO ``/agent`` namespace.",
    )

    # ---- Third-party ---------------------------------------------------------

    tavily_api_key: str = Field(
        default="",
        alias="TAVILY_API_KEY",
        description="Tavily web-search API key (used by the web.search MCP tool).",
    )

    # ---- Logging -------------------------------------------------------------

    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = Field(
        default="INFO",
        description="Root log level for stdlib ``logging`` (see api/core/logging_config.py).",
    )
    log_json: bool = Field(
        default=False,
        description="Emit JSON-formatted logs (set true in containerized deploys).",
    )

    # -------------------------------------------------------------------------
    # Derived helpers
    # -------------------------------------------------------------------------

    @field_validator("database_url", mode="before")
    @classmethod
    def _strip_database_url(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or SQLITE_URL
        return value

    @field_validator(
        "internal_token",
        "api_gateway_url",
        "mcp_runtime_url",
        "connector_runtime_url",
        "agent_token",
        "tavily_api_key",
        mode="before",
    )
    @classmethod
    def _strip_str(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @property
    def database_dialect(self) -> str:
        url = self.database_url.lower()
        return "postgresql" if url.startswith("postgres") else "sqlite"

    @property
    def psycopg_dsn(self) -> str:
        """libpq-compatible Postgres URL (psycopg.connect does not understand
        SQLAlchemy's ``postgresql+psycopg://`` driver suffix)."""
        url = self.database_url
        if url.lower().startswith("postgresql+") or url.lower().startswith("postgres+"):
            return "postgresql://" + url.split("://", 1)[1]
        return url


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings singleton.

    Cached so we don't re-parse env on every import. Tests that need to
    override values should call ``get_settings.cache_clear()`` after
    mutating ``os.environ``.
    """
    return Settings()


# Single shared instance. Import this — don't construct ``Settings()`` ad-hoc.
settings = get_settings()

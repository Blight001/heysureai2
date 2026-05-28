"""Process-wide ``logging`` setup.

Call :func:`configure_logging` once per process at startup. Module code
then does the usual ``logger = logging.getLogger(__name__)`` and uses
``logger.info / warning / error / debug`` instead of ``print``.

Two formats:
- ``settings.log_json == False`` (default) — human-readable, optionally
  ANSI-colored when stdout is a TTY. Good for ``docker logs`` followed
  by a real human.
- ``settings.log_json == True`` — one JSON object per line. Drops
  cleanly into Loki / CloudWatch / Datadog without parsing tricks.

``settings.log_level`` picks the root threshold (DEBUG / INFO / WARNING /
ERROR). Third-party noise (uvicorn access log, httpx) is dialled down
one notch so our own INFO doesn't drown in framework chatter.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from typing import Any, Dict

from .settings import settings


_CONFIGURED = False


# ---- Formatters -------------------------------------------------------------


class _JsonFormatter(logging.Formatter):
    """One JSON object per record. Stable shape for log aggregators."""

    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        # Anything attached via logger.X("...", extra={"key": value})
        for key, value in record.__dict__.items():
            if key in (
                "args", "asctime", "created", "exc_info", "exc_text", "filename",
                "funcName", "levelname", "levelno", "lineno", "module",
                "msecs", "message", "msg", "name", "pathname", "process",
                "processName", "relativeCreated", "stack_info", "thread", "threadName",
                "taskName",
            ):
                continue
            try:
                json.dumps(value)
                payload[key] = value
            except Exception:
                payload[key] = repr(value)
        return json.dumps(payload, ensure_ascii=False)


_LEVEL_COLORS = {
    "DEBUG": "\033[37m",     # gray
    "INFO": "\033[36m",      # cyan
    "WARNING": "\033[33m",   # yellow
    "ERROR": "\033[31m",     # red
    "CRITICAL": "\033[1;31m",  # bold red
}
_RESET = "\033[0m"


class _ConsoleFormatter(logging.Formatter):
    """Human-readable formatter with optional ANSI level color."""

    def __init__(self, use_color: bool) -> None:
        super().__init__(
            fmt="%(asctime)s %(levelname)-7s %(name)s — %(message)s",
            datefmt="%H:%M:%S",
        )
        self._use_color = use_color

    def format(self, record: logging.LogRecord) -> str:
        text = super().format(record)
        if not self._use_color:
            return text
        color = _LEVEL_COLORS.get(record.levelname, "")
        return f"{color}{text}{_RESET}" if color else text


def _stdout_is_tty() -> bool:
    try:
        return bool(sys.stdout.isatty()) and not os.environ.get("NO_COLOR")
    except Exception:
        return False


# ---- Public API -------------------------------------------------------------


def configure_logging() -> None:
    """Idempotently install the root logging configuration.

    Safe to call multiple times — second and later calls are no-ops so each
    process entrypoint can call this without coordinating who "owns" setup.
    """
    global _CONFIGURED
    if _CONFIGURED:
        return
    _CONFIGURED = True

    handler = logging.StreamHandler(stream=sys.stdout)
    if settings.log_json:
        handler.setFormatter(_JsonFormatter())
    else:
        handler.setFormatter(_ConsoleFormatter(use_color=_stdout_is_tty()))

    root = logging.getLogger()
    root.setLevel(settings.log_level)
    # Replace any prior handlers so re-runs in tests don't double-print.
    root.handlers[:] = [handler]

    # Dial third-party loggers down one notch so the operator's INFO logs
    # don't drown in framework chatter.
    for noisy in ("uvicorn.access", "httpx", "httpcore", "watchfiles"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

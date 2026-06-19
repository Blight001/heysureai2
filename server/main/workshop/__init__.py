"""Compatibility package for importing the shared workshop module.

The runtime processes start with ``server/main`` on ``PYTHONPATH``.  The real
workshop package lives one directory up at ``server/workshop``.  By pointing
``__path__`` at that directory, ``from workshop import engine`` works in every
process without changing the existing call sites.
"""

from __future__ import annotations

from pathlib import Path


_REAL_WORKSHOP_DIR = Path(__file__).resolve().parents[2] / "workshop"

# Make this package resolve submodules from the shared workshop implementation.
__path__ = [str(_REAL_WORKSHOP_DIR)]


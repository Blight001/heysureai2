"""Feishu (Lark) integration.

Layout:
- service          — REST helpers (send message, parse webhook events).
- long_connection  — background long-polling client lifecycle.

External callers import from these sub-modules directly; the package
itself intentionally re-exports nothing to keep the import graph easy
to read.
"""

"""Run one fixed deployment script through a token-protected HTTP webhook."""

from __future__ import annotations

import argparse
import hmac
import json
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--script", required=True, help="Absolute path to the fixed update script")
    parser.add_argument("--token", required=True, help="Bearer token required from callers")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    script = Path(args.script).expanduser().resolve(strict=True)
    if not script.is_file():
        parser.error("--script must point to a file")

    run_lock = threading.Lock()

    def run_script() -> None:
        try:
            subprocess.run([str(script)], cwd=str(script.parent), check=False)
        finally:
            run_lock.release()

    class Handler(BaseHTTPRequestHandler):
        def _json(self, status: int, payload: dict) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
            if self.path != "/update":
                self._json(404, {"ok": False, "error": "not found"})
                return
            expected = f"Bearer {args.token}"
            if not hmac.compare_digest(self.headers.get("Authorization", ""), expected):
                self._json(401, {"ok": False, "error": "unauthorized"})
                return
            if not run_lock.acquire(blocking=False):
                self._json(409, {"ok": False, "error": "update already running"})
                return
            threading.Thread(target=run_script, name="deploy-update", daemon=True).start()
            self._json(202, {"ok": True, "accepted_at": time.time()})

        def log_message(self, fmt: str, *values: object) -> None:
            print(f"deploy-webhook: {self.address_string()} {fmt % values}", flush=True)

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"deploy-webhook listening on http://{args.host}:{args.port}/update", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

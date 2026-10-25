# Infinite Canvas transfer migration

The canonical protocol is documented in `doc/member-transfer-protocol.md`.

Use `workspace.transfer` for every server-to-device or device-to-server byte
transfer. The lifecycle is `prepare_download` / `prepare_upload`, streaming
through the returned capability URL, and `commit` for uploads. Do not use
absolute paths, public media URLs, or base64 in MCP arguments.

The device-side implementation is delivered as:

- `_release/infinite-canvas-remote-import-v2.patch` — capability URL fetching,
  SSRF protection, media validation, and bounded downloads.
- `_release/infinite-canvas-member-transfer.patch` — updates the device MCP
  description to the canonical `workspace.transfer` contract.

This file is retained as a navigation pointer only; it is not a second
protocol or compatibility contract.

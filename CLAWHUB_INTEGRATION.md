# ClawHub Integration Notes

This note captures the OpenClaw-to-ClawHub integration pattern in one place so
the same shape can be reused for other software later.

## What ClawHub Does Here

ClawHub is the registry and delivery surface for skills and plugins:

- publish package metadata and releases
- discover installable skills/plugins
- install or update tracked skills/plugins
- verify published skill/package trust data

In OpenClaw, ClawHub is not the runtime itself. OpenClaw keeps the runtime
logic local and calls ClawHub only for registry, download, verification, and
publish flows.

## Plugin Onboarding Flow

For a plugin that should be available through ClawHub:

1. Add `openclaw.install.clawhubSpec` in the plugin `package.json`.
2. For external packages, also provide the `compat` and `build` fields.
3. Set `publishToClawHub: true` when the package should be published there.
4. Publish with `clawhub package publish <package>` rather than a legacy
   skill-only publish alias.

The important rule is separation of concerns:

- `openclaw.plugin.json` decides what the plugin is.
- `package.json` decides how it is installed and published.

## Skill Install Flow

Skills use the OpenClaw CLI:

- `openclaw skills install <skill-slug>` installs from ClawHub into the active
  workspace.
- `openclaw skills install <skill-slug> --global` installs into the shared
  managed skill root.
- `openclaw skills verify <skill-slug>` asks ClawHub for the verification
  envelope.

The installed skill is then snapshotted locally and used by the agent runtime
from the local skill directory, not from ClawHub at execution time.

## Gateway Wiring

Gateway RPC methods are the bridge between the UI/CLI and ClawHub:

- `skills.search` -> ClawHub search
- `skills.detail` -> ClawHub package/skill detail
- `skills.install` with `source: "clawhub"` -> ClawHub install
- `skills.update` with `source: "clawhub"` -> ClawHub update
- `skills.securityVerdicts` -> ClawHub security verdict lookup
- `skills.skillCard` -> local skill card content

The actual HTTP requests live in a dedicated client module, so the Gateway only
orchestrates flow and validation.

## Reusing This Pattern For Other Software

When you want the same capability in another product, keep the same boundary
shape:

1. A registry client module that talks to ClawHub over HTTP.
2. A product-facing RPC or service layer that validates params and delegates to
   the client.
3. Package metadata that points the product at a canonical ClawHub locator.
4. Local install/update state so runtime execution stays independent from the
   registry.

Do not let the runtime depend on live ClawHub calls for normal execution. Use
ClawHub for discovery, install, update, and verification only.

## Practical Checklist

- Add a canonical ClawHub spec to package metadata.
- Expose search/detail/install/update methods in the host service layer.
- Keep install state local after download.
- Verify published artifacts before install when the product supports it.
- Document the install command and the publish command together.

## Files To Read In This Repo

- `docs/tools/skills.md`
- `docs/plugins/sdk-setup.md`
- `src/infra/clawhub.ts`
- `src/gateway/server-methods/skills.ts`

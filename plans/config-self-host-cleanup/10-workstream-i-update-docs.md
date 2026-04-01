# Workstream I — Update docs so they stop lying

### Goal

Make docs reflect the real architecture after cleanup.

### TODO

- [ ] Update `docs/env-secrets-management.md` to show the unified shared secret names.
- [ ] Update `docs/self-host.md` to remove unsupported self-host Postgres / `DATABASE_URL` language unless actually implemented.
- [ ] Update `docs/self-host-runtime-foundation.md` to describe the runtime bundle manifest and the stricter contract story.
- [ ] Update any README text that still implies old env/config sync behavior.
- [ ] Document the actual self-host secrets file path from code:
  - default Unix path: `${XDG_CONFIG_HOME:-~/.config}/onequery/self-host/secrets.toml`
  - or `$ONEQUERY_HOME/config/self-host/secrets.toml`
- [ ] Document that `onequery serve` is self-host only and that repo-local self-host smoke uses a separate staging path.

### Acceptance

- [ ] Docs no longer mention unsupported self-host storage behavior.
- [ ] Docs no longer show stale field names.
- [ ] Docs describe exactly one runtime-discovery story for self-host.

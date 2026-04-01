# Workstream I — Update docs so they stop lying

### Goal

Make docs reflect the real architecture after cleanup.

This workstream mirrors the canonical decisions from the other workstreams. It should not introduce new architecture rules on its own.

### TODO

- [ ] Update `docs/env-secrets-management.md` to match the canonical secret schema defined by `01-target-architecture.md` and implemented by Workstream B.
- [ ] Update `docs/self-host.md` to match the canonical storage and execution-path behavior defined by Workstreams D and F.
- [ ] Update `docs/self-host-runtime-foundation.md` to match the canonical launch-contract and runtime-bundle story defined by Workstreams C and E.
- [ ] Update any README text that still implies old env/config sync behavior.
- [ ] Document the actual self-host secrets file path from code:
  - default Unix path: `${XDG_CONFIG_HOME:-~/.config}/onequery/self-host/secrets.toml`
  - or `$ONEQUERY_HOME/config/self-host/secrets.toml`
- [ ] Document that `onequery serve` is self-host only and that repo-local self-host smoke uses a separate staging path.

### Acceptance

- [ ] Docs no longer mention unsupported self-host storage behavior.
- [ ] Docs no longer show stale field names.
- [ ] Docs do not imply that workspace-dev and self-host share secret values or a single secrets file.
- [ ] Docs describe exactly one runtime-discovery story for self-host.

# Self-Host Runtime Foundation

This document describes the self-host runtime contract after the config rewrite.

## Ownership Model

The self-host startup boundary has one owner per concern:

- `packages/config/src/server-launch.ts`, exported as
  `@onequery/config/server-launch`, is the canonical launch-contract owner for
  packaged runtime shape and validation.
- Rust CLI owns self-host defaults, config parsing, secret parsing, path
  discovery, and validation.
- Rust CLI resolves a complete launch contract that matches the canonical
  config-package owner and writes it to `run/launch.json`.
- `packages/self-host-runtime` reads that launch contract exactly once at
  process
  start.
- runtime startup owns application-schema convergence after launch-config
  resolution.
- `packages/server` consumes the typed runtime object built from that launch
  contract.

The packaged runtime does not parse `self-host/config.toml`, does not parse
`self-host/secrets.toml`, and does not fall back to `onequery.dev.toml`.

The current parity bar is deliberate: Rust and the packaged runtime stay
aligned through the canonical config-package validator plus focused contract
tests. We are not introducing a separate neutral schema artifact unless that
parity workflow becomes painful enough to justify extra machinery.

## Filesystem Layout

The OneQuery home defaults to `~/.onequery`. Set `ONEQUERY_HOME` to use a
different root.

The runtime-managed files under that root are:

- `self-host/config.toml`
- `self-host/secrets.toml`
- `pglite/onequery/`
- `logs/server.log`
- `backups/`
- `run/launch.json`
- `run/runtime.lease.json`
- `run/runtime.status.json`
- `run/supervisor.status.json`
- `run/lifecycle.events.pb`

The self-host secrets file is therefore resolved at:

- `~/.onequery/self-host/secrets.toml` by default
- `$ONEQUERY_HOME/self-host/secrets.toml` when `ONEQUERY_HOME` is set

The bundled self-host runtime is discovered from one fixed executable-relative
layout:

```text
vendor/<target>/
  onequery/
    onequery[.exe]
  server/
    onequery-server.mjs
  runtime/
    migrations/
    web/
    pglite/
```

`onequery gateway` and `onequery gateway start` resolve `vendor/<target>` from
`current_exe()` and then read `runtime/web`, `runtime/migrations`, and
`server/` from that bundle root only. There is no repo-local asset fallback and
no alternate self-host launch path in the gateway command surface.

## Operator Note

These three files have different roles:

- `config.toml` is the human-edited operator config.
- `secrets.toml` stores generated or operator-managed secrets.
- `run/launch.json` is a private resolved artifact. Do not edit it manually;
  `onequery gateway` and `onequery gateway start` rewrite it from the
  Rust-owned config model each time the runtime starts.

## Lifecycle Rules

`onequery gateway` and `onequery gateway start` now perform this startup
sequence:

```text
self-host/config.toml + self-host/secrets.toml
                     |
                     v
        resolve_self_host_config() in Rust
                     |
                     v
              write run/launch.json
                     |
                     v
      start the packaged server bundle with launch-config path only
                     |
                     v
      packaged runtime reads launch.json once and starts the process runtime
```

Repo-local self-host smoke uses the same packaged layout: the helper stages a
temporary `vendor/<target>` bundle and then invokes unchanged `onequery gateway`
from that staged CLI binary. Workspace-dev remains separate and continues to
use `scripts/run-self-host-runtime.ts`.

The packaged runtime owns the process-local guarantees:

- acquire the runtime lease before accepting requests
- fail fast when the runtime lease belongs to a live matching process
- write `run/runtime.status.json` snapshots so `gateway start` waits for an
  explicit ready signal from the launched pid
- replace stale runtime lease and status snapshots only after process-liveness
  checks prove the previous runtime is gone
- append operator-facing lifecycle log lines to `logs/server.log`
- release runtime lease and status snapshots during graceful shutdown or
  startup failure
- apply the checked-in Drizzle migrations before the server begins handling
  requests

Workspace-dev follows the same migration-ownership rule through
`scripts/run-self-host-runtime.ts`: `bun run dev:setup` prepares infra only,
while the
runtime launched by `bun dev` converges the application schema from the launch
contract at startup.

## Proof Surface

The current repo checks that prove this boundary are:

- `cargo test -p onequery-cli self_host::tests`
- `cargo test -p onequery-cli gateway::tests`
- `bun test apps/cli/scripts/self-host-smoke.integration.test.ts`
- `bun run --cwd packages/self-host-runtime test -- src/index.test.ts src/launch-config.test.ts src/startup.test.ts src/self-host/lifecycle.test.ts`

Those checks cover:

- Rust-owned self-host config resolution and launch-contract generation
- packaged self-host bootstrap, startup failure on invalid secrets, and
  data-source creation through `onequery gateway`
- launch-config parsing and validation at packaged-runtime startup
- starting the packaged runtime from serialized launch config input
- lifecycle lease, stale lock replacement, log append, and shutdown cleanup

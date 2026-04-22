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

Roots on supported hosts:

- with `ONEQUERY_HOME` set:
  - config root: `$ONEQUERY_HOME/config`
  - data root: `$ONEQUERY_HOME/data`
- without `ONEQUERY_HOME`:
  - config root: `${XDG_CONFIG_HOME:-~/.config}/onequery`
  - data root: `${XDG_DATA_HOME:-~/.local/share}/onequery`

The runtime-managed files under those roots are:

- `self-host/config.toml`
- `self-host/secrets.toml`
- `pglite/onequery/`
- `logs/server.log`
- `backups/`
- `run/server.pid`
- `run/server.lock`
- `run/server.state.json`
- `run/launch.json`

The self-host secrets file is therefore resolved at:

- `${XDG_CONFIG_HOME:-~/.config}/onequery/self-host/secrets.toml` on default
  Unix roots
- `$ONEQUERY_HOME/config/self-host/secrets.toml` when `ONEQUERY_HOME` is set

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
- fail fast if `server.lock` belongs to a live process
- write `run/server.state.json` transitions so `gateway start` waits for an
  explicit ready signal from the launched pid
- replace stale pid and lock markers only when the recorded pid is gone
- append lifecycle events to `logs/server.log`
- release pid and lock markers during graceful shutdown or startup failure
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

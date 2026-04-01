# Self-Host Runtime Foundation

This document describes the self-host runtime contract after the config rewrite.

## Ownership Model

The self-host startup boundary has one owner per concern:

- `packages/config/src/server-launch.ts`, exported as
  `@onequery/config/server-launch`, is the canonical launch-contract owner for
  Bun runtime shape and validation.
- Rust CLI owns self-host defaults, config parsing, secret parsing, path
  discovery, and validation.
- Rust CLI resolves a complete launch contract that matches the canonical
  config-package owner and writes it to `run/launch.json`.
- `packages/bun-server` reads that launch contract exactly once at process
  start.
- `packages/server` consumes the typed runtime object built from that launch
  contract.

Bun does not parse `self-host/config.toml`, Bun does not parse
`self-host/secrets.toml`, and Bun does not fall back to `onequery.dev.toml`.

The current parity bar is deliberate: Rust and Bun stay aligned through the
canonical config-package validator plus the shared fixture tests. We are not
introducing a separate neutral schema artifact unless that parity workflow
becomes painful enough to justify extra machinery.

## Filesystem Layout

Platform-default roots on supported macOS/Linux hosts:

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
- `run/launch.json`

## Operator Note

These three files have different roles:

- `config.toml` is the human-edited operator config.
- `secrets.toml` stores generated or operator-managed secrets.
- `run/launch.json` is a private resolved artifact. Do not edit it manually;
  `onequery serve` rewrites it from the Rust-owned config model each time the
  runtime starts.

## Lifecycle Rules

`onequery serve` now performs this startup sequence:

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
      start packages/bun-server with launch-config path only
                     |
                     v
      Bun reads launch.json once and starts the process runtime
```

The Bun runtime owns the process-local guarantees:

- acquire the runtime lease before calling `Bun.serve`
- fail fast if `server.lock` belongs to a live process
- replace stale pid and lock markers only when the recorded pid is gone
- append lifecycle events to `logs/server.log`
- release pid and lock markers during graceful shutdown or startup failure

## Proof Surface

The current repo checks that prove this boundary are:

- `cargo test -p onequery-cli self_host::tests`
- `cargo test -p onequery-cli serve::tests`
- `bun run --cwd packages/bun-server test -- src/index.test.ts src/launch-config.test.ts src/startup.test.ts src/self-host/lifecycle.test.ts`

Those checks cover:

- Rust-owned self-host config resolution and launch-contract generation
- launch-config parsing and validation at Bun startup
- starting the Bun runtime from serialized launch config input
- lifecycle lease, stale lock replacement, log append, and shutdown cleanup

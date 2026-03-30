# Self-Host Runtime Foundation

This document records the self-host runtime filesystem and lifecycle contract
for the OSS self-host distribution.

## What Phase 2 Guarantees

- `onequery serve` bootstraps a valid self-host config area if one does not exist.
- Self-host config and mutable runtime data live in separate platform-standard
  roots.
- One data directory may have only one live Bun runtime lease at a time.
- The Bun runtime removes `server.pid` and `server.lock` on `SIGINT`,
  `SIGTERM`, and startup failure.

Historical note:

- Early OSS self-host work introduced the runtime layout and lifecycle lease.
- The current CLI now also provides `onequery serve status`, `onequery serve logs`,
  `onequery serve stop`, `onequery backup`, and `onequery restore`.
- For operator-facing guidance, use [`self-host.md`](./self-host.md).

## Filesystem Layout

The self-host roots resolve to platform-standard directories on supported
macOS/Linux hosts:

- Unix-like config root: `$XDG_CONFIG_HOME/onequery` or `~/.config/onequery`
- Unix-like data root: `$XDG_DATA_HOME/onequery` or `~/.local/share/onequery`

The runtime-managed files under those roots are:

- `self-host/config.toml`: self-host listen, public origin, logging, and SMTP settings
- `self-host/secrets.toml`: generated Better Auth, encryption, agent, and enrollment
  secrets
- `pglite/onequery/`: embedded PGlite data directory
- `logs/server.log`: Bun lifecycle log
- `backups/`: reserved backup target directory
- `run/server.pid`: operator-facing process marker
- `run/server.lock`: atomic lifecycle lease for duplicate-start prevention

## Lifecycle Rules

The Rust CLI owns bootstrap and path discovery. It passes the resolved
self-host config directory and data directory to the Bun runtime with:

- `ONEQUERY_SELF_HOST_CONFIG_DIR`
- `ONEQUERY_SELF_HOST_DATA_DIR`

The Bun runtime owns the process-local guarantees:

- acquire the runtime lease before calling `Bun.serve`
- fail fast if a live process already holds `server.lock` for the same data
  directory
- replace stale pid and lock markers only when the recorded pid is no longer
  running
- append lifecycle events to `logs/server.log`
- release pid and lock markers during graceful shutdown

## Proof Surface

The runtime contract is currently proven by the repo checks below:

- `cargo test -p onequery-cli`
  proves `onequery serve` bootstrap creates `self-host/config.toml`,
  `self-host/secrets.toml`, and the self-host runtime directories from the
  CLI-owned path contract.
- `bun run --cwd packages/bun-server test`
  proves the Bun runtime blocks duplicate starts for the same data directory,
  replaces stale locks safely, appends lifecycle logs, and cleans up pid/lock
  markers on shutdown.

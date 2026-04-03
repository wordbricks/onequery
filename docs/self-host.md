# Self-Hosting OneQuery OSS

This guide covers the current OSS product shape: install the published CLI,
start the bundled Bun runtime, bootstrap the first user, and operate the server
with the same CLI.

## Install And First Run

Prerequisites:

- `curl` and `tar`
- a supported published CLI package for macOS, Linux, or Windows

Install the CLI:

```bash
curl -fsSL https://onequery.wordbricks.ai/ | sh
```

Or install it directly with Bun:

```bash
bun install -g @onequery/cli
```

Other package-manager entrypoints still work:

```bash
bunx @onequery/cli --help
npx @onequery/cli --help
```

Published `onequery serve` packages include the bundled self-host runtime and
do not require Bun on `PATH`. `onequery serve` is the self-host launch
entrypoint; repo-local workspace development keeps using `bun dev` instead.

Start the server:

```bash
onequery serve
```

Then open `http://127.0.0.1:5656` and complete the first-user bootstrap.

Point the CLI at that server:

```bash
onequery config set server http://127.0.0.1:5656
onequery auth login
```

## Auth Model

- The first browser user bootstraps the instance.
- After bootstrap, sign-up is invite-only.
- `onequery auth login` uses the same self-hosted device-authorization flow as the
  browser-facing server.

## Config Files

Platform-default roots on supported hosts:

- Unix config root: `${XDG_CONFIG_HOME:-~/.config}/onequery`
- Unix data root: `${XDG_DATA_HOME:-~/.local/share}/onequery`

Files under those roots:

- `self-host/config.toml`
- `self-host/secrets.toml`
- `pglite/onequery/`
- `logs/server.log`
- `backups/`
- `run/server.pid`
- `run/server.lock`
- `run/launch.json`

The CLI creates these paths on first `onequery serve`. `run/launch.json` is a
resolved runtime artifact written by the CLI; it is not a user-edited config
file.

## Reverse Proxy And Public Origin

When the server is reachable through a reverse proxy, set `public_origin` in
`self-host/config.toml` to the external URL:

```toml
[server]
listen_host = "127.0.0.1"
port = 5656
public_origin = "https://onequery.example.com"
```

Operational requirements:

- terminate TLS at the proxy or upstream of it
- forward requests for both the SPA and `/api/*` to the same OneQuery origin
- preserve the public host and protocol headers so downstream auth flows stay
  consistent

Without `public_origin`, OneQuery falls back to the listen address.

## Storage Modes

Default mode is PGlite:

- database path: `pglite/onequery/` under the OneQuery data root
- no external database dependency

Optional Postgres mode:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/onequery onequery serve
```

Runtime behavior:

- PGlite runs the checked-in Drizzle migrations on startup.
- Postgres runs the checked-in Drizzle migrations on startup and fails closed if
  migration application fails.

## SMTP And Manual-Link Fallback

SMTP is optional. If it is not configured, invitation and auth flows fall back
to manual-link delivery.

Configure SMTP in `self-host/config.toml`:

```toml
[smtp]
host = "smtp.example.com"
port = 587
from_email = "hello@example.com"
from_name = "OneQuery OSS"
username = "smtp-user"
secure = false
```

Store the password in `self-host/secrets.toml`:

```toml
[smtp]
password = "replace-me"
```

## Operations

Serve lifecycle:

```bash
onequery serve
onequery serve status
onequery serve logs
onequery serve stop
```

Backups:

```bash
onequery backup --archive-path ./onequery-backup.tar.gz
onequery backup --include-secrets --archive-path ./onequery-backup-with-secrets.tar.gz
```

Restore:

```bash
onequery restore ./onequery-backup.tar.gz
```

Rules:

- stop the runtime before backup or restore
- use `--include-secrets` only when you intend to move the full instance
- keep backup archives outside the live data directory when possible

Upgrade flow:

```bash
onequery serve stop
onequery backup --include-secrets --archive-path ./pre-upgrade.tar.gz
curl -fsSL https://onequery.wordbricks.ai/ | sh
onequery serve
```

The hosted installer refreshes the stable release assets in place. `npx`/`bunx`
users can still rerun against the newer package version instead of keeping a
local install.

## Validation Coverage

Current repo validation for the self-host path includes:

- `bun run --cwd apps/cli test`
- `bun run --cwd packages/bun-server test`
- `bun run --cwd packages/db typecheck`

Important covered surfaces:

- self-host bootstrap and invite-only signup:
  [`packages/server/src/bootstrap.integration.test.ts`](../packages/server/src/bootstrap.integration.test.ts)
- CLI device auth workflow:
  [`apps/cli/crates/onequery-cli/src/commands/auth/tests.rs`](../apps/cli/crates/onequery-cli/src/commands/auth/tests.rs)
- Bun runtime lifecycle:
  [`packages/bun-server/src/self-host/lifecycle.test.ts`](../packages/bun-server/src/self-host/lifecycle.test.ts)

The Phase 7 smoke path also verifies:

- `onequery serve` starts a fresh temp runtime
- `onequery serve status` reports a running server
- `onequery serve stop` clears runtime markers
- `onequery backup --include-secrets --archive-path ...` creates a restorable archive
- `onequery restore ...` restores config and data into place

# Self-Hosting OneQuery OSS

This guide covers the current OSS product shape: install the published CLI,
start the bundled self-host runtime, bootstrap the first user, and operate the server
with the same CLI.

## Install And First Run

Prerequisites:

- `curl` and `tar`
- a supported published CLI package for macOS, Linux, or Windows

The hosted install script is for macOS and Linux. It downloads a pinned
official Node.js 24 runtime under the OneQuery install directory when `node`
24+ is not already available. Direct `bun install -g`, `npm install -g`,
`bunx`, and `npx` flows still require Node.js 22+ on `PATH` or
`ONEQUERY_SERVER_JS_RUNTIME` for the packaged `onequery gateway` commands.

Install the CLI:

```bash
curl -fsSL https://onequery.dev/install.sh | sh
```

Or install it with Homebrew:

```bash
brew install wordbricks/tap/onequery
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

Published `onequery gateway` packages include the bundled self-host runtime and
launch it with Node.js. Bun is not required on `PATH`. `onequery gateway` runs
the server in foreground, `onequery gateway start` runs the same server in
background, and repo-local workspace development keeps using `bun dev` instead.

After a published install, `onequery upgrade` upgrades the CLI in place when it
can map the current binary back to the original installer family.

Start the server in background:

```bash
onequery gateway start
```

Or keep it attached to your terminal in foreground:

```bash
onequery gateway
```

Then open `http://127.0.0.1:5656` and complete the first-user bootstrap.

Then log in from the CLI. Local self-host defaults to that server URL already:

```bash
onequery auth login
```

## Auth Model

- The first browser user bootstraps the instance.
- After bootstrap, sign-up is invite-only.
- `onequery auth login` uses the same self-hosted device-authorization flow as the
  browser-facing server.

## Supported Source Providers

Use `onequery source connect --help` to see the accepted `--source` values in the CLI.

Current provider identifiers:

- `postgres` for PostgreSQL
- `supabase` for Supabase Postgres
- `mysql` for MySQL
- `mongodb` for MongoDB
- `bigquery` for BigQuery
- `laminar` for Laminar
- `aws_athena_connector` for an AWS Athena connector already registered in OneQuery
- `ga` for Google Analytics
- `amplitude` for Amplitude
- `mixpanel` for Mixpanel
- `posthog` for PostHog
- `sentry` for Sentry
- `github` for GitHub
- `linear` for Linear

For provider-specific setup steps and example JSON, run `onequery source connect --source <provider>` without `--input`.

## Config Files

Roots on supported hosts:

- with `ONEQUERY_HOME` set:
  - config root: `$ONEQUERY_HOME/config`
  - data root: `$ONEQUERY_HOME/data`
- without `ONEQUERY_HOME`:
  - Unix config root: `${XDG_CONFIG_HOME:-~/.config}/onequery`
  - Unix data root: `${XDG_DATA_HOME:-~/.local/share}/onequery`

- default self-host secrets path on Unix:
  `${XDG_CONFIG_HOME:-~/.config}/onequery/self-host/secrets.toml`
- self-host secrets path with override:
  `$ONEQUERY_HOME/config/self-host/secrets.toml`

Files under those roots:

- `self-host/config.toml`
- `self-host/secrets.toml`
- `pglite/onequery/`
- `logs/server.log`
- `backups/`
- `run/server.pid`
- `run/server.lock`
- `run/server.state.json`
- `run/launch.json`

The CLI creates these paths on first `onequery gateway` or
`onequery gateway start`. `run/launch.json` is a resolved runtime artifact
written by the CLI; it is not a user-edited config file.

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

## Storage

Self-host currently supports PGlite only:

- database path: `pglite/onequery/` under the OneQuery data root
- no external database dependency
- `onequery gateway` and `onequery gateway start` ignore ambient `DATABASE_URL`

Runtime behavior:

- `onequery gateway` and `onequery gateway start` apply the checked-in Drizzle
  migrations on startup.
- startup fails closed if migration application fails.
- if explicit external Postgres support is added later, it should be modeled in
  self-host config rather than ambient env.

## Migration Ownership

Application schema convergence happens at runtime startup, not in bootstrap
scripts:

- `bun run dev:setup` creates workspace-dev secrets, starts local Postgres, and
  provisions shared local databases/extensions only
- `bun dev` starts workspace-dev and the packaged runtime applies the application
  schema on startup
- `onequery gateway` and `onequery gateway start` start self-host and the
  packaged runtime applies the application schema on startup

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

Gateway lifecycle:

```bash
onequery gateway
onequery gateway start
onequery gateway status
onequery gateway logs
onequery gateway stop
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
onequery gateway stop
onequery backup --include-secrets --archive-path ./pre-upgrade.tar.gz
curl -fsSL https://onequery.dev/install.sh | sh
onequery gateway start
```

The hosted installer refreshes the stable release assets in place. `npx`/`bunx`
users can still rerun against the newer package version instead of keeping a
local install.

## Validation Coverage

Current repo validation for the self-host path includes:

- `bun run --cwd apps/cli test`
- `bun run --cwd packages/installer test`
- `bun run --cwd packages/self-host-runtime test`
- `bun run --cwd packages/db typecheck`

Important covered surfaces:

- self-host bootstrap and invite-only signup:
  [`packages/server/src/bootstrap.integration.test.ts`](../packages/server/src/bootstrap.integration.test.ts)
- CLI device auth workflow:
  [`apps/cli/crates/onequery-cli/src/commands/auth/tests.rs`](../apps/cli/crates/onequery-cli/src/commands/auth/tests.rs)
- packaged self-host smoke:
  [`apps/cli/scripts/self-host-smoke.integration.test.ts`](../apps/cli/scripts/self-host-smoke.integration.test.ts)
- public installer contract:
  [`packages/installer/src/install-script.test.ts`](../packages/installer/src/install-script.test.ts)
- Self-host runtime lifecycle:
  [`packages/self-host-runtime/src/self-host/lifecycle.test.ts`](../packages/self-host-runtime/src/self-host/lifecycle.test.ts)
- backup archive coverage:
  [`apps/cli/crates/onequery-cli/src/commands/backup.rs`](../apps/cli/crates/onequery-cli/src/commands/backup.rs)
- restore archive coverage:
  [`apps/cli/crates/onequery-cli/src/commands/restore.rs`](../apps/cli/crates/onequery-cli/src/commands/restore.rs)
- gateway status/stop command coverage:
  [`apps/cli/crates/onequery-cli/src/commands/gateway/mod.rs`](../apps/cli/crates/onequery-cli/src/commands/gateway/mod.rs)

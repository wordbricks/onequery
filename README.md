# OneQuery

OneQuery is an open-source platform for unified data querying. Connect to your databases, analytics tools, and APIs from a single place — via a CLI or web UI — with centralized credential management, query safety controls, and team collaboration built in.

## What it does

- **Query multiple data sources** — PostgreSQL, Supabase, MySQL, MongoDB, BigQuery, AWS Athena, Google Analytics, Amplitude, Mixpanel, PostHog, Sentry, GitHub, Linear, and more
- **Manage credentials centrally** — encrypted credential storage with organization-level access control
- **Enforce query safety** — read-only validation, rate limiting, and single-statement enforcement
- **Track costs** — budget monitoring for expensive queries (BigQuery, Athena)
- **Run on your infrastructure** — a connector agent runs on your EC2 instance to query protected sources without exposing credentials

## How it works

OneQuery is a Bun/Turbo monorepo with three main layers:

```
┌─────────────────┐   ┌────────────────────┐
│   CLI (Rust)    │   │   Web UI (React)   │
└────────┬────────┘   └────────┬───────────┘
         │                     │
         ▼                     ▼
┌─────────────────────────────────────────┐
│          API Server (Hono)              │
│  auth · orgs · data-sources · queries  │
└──────────────────┬──────────────────────┘
                   │
         ┌─────────┴─────────┐
         ▼                   ▼
┌────────────────┐  ┌────────────────────┐
│ Postgres /     │  │  Connector Agent   │
│ PGlite (ORM)   │  │  (customer infra)  │
└────────────────┘  └────────────────────┘
```

**CLI** — a Rust binary (`onequery`) that authenticates via OAuth2 device flow and sends queries to the API. It uses a reducer/state-machine pattern for workflows like login, polling, and retries.

**Server** — a [Hono](https://hono.dev) HTTP API with Zod-validated routes, [Better Auth](https://better-auth.com) sessions, and [Drizzle ORM](https://orm.drizzle.team) for Postgres or PGlite. The `packages/bun-server` runtime serves both the API and the React SPA.

**Web UI** — a React 19 SPA with TanStack Router, TanStack Query, and XState for complex state. Provides data source management, team admin, budget dashboards, and audit logs.

**Connector** — a lightweight Bun agent deployed on customer infrastructure. It registers with OneQuery via an enrollment token, polls for query jobs, executes them locally (e.g. against AWS Athena via IAM), and returns results — so credentials never leave the customer's network.

## Monorepo structure

```
apps/
  cli/          # Rust CLI binary
  web/          # React SPA
  landing/      # Marketing site
  connector/    # Customer-side connector agent

packages/
  server/       # Shared Hono API routes and middleware
  bun-server/   # Runtime: serves API + SPA
  cli-server/   # CLI-specific endpoints (device auth, sessions)
  db/           # Drizzle schema and migrations
  contracts/    # Zod-validated API types
  ui/           # React component library
  config-loader/ # Config and environment management
```

## Getting started

**Prerequisites:** Bun `1.3.10`, Docker (for local Postgres), Rust (only if changing the CLI)

```bash
# Install dependencies and bootstrap local config
bun install --frozen-lockfile
bun run dev:setup

# Start the server and web UI
bun dev
```

Workspace dev now reads the tracked [`onequery.dev.toml`](./onequery.dev.toml)
file plus a local `onequery.dev.secrets.toml` file that `bun run dev:setup`
seeds automatically if it is missing. Edit `onequery.dev.toml` for browser/API
ports and local Postgres settings.

**Database commands:**

```bash
bun run db:migrate      # Run pending migrations
bun run db:seed:dev     # Seed development data
bun run db:studio       # Open Drizzle Studio
bun run db:reset        # Wipe and restart Docker volumes
```

**Validation:**

```bash
bun run typecheck
bun run lint
bun run test
```

## Installing the CLI

```bash
# Via npm/bun
bun add -g @onequery/cli

# Or with the install script (self-hosted)
curl -fsSL https://onequery.wordbricks.ai/ | sh
```

CLI config is stored at `~/.config/onequery/` on macOS/Linux or `%APPDATA%\onequery\` on Windows.

## License

Apache 2.0 — see [LICENSE](./LICENSE).

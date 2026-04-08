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
  cli/            # Rust CLI workspace (`onequery` binary and support crates)
  connector/      # Customer-side connector agent
  landing/        # Marketing site
  web/            # React SPA

packages/
  base/            # Dependency-free shared types and org permission helpers
  bun-server/      # Bun runtime that serves API + SPA
  cli-server/      # CLI-facing endpoints and generated transport bindings
  codecs/          # Shared encoding and decoding utilities
  config/          # Workspace-dev resolver and config projections
  config-loader/   # TOML decoding helper
  contracts/       # Shared Zod-validated API types
  datetime/        # Shared date/time formatting utilities
  db/              # Drizzle schema, migrations, and DB helpers
  github-rulesets/ # GitHub ruleset planning and apply tooling
  server/          # Shared Hono API routes, services, and middleware
  ui/              # React component library

proto/
  onequery/cli/v1/ # Buf protobuf/Connect contract for the CLI transport

docs/            # Design notes, self-host docs, and migration specs
scripts/         # Repo automation and local development helpers
```

## Getting started

**Prerequisites:** Bun `1.3.10`, Docker (for local Postgres), Rust (only if changing the CLI)

```bash
# Install dependencies and bootstrap local config
bun install
bun run dev:setup

# Start the workspace-dev stack
bun dev
```

Workspace dev now reads the tracked [`onequery.dev.toml`](./onequery.dev.toml)
file plus a local `onequery.dev.secrets.toml` file that `bun run dev:setup`
seeds automatically if it is missing. Edit `onequery.dev.toml` for browser/API
ports and local Postgres settings.

Default local ports:

- browser (Vite): `http://localhost:4545`
- Bun API listener: `http://127.0.0.1:4555`
- self-host bundled runtime: `http://127.0.0.1:5656`

Use `bun dev` for workspace development only. Use `onequery serve` for the
bundled self-host runtime.

**Database commands:**

```bash
bun run db:migrate      # Run pending migrations
bun run db:seed:dev     # Seed development data
bun run db:studio       # Open Drizzle Studio
bun run db:reset        # Wipe volumes, re-bootstrap, migrate, and seed dev DB
```

**Validation:**

```bash
bun run typecheck
bun run lint
bun run test
```

**Proto contract:**

```bash
bun run proto:lint
bun run proto:generate
bun run proto:check
```

## Installing the CLI

```bash
# Via Homebrew (tap)
brew install wordbricks/tap/onequery

# Via npm/bun
bun add -g @onequery/cli
npm install -g @onequery/cli

# Or with the install script (self-hosted)
curl -fsSL https://onequery.wordbricks.ai/ | sh
```

CLI config is stored at `~/.config/onequery/` on macOS/Linux or `%APPDATA%\onequery\` on Windows.

The self-host runtime writes operator-managed files under the standard config
and data roots, including `self-host/config.toml`, `self-host/secrets.toml`,
and the resolved startup contract at `run/launch.json`.

## License

Apache 2.0 — see [LICENSE](./LICENSE).

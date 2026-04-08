# OneQuery

OneQuery is an open-source, self-hostable platform for unified data querying. Run the server on your own infrastructure, connect your databases, analytics tools, and APIs from a single place, and use the CLI or web UI with centralized credential management, query safety controls, and team collaboration built in.

## Install Options

Install the published CLI with whichever flow fits your environment:

```bash
# Install script (macOS/Linux, self-host friendly)
curl -fsSL https://onequery.wordbricks.ai/install.sh | sh

# Homebrew
brew install wordbricks/tap/onequery

# npm
npm install -g @onequery/cli

# Bun
bun add -g @onequery/cli
```

One-off execution also works without a global install:

```bash
npx @onequery/cli --help
bunx @onequery/cli --help
```

On macOS and Linux, the hosted install script downloads a managed official
Node.js 24.x runtime under the OneQuery install directory when `node` 24+ is
not already available. Direct `npm`/`bun` installs still require Node.js 22+
on `PATH` or `ONEQUERY_SERVER_JS_RUNTIME` for `onequery serve start`.

## Quick Start

The default OSS path is to self-host OneQuery locally or on your own infrastructure.

```bash
# Start OneQuery
onequery serve start
```

Then open `http://127.0.0.1:5656`, complete the first-user bootstrap, and log in from the CLI. Local self-host defaults to that server URL already:

```bash
onequery auth login
onequery org list
onequery org use <org-slug>
```

Once the instance is running, add a source and execute a test query:

```bash
onequery source connect --source postgres --input '{"name":"warehouse","credentials":{"host":"db.example.com","database":"app","username":"onequery","password":"secret"}}'
onequery source show warehouse
onequery query execute --source warehouse --sql "select 1"
```

For self-host operations, config, backup, restore, SMTP, and reverse proxy setup, see [docs/self-host.md](./docs/self-host.md).

Already have access to an existing OneQuery server instead?

```bash
onequery config set server https://onequery.example.com
onequery auth login
onequery org list
onequery org use <org-slug>

# Find a queryable source and run a test query
onequery source list
onequery source show <source-key>
onequery query execute --source <source-key> --sql "select 1"
```

## What it does

- **Self-host the full product** — run the API and web UI on your own infrastructure with `onequery serve start`
- **Query multiple data sources** — PostgreSQL, Supabase, MySQL, MongoDB, BigQuery, AWS Athena, Google Analytics, Amplitude, Mixpanel, PostHog, Sentry, GitHub, Linear, and more
- **Manage credentials centrally** — encrypted credential storage with organization-level access control
- **Enforce query safety** — read-only validation, rate limiting, and single-statement enforcement
- **Track costs** — budget monitoring for expensive queries (BigQuery, Athena)
- **Run on your infrastructure** — a connector agent runs on your EC2 instance to query protected sources without exposing credentials

## How it works

OneQuery is a Bun/Turbo monorepo designed to run as a self-hosted product, with three main layers:

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

**Server** — a [Hono](https://hono.dev) HTTP API with Zod-validated routes, [Better Auth](https://better-auth.com) sessions, and [Drizzle ORM](https://orm.drizzle.team) for Postgres or PGlite. Workspace-dev runs it through the Bun-backed `packages/self-host-runtime` package, while packaged self-host ships a Rolldown-built Node server bundle that serves both the API and the React SPA.

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
  self-host-runtime/ # Self-host runtime that serves API + SPA
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

Use `bun dev` for workspace development only. Use `onequery serve start` for the
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

CLI config is stored at `~/.config/onequery/` on macOS/Linux or `%APPDATA%\onequery\` on Windows.

The self-host runtime writes operator-managed files under the standard config
and data roots, including `self-host/config.toml`, `self-host/secrets.toml`,
and the resolved startup contract at `run/launch.json`.

## Claude Code plugin

The shared `onequery` Claude Code plugin now ships from the Wordbricks
marketplace repository instead of this monorepo:

```bash
/plugin marketplace add wordbricks/skills
/plugin install onequery@wordbricks
```

For local plugin work, use the plugin bundle from your `wordbricks/skills`
checkout at `plugins/onequery`.

## License

Apache 2.0 — see [LICENSE](./LICENSE).

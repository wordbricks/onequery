# OneQuery

OneQuery is an open-source, self-hostable platform for unified data querying.
Run the server on your own infrastructure, connect databases, analytics tools,
and APIs from one place, and use the CLI or web UI with centralized credential
management, query safety controls, and team collaboration built in.

If you want to run the full product locally or on your own infrastructure, use
`onequery gateway start`.

If you already have access to a OneQuery server, install the CLI, point it at
that server, and log in.

<p align="center"><code>npm install -g @onequery/cli</code><br />or <code>brew install wordbricks/tap/onequery</code></p>
<p align="center"><strong>OneQuery</strong> is an open-source, self-hostable platform for unified data querying.</p>
<p align="center">
  If you want to run the full product on your own infrastructure, start with <code>onequery gateway start</code>.
  <br />
  If you already have access to a OneQuery server, install the CLI, set the server URL, and sign in.
  <br />
  For self-host install, backup, restore, SMTP, and reverse proxy setup, see <a href="./docs/self-host.md">docs/self-host.md</a>.
</p>

## Quickstart

### Install the CLI

Install globally with your preferred package manager:

```bash
# Install script (macOS/Linux)
curl -fsSL https://onequery.dev/install.sh | sh

# Homebrew
brew install wordbricks/tap/onequery

# npm
npm install -g @onequery/cli

# Bun
bun add -g @onequery/cli
```

You can also run the CLI without a global install:

```bash
npx @onequery/cli --help
bunx @onequery/cli --help
```

After a published install, run `onequery upgrade` to update in place when the
CLI can detect the installer family.

On macOS and Linux, the hosted install script downloads a pinned official
Node.js 24 runtime under the OneQuery install directory when `node` 24+ is
not already available. Direct `npm` and `bun` installs still require Node.js
22+ on `PATH` or `ONEQUERY_SERVER_JS_RUNTIME` for `onequery gateway start`.

### Run a self-hosted instance

The default OSS path is to self-host OneQuery locally or on your own
infrastructure.

```bash
onequery gateway start
onequery auth login
```

Add a source and execute a test query:

```bash
onequery source connect --source postgres --input '{"name":"warehouse","credentials":{"host":"db.example.com","database":"app","username":"onequery","password":"secret"}}'
onequery source show warehouse
onequery query execute --source warehouse --sql "select 1"
```

For self-host operations, config, backup, restore, SMTP, and reverse proxy
setup, see [docs/self-host.md](./docs/self-host.md).

### Connect to an existing OneQuery server

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

## What OneQuery includes

- Self-host the full product with `onequery gateway start`
- Query multiple data sources from one interface
- Manage credentials centrally with organization-level access control
- Enforce query safety with read-only validation, rate limiting, and
  single-statement enforcement
- Track budgets for expensive query providers such as BigQuery and Athena
- Run a connector agent on customer infrastructure so protected credentials stay
  inside that network

## Supported source providers

Use `onequery source connect --help` to see the accepted `--source` values in
the CLI.

Current provider identifiers:

- `postgres` for PostgreSQL
- `supabase` for Supabase Postgres
- `mysql` for MySQL
- `mongodb` for MongoDB
- `bigquery` for BigQuery
- `laminar` for Laminar
- `aws_athena_connector` for an AWS Athena connector already registered in
  OneQuery
- `ga` for Google Analytics
- `amplitude` for Amplitude
- `mixpanel` for Mixpanel
- `posthog` for PostHog
- `sentry` for Sentry
- `github` for GitHub
- `linear` for Linear

For provider-specific setup steps and example JSON, run
`onequery source connect --source <provider>` without `--input`.

## Docs

- [docs/README.md](./docs/README.md): docs index
- [docs/self-host.md](./docs/self-host.md): self-host install, proxy, SMTP,
  storage, backup, restore, and upgrade guidance
- [CONTRIBUTING.md](./CONTRIBUTING.md): contributor workflow and current PR
  policy
- [apps/cli/README.md](./apps/cli/README.md): CLI workspace notes and runtime
  behavior

## How it works

OneQuery is a Bun and Turbo monorepo with four main runtime surfaces:

```text
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

- CLI: a Rust binary (`onequery`) that authenticates via OAuth2 device flow and
  sends queries to the API. CLI workflows are modeled as reducer-driven state
  machines.
- Server: a [Hono](https://hono.dev) HTTP API with Zod-validated routes,
  [Better Auth](https://better-auth.com) sessions, and
  [Drizzle ORM](https://orm.drizzle.team) for Postgres or PGlite.
- Web UI: a React 19 SPA with TanStack Router, TanStack Query, and XState for
  complex state.
- Connector: a lightweight Bun agent deployed on customer infrastructure. It
  registers with OneQuery, polls for query jobs, executes them locally, and
  returns results without moving credentials into the hosted control plane.
- Result handling: cross-package query, credential, tester, and runtime
  boundaries use [better-result](https://github.com/dmmulroy/better-result) so
  success, failure, timeout, and retry paths stay explicit at the state-machine
  boundary instead of relying on thrown exceptions.

For monorepo structure, local development setup, validation commands, and
contributor workflow, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Claude Code plugin

The shared `onequery` Claude Code plugin ships from the Wordbricks marketplace
repository instead of this monorepo:

```bash
/plugin marketplace add wordbricks/skills
/plugin install onequery@wordbricks
```

<!-- The onequery-cli skill currently ships from wordbricks/skills. The
onequery repository URL does not expose a matching onequery-cli skill. -->
For skills-compatible agents, install the `onequery-cli` skill from the
Wordbricks skills repository:

```bash
npx skills add https://github.com/wordbricks/skills --skill onequery-cli -y
```

For local plugin work, use the plugin bundle from your `wordbricks/skills`
checkout at `plugins/onequery`.

## License

Apache 2.0. See [LICENSE](./LICENSE).

# Architecture

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

## Runtime surfaces

- **CLI**: a Rust binary (`onequery`) that authenticates via OAuth2 device flow
  and sends queries to the API. CLI workflows are modeled as reducer-driven
  state machines.
- **Server**: a [Hono](https://hono.dev) HTTP API with Zod-validated routes,
  [Better Auth](https://better-auth.com) sessions, and
  [Drizzle ORM](https://orm.drizzle.team) for Postgres or PGlite.
- **Web UI**: a React 19 SPA with TanStack Router, TanStack Query, and XState
  for complex state.
- **Connector**: a lightweight Bun agent deployed on customer infrastructure.
  It registers with OneQuery, polls for query jobs, executes them locally, and
  returns results without moving credentials into the hosted control plane.

## Result handling

Cross-package query, credential, tester, and runtime boundaries use
[better-result](https://github.com/dmmulroy/better-result) so success, failure,
timeout, and retry paths stay explicit at the state-machine boundary instead of
relying on thrown exceptions.

## Monorepo setup

For monorepo structure, local development, validation commands, and contributor
workflow, see [CONTRIBUTING.md](../CONTRIBUTING.md).


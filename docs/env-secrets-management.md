# Environment and Secrets Management

This repository now uses a managed local config contract for OSS development.
Private secret-management tooling is intentionally out of scope for the OSS
repo.

`onequery.local.env.toml` is the only editable managed config file for the root
OSS web/server workspace. Local commands project those values into process env
when they spawn child tooling.

## Ownership Model

- `packages/dev-config/src/local-env.ts` is the source of truth for managed local
  config variables, default local values, and ownership annotations.
- `onequery.local.env.toml.template` is the generated committed TOML artifact.
- `onequery.local.env.toml` is a local machine file for managed local defaults.
- Deployment secrets live in the target deployment platform and are managed
  outside this repository.

## Local Development Flow

```text
   managed config contract
packages/dev-config/src/local-env.ts
                |
                v
 bun run serve / bun dev / bun run dev:setup / bun run env:sync
                |
                +--> refresh onequery.local.env.toml.template
                |
                +--> create onequery.local.env.toml if missing
                |
                +--> validate managed values
                |
                +--> project managed values into child process env when needed
                |
                +--> start local Postgres
                |
                +--> sync Drizzle schema
                |
                +--> build apps/web when using bun run serve
                |
                +--> start packages/bun-server for the one-port runtime
                |
                v
    edit onequery.local.env.toml for managed local defaults
                |
                v
             local runtime + local tooling
```

## Practical Rules

- `bun run serve`, `bun dev`, and `bun run dev:setup` will create
  `onequery.local.env.toml` if it is missing.
- When `onequery.local.env.toml` is first created, `BETTER_AUTH_SECRET` is seeded
  with a random local-only value instead of a shared checked-in placeholder.
- `onequery.local.env.toml` is the editable local source of truth.
- Child processes that still need env syntax should receive projected values
  from `onequery.local.env.toml` at launch time rather than via a generated file.
- Existing local TOML files are not replaced wholesale; newly managed keys are
  appended and existing values are preserved.
- `bun run env:sync` refreshes `onequery.local.env.toml.template`, appends any
  newly managed keys into `onequery.local.env.toml`, seeds a random
  `BETTER_AUTH_SECRET` only when that key is missing.
- The standard local OSS runtime path is `bun run serve`, which builds the
  frontend bundle and serves web + api from `packages/bun-server` on one port.
- `bun dev` keeps Vite on the managed `WEB_URL` origin and proxies `/api` to a
  separate local Bun listener, so it now supports HMR-friendly full-stack
  development without changing browser-facing origins.
- Optional secrets for OAuth providers, OpenAI, and telemetry can remain blank
  until you need the corresponding integration locally.

## Related Commands

```bash
# First-run local bootstrap plus one-port runtime
bun run serve

# Refresh managed local TOML artifacts
bun run env:sync

# Re-run local bootstrap without starting the full dev workspace
bun run dev:setup

# Start the Bun runtime against an existing frontend build
bun run --cwd packages/bun-server start:local

# Reset Postgres volume and re-bootstrap
bun run db:reset
```

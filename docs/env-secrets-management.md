# Environment and Secrets Management

This repository now uses a workspace-dev config pair for OSS development:

- `onequery.dev.toml`: tracked local browser/API/Postgres defaults
- `onequery.dev.secrets.toml`: untracked local secrets

Private secret-management tooling is intentionally out of scope for the OSS
repo.

## Ownership Model

- `packages/config/src/workspace-dev.ts` owns the workspace-dev authored schema,
  defaults, and resolver.
- `packages/config/src/workspace-dev-init.ts` seeds local secrets when missing.
- `onequery.dev.toml` is the repo-authored local dev config surface.
- `onequery.dev.secrets.toml` is a local machine file for secrets only.
- Deployment secrets live in the target deployment platform and are managed
  outside this repository.

## Local Development Flow

```text
onequery.dev.toml + onequery.dev.secrets.toml
                |
                v
    packages/config resolveWorkspaceDev()
                |
                +--> Vite dev-server projection
                |
                +--> Drizzle DATABASE_URL projection
                |
                +--> Docker Compose projection
                |
                +--> derived local test database profile
                |
                v
      bun run dev:setup / bun dev / bun run serve
```

## Practical Rules

- `bun run serve`, `bun dev`, and `bun run dev:setup` will create
  `onequery.dev.secrets.toml` if it is missing.
- `onequery.dev.toml` is the editable local source of truth for browser/API
  ports and local Postgres defaults.
- Child processes that still need env syntax should receive projected values
  from `@onequery/config` at launch time rather than via a generated file.
- The standard local OSS runtime path is `bun run serve`, which builds the
  frontend bundle and serves web + api from `packages/bun-server` on one port.
- `bun dev` keeps Vite on the workspace-dev browser origin and proxies `/api` to a
  separate local Bun listener, so it now supports HMR-friendly full-stack
  development without changing browser-facing origins.
- Optional secrets for OAuth providers, OpenAI, and telemetry can remain blank
  until you need the corresponding integration locally.

## Related Commands

```bash
# First-run local bootstrap plus one-port runtime
bun run serve

# Re-run local bootstrap without starting the full dev workspace
bun run dev:setup

# Start the Bun runtime against an existing frontend build
bun run --cwd packages/bun-server start:local

# Reset Postgres volume and re-bootstrap
bun run db:reset
```

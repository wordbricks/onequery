# Contributing

## Setup

Use the root workspace commands unless you are intentionally working inside a
single subproject.

```bash
bun install --frozen-lockfile
bun run dev:setup
bun dev
```

Prerequisites:

- Bun `1.3.10`
- Docker for local Postgres
- Rust when changing `apps/cli`

## Config SSoT

Keep the local config story explicit:

- `onequery.local.env.toml` is the editable source of truth for the OSS web/server
  workspace
- `apps/connector/config/local.toml` is the editable source of truth for the
  connector
- process env is for one-off overrides, CI, or deployment-managed secrets

If you change the managed root config contract, refresh the tracked artifacts:

```bash
bun run env:sync
```

## Validation

Run the repo-standard checks from the root before handing work off:

```bash
bun run typecheck
bun run lint --format json
bun run test
```

Useful narrower checks:

- `turbo run check` for full monorepo lint/format verification
- `cd apps/connector && bun run check` for connector-only validation
- `cd apps/cli && cargo test` when working directly on the Rust CLI

## Generated Files

Do not edit these manually:

- `apps/web/src/routeTree.gen.ts`
- `packages/ui/src/components/ui/*`
- `packages/db/src/migrations/*`

Regenerate with the repo-approved commands:

- TanStack Router generation for `apps/web/src/routeTree.gen.ts`
- the relevant upstream tool for shadcn/ui and Drizzle outputs

## Docs Map

- [`README.md`](./README.md): root quick start
- [`docs/README.md`](./docs/README.md): documentation index
- [`docs/env-secrets-management.md`](./docs/env-secrets-management.md): managed config flow and local config artifacts
- [`scripts/README.md`](./scripts/README.md): bootstrap and local development scripts

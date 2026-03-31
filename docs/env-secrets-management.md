# Environment and Secrets Management

OneQuery now has two distinct config owners:

- `workspace-dev` for `bun dev`
- `self-host` for `onequery serve`

The repo does not use a generated `onequery.local.env.toml` surface anymore,
and startup does not round-trip config through committed env-shaped files.

## Profile Ownership

### Workspace Dev

Workspace development is owned by `@onequery/config`:

- `onequery.dev.toml`: tracked browser/API/Postgres defaults
- `onequery.dev.secrets.toml`: untracked local secrets
- `packages/config/src/workspace-dev.ts`: resolver and defaults
- `packages/config/src/projections/*`: Vite, Docker, and Drizzle projections

`bun dev` uses this profile only.

Default local ports:

- browser origin: `http://localhost:4545`
- Bun API listener: `http://127.0.0.1:4555`
- local Postgres host port: `5454`

Flow:

```text
onequery.dev.toml + onequery.dev.secrets.toml
                |
                v
    packages/config resolveWorkspaceDev()
                |
                +--> Vite projection
                +--> Docker projection
                +--> Drizzle projection
                +--> derived test profile
                |
                v
          bun dev startup
```

### Self Host

Self-host is owned by the Rust CLI, not by the repo-local dev resolver:

- `self-host/config.toml`: authored operator config
- `self-host/secrets.toml`: generated/operator secrets
- `run/launch.json`: resolved startup contract written by the CLI
- `apps/cli/.../config/self_host.rs`: defaults, validation, and path rules

`onequery serve` uses this profile only.

Default self-host port:

- bundled public origin: `http://127.0.0.1:5656`

Flow:

```text
self-host/config.toml + self-host/secrets.toml
                     |
                     v
       Rust resolve_self_host_config()
                     |
                     v
              run/launch.json
                     |
                     v
      packages/bun-server startup reads it once
```

## Practical Rules

- `bun run dev:setup` creates `onequery.dev.secrets.toml` when it is missing.
- `bun dev` reads repo-local workspace config and keeps browser/API listeners
  split on purpose.
- `onequery serve` ignores `onequery.dev.toml` and starts from the resolved
  self-host launch contract.
- `publicOrigin` is the canonical public URL. Do not author separate
  `WEB_URL` and `BETTER_AUTH_URL` config values.
- `DATABASE_URL` is a projection for consumers that need it. It is not the
  authored source of truth for workspace dev.
- Optional secrets for integrations can stay unset until you need them locally.

## Commands

```bash
# Seed local workspace secrets and validate the workspace-dev config
bun run dev:setup

# Run the split browser/API workspace-dev flow
bun dev

# Start the bundled self-host runtime from the Rust-owned config roots
onequery serve
```

For direct CLI development without a global install:

```bash
cargo run --manifest-path apps/cli/Cargo.toml --bin onequery -- serve
```

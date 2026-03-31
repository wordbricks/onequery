# OneQuery config rewrite plan

This plan assumes a **flag-day rewrite** of the config architecture.

The goal is not to preserve the current `onequery.local.env.toml` / `@onequery/dev-config` model. The goal is to land a **simple, strict, single-source architecture** with:

- one resolver per profile
- one runtime contract for the server
- no duplicated defaults across TS and Rust
- no config round-trips through env-shaped strings
- no startup config parsing on every request
- no drift-check scripts or generated committed templates

## Target mental model

There are only **two real profiles**:

1. `workspace-dev`
   - used by `bun dev`
   - browser origin and API listener are intentionally different

2. `self-host`
   - used by `onequery serve`
   - one bundled public server origin

There is also a **test profile**, but it is **derived**, not human-authored.

### Non-negotiable rules

- `publicOrigin` is the only canonical public URL. Do not keep both `WEB_URL` and `BETTER_AUTH_URL` as authored config.
- `listen.host` / `listen.port` are structured numbers. Do not parse ports back out of URLs.
- `DATABASE_URL` is an edge projection, not an authored source for workspace dev.
- `packages/server` must consume a typed runtime object, not a bag of env vars.
- `packages/bun-server` must read startup config exactly once at process start.
- `onequery serve` self-host config ownership stays in Rust. Bun must not parse self-host TOML itself.
- `bun dev` workspace config ownership stays in TS.
- `docker-compose.yml` and Drizzle are consumers of config, not owners of config.
- No compatibility layer. Remove the old model instead of supporting both.

## Recommended defaults

Use these unless there is a strong reason not to:

- `bun dev` browser: `http://localhost:4545`
- `bun dev` api: `http://localhost:4555`
- `onequery serve`: `http://127.0.0.1:5656`
- local Postgres host/container: `5454:5432`

These values matter less than the **separation of roles**:

- browser port for Vite/HMR
- API port for Bun dev server
- bundled single-port self-host runtime

## Target architecture

```text
                     AUTHORED CONFIG (human-edited)

     workspace-dev (repo)                           self-host (user config dir)
  ┌──────────────────────────┐                    ┌──────────────────────────┐
  │ onequery.dev.toml        │                    │ config.toml             │
  │ onequery.dev.secrets.toml│                    │ secrets.toml            │
  └──────────────┬───────────┘                    └──────────────┬───────────┘
                 │                                                │
                 ▼                                                ▼
      TS resolver in packages/config                  Rust resolver in onequery-cli
         resolveWorkspaceDev()                         resolve_self_host_config()
                 │                                                │
                 ├───────────────┐                                │
                 │               │                                │
                 ▼               ▼                                ▼
      Vite / Docker / Drizzle   ServerLaunchConfig JSON   ServerLaunchConfig JSON
           projections                 (dev)                    (self-host)
                 │                       │                          │
                 └───────────────┬───────┴───────────────┬──────────┘
                                 │                       │
                                 ▼                       ▼
                    packages/bun-server startup reads one launch contract
                                 │
                                 ▼
                     packages/server uses typed runtime config
                                 │
                                 ▼
                        app/services/routes/middleware
```

## Target runtime contract

The server should start from one typed contract. Example shape:

```ts
type ServerLaunchConfig = {
  mode: "workspace-dev" | "self-host";
  listen: {
    host: string;
    port: number;
  };
  publicOrigin: string;
  storage:
    | {
        kind: "postgres";
        url: string;
      }
    | {
        kind: "pglite";
        dir: string;
      };
  auth: {
    secret: string;
  };
  crypto: {
    masterEncryptionKey: string;
  };
  connectors: {
    enrollmentToken: string;
  };
  rateLimit: {
    enabled: boolean;
    storage: "memory" | "persistent";
  };
  smtp?: {
    host: string;
    port: number;
    fromEmail: string;
    fromName?: string;
    username?: string;
    password?: string;
    secure?: boolean;
  };
  assets: {
    distDir: string;
  };
  runtimePaths?: {
    dataDir: string;
    logsDir: string;
    runDir: string;
    pidPath: string;
    lockPath: string;
    backupsDir: string;
  };
};
```

Notes:

- `runtimePaths` is only needed for `self-host`.
- Better Auth should consume `publicOrigin`, not its own separately-authored URL.
- `DATABASE_URL` can still exist as a projection for tools that require it, but not as authored config for workspace dev.

## File ownership after the rewrite

### TS owns

- `packages/config`:
  - workspace-dev resolver
  - derived test profile
  - Vite / Docker / Drizzle projections
  - TS copy of `ServerLaunchConfig`
- `packages/server`:
  - typed runtime consumers
  - auth / storage / routes using typed config
- `packages/bun-server`:
  - startup adapter
  - Bun-specific lifecycle, asset binding, and process concerns

### Rust owns

- `apps/cli/crates/onequery-cli/src/config/self_host.rs`
  - self-host authored config
  - self-host defaults
  - self-host path discovery
  - self-host config validation
  - resolved self-host `ServerLaunchConfig` writer

## Phase-by-phase checklist

## Phase 0 — freeze the old surface

- [ ] Stop adding any new keys to `onequery.local.env.toml`.
- [ ] Stop adding any new `process.env.WEB_URL`, `process.env.BETTER_AUTH_URL`, or `process.env.DATABASE_URL` reads outside startup/tool adapters.
- [ ] Declare the old surface deprecated in the branch: `@onequery/dev-config`, `env:sync`, `onequery.local.env.toml`, and `dev-topology-check` are being removed, not migrated.
- [ ] Pick the final default ports and keep them fixed for the rewrite.

Done when:

- nobody is still extending the old model while the rewrite is in progress.

## Phase 1 — create the new canonical TS package

Recommendation: repurpose the currently-unused `packages/config` package and delete `packages/dev-config` later.

- [x] Create a real `packages/config/package.json`.
- [x] Add `packages/config/src/server-launch.ts` with the TS runtime contract types.
- [x] Add `packages/config/src/workspace-dev.ts` with the domain-shaped workspace-dev authored schema and resolver.
- [x] Add `packages/config/src/test-profile.ts` for the derived test database profile.
- [x] Add `packages/config/src/projections/vite.ts`.
- [x] Add `packages/config/src/projections/drizzle.ts`.
- [x] Add `packages/config/src/projections/docker.ts`.
- [ ] Keep `@onequery/config-loader` only as a TOML decoding helper; do not re-introduce env-shaped config there.
- [x] Add unit tests for the new package before migrating consumers.

Recommended workspace-dev authored shape:

```toml
[browser]
host = "localhost"
port = 4545

[api]
host = "127.0.0.1"
port = 4555

[postgres]
host_port = 5454
container_port = 5432
database = "onequery"
user = "onequery"
password = "onequery"

[flags]
disable_rate_limit = true
```

Recommended local secrets shape:

```toml
[auth]
secret = "..."

[crypto]
master_encryption_key = "..."

[connectors]
enrollment_token = "..."
```

Done when:

- `packages/config` can fully resolve workspace-dev without importing `@onequery/dev-config`.

## Phase 2 — replace the repo-authored local config files

- [x] Add `onequery.dev.toml` at repo root.
- [x] Add `onequery.dev.secrets.toml` at repo root.
- [x] Add ignore rules for `onequery.dev.secrets.toml` and any generated runtime files.
- [x] Create one small initializer in TS that seeds `onequery.dev.secrets.toml` if missing.
- [x] Delete `onequery.local.env.toml.template`.
- [x] Stop treating `onequery.local.env.toml` as the repo’s editable config surface.
- [x] Remove the idea of “syncing” config into a generated committed template.

Do not do this:

- do not create a new domain-shaped file and also keep `onequery.local.env.toml` around “for compatibility”
- do not store `WEB_URL` or `BETTER_AUTH_URL` in the new files

Done when:

- the only repo-authored local dev config is `onequery.dev.toml` + `onequery.dev.secrets.toml`.

## Phase 3 — move workspace-dev consumers to the new resolver

- [x] Replace `apps/web/src/lib/vite-dev-server-config.ts` so it reads `resolveWorkspaceDev()` from `packages/config`.
- [x] Remove the compatibility-shim comment there; after migration it is not a shim.
- [x] Update `scripts/dev-setup.ts` to use the structured workspace-dev config.
- [x] Update `scripts/run-local-env-command.ts` to use projection helpers from `packages/config`.
- [x] Update any DB tooling wrappers to consume `drizzle` projection values from `packages/config`.
- [x] Update Docker local startup to consume config from one place.

Recommended Docker approach:

- keep `docker-compose.yml` as a template with variable placeholders, not hardcoded ports and credentials
- inject those variables from `packages/config/src/projections/docker.ts` when invoking `docker compose`

That means `docker-compose.yml` stops being another source of truth.

- [x] Delete `scripts/check-dev-topology.ts`.
- [x] Delete `scripts/lib/dev-topology-check.ts`.
- [x] Remove `dev:topology:check` from root scripts.

Done when:

- Vite, Docker, and Drizzle all read projections derived from `packages/config`, and there is no drift-check script left.

## Phase 4 — introduce a real server runtime object

This is the biggest code-quality step.

- [x] Add a typed runtime module in `packages/server`, for example `packages/server/src/runtime.ts`.
- [x] Change `packages/server` APIs to accept `ServerLaunchConfig` / `ServerRuntimeConfig` instead of env.
- [x] Replace `createAuthFromEnv()` with `createAuthFromConfig()`.
- [x] Replace `getServerStorage(env)` with startup-time service construction from typed config.
- [x] Create services once at app startup instead of keying caches by stringified env values.
- [x] Remove the global env-keyed caches in:
  - `packages/server/src/auth.ts`
  - `packages/server/src/storage.ts`
- [x] Replace `parseBooleanEnvFlag()` use in rate limiting with a startup boolean from runtime config.
- [x] Remove hardcoded fallback origin in `packages/server/src/lib/email-delivery.ts`; use `publicOrigin` from runtime config or request origin only.

Important design rule:

- startup config is process-wide immutable state, so construct auth/storage/rate-limit services once and pass them down
- do not re-parse config on every request

Done when:

- `packages/server/src/env.ts` is either deleted or reduced to a tiny boundary-only adapter that is not used by app code.

## Phase 5 — make Hono app creation typed and explicit

- [x] Change `packages/server/src/app.ts` to export a factory like `createServerApi(runtime)`.
- [x] Stop using `Bindings: ServerEnv` as the main way routes access config.
- [x] Prefer closure injection or `Variables` for process-owned runtime/services.
- [x] Update route modules and middleware that currently import `ServerEnv` / `AuthEnv` types.
- [x] Update `packages/server/src/routes/test-env.ts` and test helpers to build typed runtime fixtures instead of env bags.

Done when:

- route code no longer depends on env-shaped config types.

## Phase 6 — simplify the Bun runtime startup boundary

- [ ] Replace `packages/bun-server/src/runtime-env.ts` with a startup loader for one launch contract.
- [ ] Make `packages/bun-server/src/index.ts` read one input only:
  - either an in-memory object in tests
  - or a launch-config file path in real startup
- [ ] Add `packages/bun-server/src/launch-config.ts` (or similar) to load and validate `ServerLaunchConfig` once.
- [x] Change `packages/bun-server/src/app.ts` to accept constructed runtime/services instead of parsing `c.env`.
- [x] Remove the per-request `parseCoreServerEnv(c.env)` guard.
- [ ] Keep route constants in `packages/bun-server/src/constants.ts`, but move listen/public-origin defaults out of that file.
- [ ] If Bun still needs asset bindings or persistent storage handles, derive them from the loaded launch config once.

Done when:

- Bun startup depends on exactly one launch contract and request handling does not parse startup config.

## Phase 7 — move self-host ownership fully into Rust

This is the cleanest way to eliminate the Rust/TS self-host duplication.

- [ ] Keep self-host config parsing/defaults in `apps/cli/crates/onequery-cli/src/config/self_host.rs`.
- [ ] Add a Rust `ServerLaunchConfig` struct for the launch contract.
- [ ] Resolve `config.toml` + `secrets.toml` + runtime paths entirely in Rust.
- [ ] Write the resolved launch contract to a private file, for example `run/launch.json`.
- [ ] Pass only the launch-config path to the Bun server process.
- [ ] Delete self-host TOML parsing from TS.
- [ ] Delete `packages/bun-server/src/self-host/paths.ts`; runtime paths should be passed in the launch contract from Rust.
- [ ] Keep `packages/bun-server/src/self-host/lifecycle.ts` only as Bun-side runtime lease logic, consuming paths from the launch contract.

Also clean up Rust-local duplication:

- [ ] Remove the hardcoded `DEFAULT_BASE_URL` literal from `apps/cli/crates/onequery-cli/src/config.rs`.
- [ ] Derive CLI default base URL from the same Rust helper that defines self-host listen/public-origin defaults.
- [ ] Update CLI tests and snapshots for the new self-host default port.

Done when:

- self-host defaults, path rules, and config semantics exist in Rust only, and Bun receives only a resolved launch contract.

## Phase 8 — remove the old package and legacy scripts

- [ ] Delete `packages/dev-config/src/topology.ts`.
- [ ] Delete `packages/dev-config/src/runtime.ts`.
- [ ] Delete `packages/dev-config/src/local-env.ts`.
- [ ] Delete `packages/dev-config` tests.
- [x] Delete `scripts/sync-local-env.ts`.
- [x] Delete `env:sync` from `package.json`.
- [ ] Remove any code still importing `@onequery/dev-config/*`.
- [ ] Remove any code still reading `onequery.local.env.toml`.
- [ ] Remove any code still depending on `WEB_URL`, `BETTER_AUTH_URL`, or `LOCAL_TEST_DATABASE_URL` as first-class concepts.

Done when:

- `rg -n '@onequery/dev-config|onequery\.local\.env\.toml|env:sync|dev-topology' .` returns nothing useful outside migration notes.

## Phase 9 — clean up root commands

Desired command model:

- `bun dev` → workspace-dev only
- `onequery serve` → self-host only

There must not be a third independent config resolver.

- [ ] Decide whether root `bun run serve` remains.
- [ ] If it remains, make it a **thin delegate** to the self-host path only.
- [ ] If it cannot delegate 100%, delete it.
- [ ] Remove `scripts/run-bun-server.ts` if it still contains config logic after migration.
- [ ] If a dev helper is still needed, let it generate a launch contract and then start Bun; do not let it invent its own config semantics.

Done when:

- every entrypoint is only a resolver or a delegate, never both.

## Phase 10 — docs and proof surface

- [ ] Rewrite `docs/env-secrets-management.md` around the new model.
- [ ] Rewrite `docs/self-host-runtime-foundation.md` to describe launch-contract ownership.
- [ ] Update README local-dev instructions.
- [ ] Document the port split clearly:
  - `bun dev` browser port
  - `bun dev` API port
  - `onequery serve` bundled port
- [ ] Add a short operator note describing `config.toml`, `secrets.toml`, and the resolved launch file.

Done when:

- docs describe the new mental model and do not mention sync/template drift workflows.

## Required tests before calling this done

- [ ] Unit tests for `resolveWorkspaceDev()`.
- [ ] Unit tests for workspace-dev projections (`vite`, `docker`, `drizzle`).
- [ ] Unit tests for the derived test profile.
- [ ] Rust tests for self-host config resolution and launch-contract generation.
- [ ] Bun tests for reading a launch contract and starting from it.
- [ ] Integration test that `bun dev` uses separate browser/API ports.
- [ ] Integration test that `onequery serve` uses the bundled self-host port.
- [ ] Negative test proving self-host startup does **not** read `onequery.dev.toml`.
- [ ] Negative test proving Bun server startup fails cleanly if launch config is missing or malformed.
- [ ] Update CLI snapshots affected by the new default URL.

## Final search-based acceptance checklist

Run these before declaring victory:

- [ ] `rg -n 'WEB_URL|BETTER_AUTH_URL' packages apps scripts` only finds deliberate boundary adapters or deleted-history comments.
- [ ] `rg -n 'parseCoreServerEnv|parseAuthEnv|createLocalProcessEnv|loadLocalDevRuntimeSync' packages apps scripts` returns nothing.
- [ ] `rg -n 'DEFAULT_BUN_RUNTIME_PORT|default_port\(|DEFAULT_BASE_URL' apps/cli packages/bun-server` shows only one owner per concept.
- [ ] `rg -n 'onequery\.local\.env\.toml|onequery\.local\.env\.toml\.template' .` returns nothing useful.
- [ ] `rg -n 'process\.env\.' packages/server packages/bun-server` only finds startup-boundary reads, not app/runtime logic.

## Smells that mean the rewrite failed

If any of these remain, the architecture is still not SSoT:

- a port is authored in more than one place
- a URL is parsed just to recover a port/host already known structurally
- Bun self-host startup can silently fall back to workspace-dev config
- route middleware validates startup config on every request
- Docker, Drizzle, and Vite each keep their own real defaults
- `publicOrigin`, `WEB_URL`, and `BETTER_AUTH_URL` all survive as first-class config concepts
- self-host path resolution exists in both Rust and TS
- the repo still needs a drift-check script to compare “sources of truth”

## Recommended implementation order for green commits

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6
7. Phase 7
8. Phase 8
9. Phase 9
10. Phase 10

That order lets you land the new model first, migrate consumers second, and delete the old system last.

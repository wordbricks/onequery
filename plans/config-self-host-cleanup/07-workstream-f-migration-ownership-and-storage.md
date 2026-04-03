# Workstream F — Make migration ownership explicit and remove storage/doc drift

### Goal

Have one clean answer to “who migrates the application schema?” and “what self-host storage modes are supported?”

### Recommended decisions

1. **Runtime startup owns schema convergence** for actual app runtimes.
2. `dev:setup` owns infra/bootstrap only.
3. Self-host storage is explicit, not ambient.
4. Self-host Postgres should not be documented until it actually exists in the self-host config model.

### Better ownership model

Use an explicit owner matrix instead of one broad slogan:

- `workspace-dev` runtime startup owns application schema convergence for repo-local app runs
- `self-host` runtime startup owns application schema convergence for `onequery serve`
- `dev:setup` owns only infra/bootstrap prerequisites and never applies application schema
- test harnesses may call explicit schema-prep helpers directly when they are intentionally bypassing runtime startup

That keeps runtime behavior deterministic without making setup scripts or tests depend on accidental startup side effects.

### TODO

- [x] Remove app-schema migration execution from `scripts/dev-setup.ts`.
- [x] Keep infra setup there: secrets bootstrap, Docker/Postgres startup, `pgvector` enablement, etc.
- [x] Let workspace-dev Bun startup apply migrations using the launch contract.
- [x] Let self-host Bun startup remain the migration owner for `onequery serve`.
- [x] Keep test harnesses free to call DB prep helpers directly.
- [x] Document which entrypoints do and do not guarantee application schema convergence.
- [x] Rename `prepareSelfHostDatabase()` to something accurate like `prepareApplicationDatabase()` or `prepareRuntimeDatabaseSchema()` since it is not self-host-only.
- [x] Remove self-host `DATABASE_URL` documentation from `docs/self-host.md` for now.
- [x] Audit the repo for any lingering suggestion that self-host Postgres is supported via ambient env.
- [ ] If self-host Postgres is desired later, add it as explicit self-host config, for example a `[storage]` section, and project it into the launch contract.
- [x] Document the actual self-host secrets file path from code:
  - default Unix path: `${XDG_CONFIG_HOME:-~/.config}/onequery/self-host/secrets.toml`
  - or `$ONEQUERY_HOME/config/self-host/secrets.toml`

### Suggested self-host storage policy

Near-term clean state:

- self-host supports **PGlite only**
- docs say exactly that
- launch contract says exactly that
- Rust config projection says exactly that

Future expansion, if wanted:

```toml
[storage]
kind = "postgres"
url = "..."
```

or split config/secrets if the URL should be secret-managed.

But **do not** resurrect ambient `DATABASE_URL` for self-host.

### Acceptance

- [x] There is one clear migration owner for runtime startup.
- [x] The repo documents which paths migrate automatically and which do not.
- [x] `dev:setup` no longer applies the application schema.
- [x] Self-host docs match actual supported storage behavior.
- [x] The DB prep helper name no longer implies “self-host only” when it is used everywhere.

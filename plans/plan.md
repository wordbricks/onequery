# OneQuery config / self-host architecture cleanup plan

This plan is based on an investigation of the current `packages/config`, `apps/cli`, Bun runtime, docs, and adjacent tests.

Assumption for this job: **no backward compatibility is required**. That means the cleanup should prefer a clean, explicit architecture over compatibility shims, silent migrations, or preserving old field names.

---

## What was investigated

Primary files and surfaces reviewed:

- `onequery.dev.toml`
- `packages/config/src/workspace-dev.ts`
- `packages/config/src/workspace-dev-init.ts`
- `packages/config/src/projections/server-launch.ts`
- `packages/config/src/server-launch.ts`
- `packages/config/fixtures/self-host-launch.json`
- `apps/cli/crates/onequery-cli/src/config/self_host.rs`
- `apps/cli/crates/onequery-cli/src/commands/serve.rs`
- `apps/cli/scripts/build-npm-package.js`
- `packages/bun-server/src/index.ts`
- `packages/bun-server/src/assets.ts`
- `packages/db/src/migrations.ts`
- `scripts/dev-setup.ts`
- `packages/server/src/routes/data-sources/crud.ts`
- `packages/server/src/services/crypto/credential-encryption.ts`
- `packages/cli-server/src/source/effects.ts`
- `apps/web/src/queries/data-sources-queries.ts`
- `docs/env-secrets-management.md`
- `docs/self-host.md`
- `docs/self-host-runtime-foundation.md`

---

## Confirmed production bug: `onequery serve` can sign up / log in, but fails to create a data source

### Symptoms

- `onequery serve` starts and browser auth at `localhost:5656` works.
- Creating a data source from the web dashboard fails with generic UI error:
  - `Failed to create data source`
- Server log shows:

```text
[api] <-- POST /api/data-sources
[api] --> POST /api/data-sources 500 3ms
```

### Root cause

The released self-host bootstrap path generates `master_encryption_key` incorrectly.

Current workspace-dev generation (`packages/config/src/workspace-dev-init.ts`):

- `crypto.master_encryption_key` is generated as **base64-encoded 32-byte key material**.
- This matches runtime expectations.

Current self-host generation (`apps/cli/crates/onequery-cli/src/config/self_host.rs`):

- `SecretsConfig::generate()` uses `generate_secret("master-encryption")`
- `generate_secret()` returns a string like:

```text
master-encryption_<uuid>
```

Runtime expectation (`packages/server/src/services/crypto/credential-encryption.ts`):

- `deriveKeyFromBase64(masterKeyBase64)` decodes base64
- requires **exactly 32 bytes**
- otherwise throws `Invalid master encryption key`

Data-source create path (`packages/server/src/routes/data-sources/crud.ts`):

- `POST /api/data-sources` calls:
  - `deriveKeyFromBase64(c.var.runtime.crypto.masterEncryptionKey)`
  - `encryptCredentialsObject(...)`
- invalid self-host key throws
- request becomes a 500

This is why auth works but data-source creation fails:

- signup/login do **not** need credential encryption
- data-source create/update/test paths **do**

This same problem also exists in the CLI-side source connect path:

- `packages/cli-server/src/source/effects.ts`

### Why existing tests did not catch it

Because the current contract validates only shape, not semantics, and several tests/fixtures hardcode invalid keys as if they were valid:

- `packages/config/fixtures/self-host-launch.json` uses `"master"`
- `packages/server/src/runtime.test.ts` uses `"master-key"`
- `apps/cli/.../config/self_host.rs` tests repeatedly use `"master"`

So the test suite currently encodes the bug instead of defending against it.

---

## Main architecture problems found

### 1) Shared secret concepts are not actually shared

`onequery.dev.secrets.toml` and self-host `secrets.toml` are supposed to carry many of the same conceptual secrets, but they currently drift in both **naming** and **generation semantics**.

Current workspace-dev shape:

```toml
[auth]
secret = "..."

[crypto]
master_encryption_key = "..."

[connectors]
enrollment_token = "..."
```

Current self-host shape in Rust:

```toml
[auth]
better_auth_secret = "..."

[crypto]
master_encryption_key = "..."

[connectors]
enrollment_token = "..."

[smtp]
password = "..."
```

Problems:

- same concept, different key name: `auth.secret` vs `auth.better_auth_secret`
- same concept, different generation rules: workspace-dev master key is valid; self-host master key is invalid
- same concept, different validation rigor: both are effectively just “non-empty string” today

This is not SSoT. It is only superficially separated.

### 2) The runtime launch contract is “canonical” only by convention

`packages/config/src/server-launch.ts` is described as the canonical launch-contract owner, but the actual guarantee is weak:

- TS validates only high-level shape
- Rust keeps a parallel local launch struct
- parity is enforced mostly by fixture equality
- the shared fixture itself contains an invalid master key

That means the system can look aligned while still being semantically broken.

### 3) `onequery serve` still mixes two different runtime-discovery stories

In `apps/cli/crates/onequery-cli/src/commands/serve.rs`, `resolve_launch_plan()` has two unrelated branches:

1. packaged self-host runtime via `ONEQUERY_NPM_ROOT`
2. repo-local fallback via `env!("CARGO_MANIFEST_DIR")`

Those branches re-derive runtime paths differently.

That same knowledge is duplicated elsewhere too:

- `apps/cli/scripts/build-npm-package.js`
- `scripts/run-bun-server.ts`
- `packages/bun-server/src/assets.ts`

Specific duplication/smell:

- multiple places know where migrations live
- multiple places know where built web assets live
- multiple places know about `apps/web/dist/client` vs `apps/web/dist`
- `onequery serve` doubles as “actual self-host runtime” and “repo local smoke launcher”

That makes the separation between workspace-dev and self-host feel clean at the docs level, but still fuzzy at the executable level.

### 4) Migration ownership is still ambiguous

Current reality:

- `packages/bun-server/src/index.ts` applies migrations on runtime startup
- `scripts/dev-setup.ts` also applies migrations for workspace-dev
- self-host docs still mention optional Postgres via `DATABASE_URL`
- Rust self-host launch generation currently supports only `pglite`

So there is drift across:

- runtime behavior
- bootstrap behavior
- docs
- naming (`prepareSelfHostDatabase` is used by more than self-host)

### 5) Some config knobs are dead or misleading

Most obvious example:

- `server.log_level` exists in self-host config
- it is surfaced in serve status JSON
- but it does not appear to change actual runtime behavior

A config knob that does not influence behavior should not exist.

### 6) Too many tests are repeating the same contract with different wrappers

There are multiple nearly identical launch config builders / snapshots across:

- `packages/config/src/server-launch.test.ts`
- `packages/bun-server/src/launch-config.test.ts`
- `packages/bun-server/src/startup.test.ts`
- `packages/server/src/runtime.test.ts`
- `apps/cli/.../config/self_host.rs` tests
- `apps/cli/.../commands/serve.rs` tests

This duplicates shape coverage while still missing the most important semantic invariant.

---

## Recommended target architecture

The target architecture should follow these rules.

### Rule 1: same concept, same name, everywhere

Shared secret keys must be identical across workspace-dev and self-host:

```toml
[auth]
secret = "..."

[crypto]
master_encryption_key = "..."

[connectors]
enrollment_token = "..."
```

Profile-specific extensions can still exist, for example:

```toml
[smtp]
password = "..."
```

But shared concepts must not fork by profile.

### Rule 2: same concept, same encoding, everywhere

Define a real secret taxonomy instead of “non-empty string”.

Recommended primitives:

- `auth.secret`
  - opaque auth secret
  - generated as 32 random bytes encoded as base64url
- `connectors.enrollment_token`
  - opaque enrollment token
  - generated as 32 random bytes encoded as base64url
- `crypto.master_encryption_key`
  - **must** be 32 random bytes encoded as standard base64
  - validated semantically everywhere it can enter the system

### Rule 3: profile config is authored separately, shared runtime contract is explicit

Keep the good separation that already exists conceptually:

- `workspace-dev` for repo-local `bun dev`
- `self-host` for `onequery serve`

But make the shared parts explicit and mechanically enforced, not just “similar”.

### Rule 4: self-host runtime assets are a bundle, not path folklore

Self-host should run from one explicit runtime bundle layout, not from several bits of repeated path knowledge.

Recommended direction:

```text
runtime/
  manifest.json
  migrations/
  web/
server/
  onequery-server[platform-specific]
```

The CLI should resolve a **bundle root**, read `runtime/manifest.json`, and launch from that.

No repo-specific path inference inside the `serve` command.

### Rule 5: one owner for schema convergence

Recommended decision:

- the runtime startup path owns application schema convergence
- bootstrap/setup commands own infra/bootstrap only
- tests may still call explicit DB prep helpers as test harnesses

This means:

- self-host runtime startup migrates its DB
- workspace-dev Bun startup migrates its DB
- `dev:setup` should stop applying application migrations

### Rule 6: docs must only describe real supported behavior

If self-host Postgres is not actually implemented through the self-host config model, docs must not describe it as supported.

Ambient `DATABASE_URL` should not be part of the self-host story.

If Postgres self-host is desired later, add it explicitly through self-host config and the launch contract.

---

## Workstream A — Fix the released `onequery serve` data-source bug first

### Goal

Make self-host generate a valid encryption master key and fail fast on invalid config before the server starts.

### TODO

- [ ] In `apps/cli/crates/onequery-cli/src/config/self_host.rs`, replace `generate_secret("master-encryption")` with a real master-key generator that produces **base64-encoded 32-byte key material**.
- [ ] Keep auth secret and connector enrollment token as generated opaque secrets, but make them use explicit generators too instead of the current generic `generate_secret(label)` pattern.
- [ ] Remove the generic `generate_secret(label)` helper entirely if it encourages semantic drift.
- [ ] Add semantic validation for `crypto.master_encryption_key` when self-host secrets are loaded, not only when credentials are first encrypted.
- [ ] Add semantic validation for `crypto.masterEncryptionKey` in `packages/config/src/server-launch.ts`.
- [ ] Make `onequery serve` fail before launching the Bun runtime if self-host secrets are invalid.
- [ ] Error must name the bad file path and the bad field, for example: `self-host/secrets.toml -> crypto.master_encryption_key`.
- [ ] Because backward compatibility is not needed, reject old invalid secrets instead of silently accepting or repairing them.
- [ ] Update `packages/config/fixtures/self-host-launch.json` to a valid master key.
- [ ] Remove all invalid test values like `"master"` and `"master-key"` from launch/runtime tests.

### Acceptance

- [ ] Fresh `onequery serve` bootstrap produces a self-host secrets file whose `master_encryption_key` passes base64 decode and 32-byte length validation.
- [ ] Creating a data source through `POST /api/data-sources` succeeds on a fresh self-host instance.
- [ ] CLI-side source connect flow also succeeds with the same generated key.
- [ ] An invalid self-host secrets file causes startup failure with a clear config error, not a delayed 500 later.

---

## Workstream B — Unify shared secrets across workspace-dev and self-host

### Goal

Make the two secrets files honest projections of the same shared secret vocabulary.

### Current mismatch to remove

- workspace-dev: `auth.secret`
- self-host: `auth.better_auth_secret`

There is no architectural reason for this difference.

### TODO

- [ ] Rename self-host `auth.better_auth_secret` to `auth.secret`.
- [ ] Update self-host Rust structs accordingly.
- [ ] Update backup/restore expectations and any tests that look for `better_auth_secret`.
- [ ] Keep `smtp.password` as a self-host-only extension in the secrets file.
- [ ] Introduce one shared conceptual document/schema for shared secret sections.
- [ ] Ensure workspace-dev and self-host use the same generator semantics for each shared secret type.
- [ ] Add one canonical sample secrets fixture/helper used by tests in both TS and Rust.

### Suggested target file shapes

Workspace-dev secrets:

```toml
[auth]
secret = "..."

[crypto]
master_encryption_key = "..."

[connectors]
enrollment_token = "..."
```

Self-host secrets:

```toml
[auth]
secret = "..."

[crypto]
master_encryption_key = "..."

[connectors]
enrollment_token = "..."

[smtp]
password = "..." # optional
```

### Acceptance

- [ ] Shared secret section names are identical across both profiles.
- [ ] Shared secret generation rules are identical across both profiles.
- [ ] No code path refers to `better_auth_secret` anymore.

---

## Workstream C — Make the launch contract a real SSoT boundary

### Goal

Stop relying on “shape-only parity” across TS and Rust.

### Recommended direction

The current “TS is canonical, Rust has a local struct plus fixture parity” model is no longer strong enough.

Recommended upgrade:

- keep `packages/config` as the human-owned contract source
- generate a neutral schema artifact from it
- validate Rust-emitted launch JSON against that artifact in CI/tests

This can be a JSON Schema or another simple machine-readable artifact, but the key point is:

- one contract source
- generated artifact
- both Rust and TS test against the same semantics

### TODO

- [ ] Introduce explicit semantic validators for secret-bearing fields in `packages/config/src/server-launch.ts`.
- [ ] Generate a neutral launch-contract artifact from the config package.
- [ ] Make Rust launch-config tests validate against the generated artifact rather than only matching a hand-maintained fixture.
- [ ] Keep Rust local serde structs if they are ergonomic, but stop pretending fixture equality alone is enough.
- [ ] Update `packages/config/fixtures/self-host-launch.json` so it is generated from or at least validated by the same semantic contract.
- [ ] Add a contract-version field if future evolution is expected.

### Acceptance

- [ ] A semantically invalid self-host launch JSON fails contract validation even if all keys are present.
- [ ] Rust-emitted launch JSON is checked against the same contract artifact that Bun uses.
- [ ] The self-host fixture can no longer drift into semantically invalid values.

---

## Workstream D — Separate workspace-dev and self-host execution paths cleanly

### Goal

Keep the profiles separate in behavior **and** in executable architecture.

### Current smell

`onequery serve` currently acts like two commands hidden behind auto-detection:

- packaged self-host runner
- repo-local Bun entry launcher

That is convenient, but it is not clean.

### Recommended decision

`onequery serve` should be **self-host only**.

Repo-local smoke/dev for self-host should use a dedicated dev staging path that builds the same runtime bundle shape and then runs the same self-host command against that staged bundle.

### TODO

- [ ] Remove repo-local path inference from `apps/cli/.../commands/serve.rs`.
- [ ] Stop using `env!("CARGO_MANIFEST_DIR")` inside `serve.rs` to discover repo assets.
- [ ] Introduce one explicit self-host runtime bundle root input.
- [ ] Keep packaged executable selection logic, but make asset/migration discovery come from the bundle manifest, not code branches.
- [ ] Create a dedicated local dev/self-host smoke script that stages a real runtime bundle and invokes `onequery serve` against it.
- [ ] Keep `scripts/run-bun-server.ts` as workspace-dev-only machinery.
- [ ] Remove any accidental “self-host but really using repo-local dev assumptions” behavior from the serve command.

### Acceptance

- [ ] `bun dev` remains the repo-local split browser/API flow.
- [ ] `onequery serve` becomes a pure self-host runtime launcher.
- [ ] Local self-host smoke uses the same runtime bundle layout as release, not special repo discovery.

---

## Workstream E — Introduce a self-host runtime bundle manifest

### Goal

Make runtime assets and migrations discoverable from one place.

### Current duplication to remove

The following all know too much about runtime layout:

- `apps/cli/.../commands/serve.rs`
- `apps/cli/scripts/build-npm-package.js`
- `scripts/run-bun-server.ts`
- `packages/bun-server/src/assets.ts`

### Recommended bundle contract

Example:

```json
{
  "bundleVersion": 1,
  "webDir": "runtime/web",
  "migrationsDir": "runtime/migrations"
}
```

Or equivalent relative-path form. Exact fields are less important than having **one** explicit manifest.

### TODO

- [ ] Add `runtime/manifest.json` to the packaged self-host runtime.
- [ ] Make `build-npm-package.js` generate it.
- [ ] Make the local self-host staging path generate the same manifest.
- [ ] Make `serve.rs` read the manifest to find web assets and migrations.
- [ ] Remove duplicated web/migrations path constants where they are no longer needed.
- [ ] Pick **one** web build output directory for runtime use.
- [ ] Delete the `dist/client` vs `dist` fallback behavior from self-host runtime code paths.

### Strong recommendation on web build output

Choose one runtime output path and enforce it. The current fallback between:

- `apps/web/dist/client`
- `apps/web/dist`

is a smell. The runtime should not need to guess.

### Acceptance

- [ ] One manifest defines the runtime bundle layout.
- [ ] Packaging and local self-host smoke consume the same manifest.
- [ ] `onequery serve` no longer hardcodes repo-only runtime asset paths.
- [ ] Runtime no longer guesses between multiple web output directories.

---

## Workstream F — Make migration ownership explicit and remove storage/doc drift

### Goal

Have one clean answer to “who migrates the application schema?” and “what self-host storage modes are supported?”

### Recommended decisions

1. **Runtime startup owns schema convergence** for actual app runtimes.
2. `dev:setup` owns infra/bootstrap only.
3. Self-host storage is explicit, not ambient.
4. Self-host Postgres should not be documented until it actually exists in the self-host config model.

### TODO

- [ ] Remove app-schema migration execution from `scripts/dev-setup.ts`.
- [ ] Keep infra setup there: secrets bootstrap, Docker/Postgres startup, `pgvector` enablement, etc.
- [ ] Let workspace-dev Bun startup apply migrations using the launch contract.
- [ ] Keep test harnesses free to call DB prep helpers directly.
- [ ] Rename `prepareSelfHostDatabase()` to something accurate like `prepareApplicationDatabase()` or `prepareRuntimeDatabaseSchema()` since it is not self-host-only.
- [ ] Remove self-host `DATABASE_URL` documentation from `docs/self-host.md` for now.
- [ ] Audit the repo for any lingering suggestion that self-host Postgres is supported via ambient env.
- [ ] If self-host Postgres is desired later, add it as explicit self-host config, for example a `[storage]` section, and project it into the launch contract.

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

- [ ] There is one clear migration owner for runtime startup.
- [ ] `dev:setup` no longer applies the application schema.
- [ ] Self-host docs match actual supported storage behavior.
- [ ] The DB prep helper name no longer implies “self-host only” when it is used everywhere.

---

## Workstream G — Delete dead knobs and compatibility shims

### Goal

Remove config/options that create surface area without carrying real meaning.

### TODO

- [ ] Delete `server.log_level` from self-host config unless it is wired all the way through to actual runtime logging behavior.
- [ ] Remove any serve/status JSON that only reflects dead config.
- [ ] Remove the legacy unsupported-test cleanup shim in `packages/server/src/routes/data-sources/crud.ts` (`LEGACY_UNSUPPORTED_TEST_PREFIX`) since backward compatibility is explicitly not needed here.
- [ ] Delete any stale comments/docs that still describe the old compatibility assumptions.

### Acceptance

- [ ] Every remaining config field changes real behavior.
- [ ] Route code no longer includes one-off migration cleanup for legacy states that we no longer support.

---

## Workstream H — Reduce redundant tests and replace them with higher-value checks

### Goal

Have fewer tests, but stronger tests.

### Current redundancy

There are too many tests rebuilding almost the same launch config object and asserting it survives different wrappers.

That coverage is expensive but still missed the actual production failure.

### Recommended test shape

#### Keep

- one contract test suite for launch-config semantics
- one file-I/O wrapper test suite for reading launch config from disk
- one runtime mapping test suite
- one Rust self-host config/bootstrap suite
- one end-to-end self-host smoke that proves fresh bootstrap can create a data source

#### Remove / collapse

- repeated launch-config object builders in multiple packages
- fixture parity tests that only confirm the same invalid sample shape
- runtime tests using invalid master keys
- overlapping serve/config tests that do not defend unique behavior

### TODO

- [ ] Create shared launch-config builders/helpers in one place for TS tests.
- [ ] Create one canonical valid self-host launch fixture.
- [ ] Make all test helpers use a valid sample master key.
- [ ] Collapse duplicate launch-config builders across `packages/config`, `packages/bun-server`, and `packages/server` tests.
- [ ] In Rust, keep tests for:
  - [ ] filesystem layout
  - [ ] config/secrets parsing
  - [ ] bootstrap file creation
  - [ ] launch-config projection
  - [ ] startup/serve behavior unique to the CLI
- [ ] Drop Rust tests that only repeat the same launch-contract shape with different hardcoded literals.
- [ ] Add semantic tests that invalid master keys are rejected.
- [ ] Add one smoke test that fresh self-host bootstrap can actually encrypt credentials and create a data source.
- [ ] Add one smoke test that invalid self-host secrets fail on startup, not later during API usage.

### Acceptance

- [ ] Test count for launch-config boilerplate goes down.
- [ ] Semantic coverage for master-key validity goes up.
- [ ] The specific self-host regression is defended by at least one end-to-end test.

---

## Workstream I — Update docs so they stop lying

### Goal

Make docs reflect the real architecture after cleanup.

### TODO

- [ ] Update `docs/env-secrets-management.md` to show the unified shared secret names.
- [ ] Update `docs/self-host.md` to remove unsupported self-host Postgres / `DATABASE_URL` language unless actually implemented.
- [ ] Update `docs/self-host-runtime-foundation.md` to describe the runtime bundle manifest and the stricter contract story.
- [ ] Update any README text that still implies old env/config sync behavior.
- [ ] Document the actual self-host secrets file path from code:
  - default Unix path: `${XDG_CONFIG_HOME:-~/.config}/onequery/self-host/secrets.toml`
  - or `$ONEQUERY_HOME/config/self-host/secrets.toml`
- [ ] Document that `onequery serve` is self-host only and that repo-local self-host smoke uses a separate staging path.

### Acceptance

- [ ] Docs no longer mention unsupported self-host storage behavior.
- [ ] Docs no longer show stale field names.
- [ ] Docs describe exactly one runtime-discovery story for self-host.

---

## Concrete things to delete

These are good deletion candidates during the cleanup:

- [ ] `auth.better_auth_secret`
- [ ] generic `generate_secret(label)` for semantically different secret types
- [ ] invalid shared fixture values like `"master"`
- [ ] repo-local runtime discovery branch in `serve.rs`
- [ ] self-host `dist/client` vs `dist` fallback guessing
- [ ] self-host `DATABASE_URL` docs/claims
- [ ] `server.log_level` if it stays behaviorless
- [ ] legacy unsupported-test migration shim in data-sources CRUD route
- [ ] duplicated launch-config builders across multiple test files

---

## Suggested implementation order

### Phase 1 — Stop the production bug

- [ ] Fix self-host master-key generation
- [ ] Add semantic validation in self-host config load and launch contract validation
- [ ] Replace invalid fixtures/tests
- [ ] Add startup-failure test for invalid secrets
- [ ] Add self-host create-data-source smoke test

### Phase 2 — Unify secret vocabulary

- [ ] Rename `better_auth_secret` -> `secret`
- [ ] Update backup/restore/tests/docs
- [ ] Introduce shared secret primitives/helpers

### Phase 3 — Clean the self-host runtime boundary

- [ ] Introduce runtime bundle manifest
- [ ] Remove repo-local serve auto-discovery
- [ ] Add dedicated local self-host staging/smoke path
- [ ] Pick one web output directory

### Phase 4 — Clarify DB ownership and storage truth

- [ ] Remove app migrations from `dev:setup`
- [ ] Rename DB prep helper
- [ ] Remove self-host Postgres docs unless implemented explicitly
- [ ] If desired, later add explicit self-host `[storage]` config

### Phase 5 — Delete dead config/tests/shims

- [ ] remove `log_level` if still unused
- [ ] remove legacy route shim
- [ ] collapse duplicate tests
- [ ] refresh docs

---

## Final acceptance checklist for the whole cleanup

- [ ] Fresh `onequery serve` bootstrap produces valid secrets and can create a data source successfully.
- [ ] Shared secret names are identical across workspace-dev and self-host for shared concepts.
- [ ] Shared secret semantics are identical across workspace-dev and self-host for shared concepts.
- [ ] Self-host runtime asset discovery comes from one explicit bundle manifest.
- [ ] `onequery serve` no longer auto-switches between packaged and repo-local runtime discovery.
- [ ] Workspace-dev remains the split browser/API flow and self-host remains the single-origin packaged runtime.
- [ ] Runtime startup is the clear owner of schema convergence.
- [ ] Self-host docs match the real supported storage story.
- [ ] Dead config knobs and compatibility shims are removed.
- [ ] Redundant launch-config tests are reduced.
- [ ] The regression that broke `POST /api/data-sources` is covered by automated tests.

---

## Bottom line

The most important issue is **not** just “fix the self-host master key bug”.

The deeper issue is that OneQuery currently has several places that *look* like single sources of truth, but still allow semantic drift:

- secrets vocabulary drifts by profile
- runtime contract validates shape but not meaning
- self-host runtime layout is repeated instead of declared once
- docs claim storage behavior that code does not actually implement
- tests repeat shapes instead of defending invariants

If this cleanup is done aggressively, the result should be:

- cleaner workspace-dev vs self-host separation
- a real runtime contract boundary
- no hidden profile drift for shared secrets
- fewer tests, but much stronger ones
- no more “works until the first encrypted credential” failures in released self-host builds

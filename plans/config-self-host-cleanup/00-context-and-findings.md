# Context and findings

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

Architectural note:

- the important invariant is **32 bytes of encryption key material**
- the base64 layer is the current text representation used to carry that key through TOML/JSON boundaries
- standard base64 is therefore an implementation choice in the current system, not the underlying security property

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

### 1) Shared secret concepts are not actually standardized

`onequery.dev.secrets.toml` and self-host `secrets.toml` should stay as separate profile-owned files, but they are supposed to agree on the same secret schema for shared concepts. Today they drift in both **naming** and **generation semantics**.

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
- same concept, different source of truth: server-side TS and `apps/cli` Rust each define their own field names and secret formats

The problem is not that the two files hold different secret values. They should. The problem is that the schema and encoding rules are not owned in one place.

This is the inverse of the SSoT boundary we actually want.

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

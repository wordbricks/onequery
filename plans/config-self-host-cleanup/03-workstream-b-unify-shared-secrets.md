# Workstreams B/C — Standardize secret schema and make the launch contract a real boundary

## Workstream B — Standardize secret schema across workspace-dev and self-host

### Goal

Make `onequery.dev.secrets.toml` and self-host `secrets.toml` honest projections of the same shared secret schema.

This does **not** mean the two profiles share secret values. It means they use the same key names, external text representations, and validation rules for overlapping concepts while staying separate config files.

The canonical target shape and encoding rules live in `01-target-architecture.md`. This workstream only owns the implementation needed to reach that target.

### Current contract drift to remove

- workspace-dev: `auth.secret`
- self-host: `auth.better_auth_secret`

There is no architectural reason for this difference.

### TODO

- [x] Keep `onequery.dev.secrets.toml` and self-host `secrets.toml` as separate files with independently generated values.
- [x] Rename self-host `auth.better_auth_secret` to `auth.secret`.
- [x] Update self-host Rust structs accordingly.
- [x] Update backup/restore expectations and any tests that look for `better_auth_secret`.
- [x] Keep `smtp.password` as a self-host-only extension in the secrets file.
- [x] Introduce one shared schema/contract for overlapping secret sections, key names, and external text representations consumed by both server-side TS and `apps/cli` Rust.
- [x] Ensure workspace-dev and self-host use the same generator semantics for each shared secret type.
- [x] Treat `auth.secret` and `connectors.enrollment_token` as opaque transport strings after validation.
- [x] Treat `crypto.master_encryption_key` as the exception: validate its encoded form at config/launch boundaries, then normalize it to key bytes for runtime use.
- [x] Share the rules for valid secret samples, but keep test builders local to each language rather than introducing one cross-language fixture as SSoT.
- [x] Remove backward-compatibility shims or dual-read behavior for old secret keys and formats.
- [x] Update `docs/env-secrets-management.md` and any README text that still implies old env/config sync behavior.

### Acceptance

- [x] Shared secret section names and value formats are identical across both profiles for overlapping concepts.
- [x] Shared secret generation and validation rules are identical across both profiles.
- [x] Workspace-dev and self-host still use separate secrets files; only the schema is shared.
- [x] No code path refers to `better_auth_secret` or legacy aliases anymore.
- [x] Docs no longer show stale field names or imply that workspace-dev and self-host share secret values.

## Workstream C — Make the launch contract a real SSoT boundary

### Goal

Stop relying on “shape-only parity” across TS and Rust.

### Recommended direction

The current “TS is canonical, Rust has a local struct plus fixture parity” model is no longer strong enough.

Recommended upgrade:

- keep `packages/config` as the human-owned contract source
- put semantic validation in the TS contract layer
- make Rust projection tests assert against those same semantics instead of only matching fixture shape

The key point is:

- one contract source
- semantic validation at the boundary
- Rust tests that defend the same meaning, not just the same JSON shape

### TODO

- [x] Introduce explicit semantic validators for secret-bearing fields in `packages/config/src/server-launch.ts`.
- [x] Keep transport-only string encodings at the launch boundary, but normalize semantically typed runtime values once during runtime config creation.
- [x] Replace fixture-shape parity as the main Rust contract check with projection tests that cover semantic validity and required field meaning.
- [x] Keep Rust local serde structs if they are ergonomic, but stop pretending fixture equality alone is enough.
- [x] Keep any shared sample launch JSON as a convenience artifact only, not the primary source of truth.

### Acceptance

- [x] A semantically invalid self-host launch JSON fails contract validation even if all keys are present.
- [x] Rust projection tests defend the same semantic contract that Bun validates.
- [x] Shared sample JSON can no longer mask semantic invalidity by passing shape-only parity tests.

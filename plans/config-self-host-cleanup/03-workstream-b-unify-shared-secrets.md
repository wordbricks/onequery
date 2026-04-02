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

- [ ] Keep `onequery.dev.secrets.toml` and self-host `secrets.toml` as separate files with independently generated values.
- [ ] Rename self-host `auth.better_auth_secret` to `auth.secret`.
- [ ] Update self-host Rust structs accordingly.
- [ ] Update backup/restore expectations and any tests that look for `better_auth_secret`.
- [ ] Keep `smtp.password` as a self-host-only extension in the secrets file.
- [ ] Introduce one shared schema/contract for overlapping secret sections, key names, and external text representations consumed by both server-side TS and `apps/cli` Rust.
- [ ] Ensure workspace-dev and self-host use the same generator semantics for each shared secret type.
- [ ] Add one canonical sample secrets fixture/helper used by tests in both TS and Rust.
- [ ] Remove backward-compatibility shims or dual-read behavior for old secret keys and formats.
- [ ] Update `docs/env-secrets-management.md` and any README text that still implies old env/config sync behavior.

### Acceptance

- [ ] Shared secret section names and value formats are identical across both profiles for overlapping concepts.
- [ ] Shared secret generation and validation rules are identical across both profiles.
- [ ] Workspace-dev and self-host still use separate secrets files; only the schema is shared.
- [ ] No code path refers to `better_auth_secret` or legacy aliases anymore.
- [ ] Docs no longer show stale field names or imply that workspace-dev and self-host share secret values.

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
- [ ] Keep transport-only string encodings at the launch boundary, but normalize semantically typed runtime values once during runtime config creation.
- [ ] Generate a neutral launch-contract artifact from the config package.
- [ ] Make Rust launch-config tests validate against the generated artifact rather than only matching a hand-maintained fixture.
- [ ] Keep Rust local serde structs if they are ergonomic, but stop pretending fixture equality alone is enough.
- [ ] Update `packages/config/fixtures/self-host-launch.json` so it is generated from or at least validated by the same semantic contract.
- [ ] Add a contract-version field if future evolution is expected.

### Acceptance

- [ ] A semantically invalid self-host launch JSON fails contract validation even if all keys are present.
- [ ] Rust-emitted launch JSON is checked against the same contract artifact that Bun uses.
- [ ] The self-host fixture can no longer drift into semantically invalid values.

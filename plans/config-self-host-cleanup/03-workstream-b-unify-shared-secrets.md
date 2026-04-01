# Workstream B — Standardize secret schema across workspace-dev and self-host

### Goal

Make `onequery.dev.secrets.toml` and self-host `secrets.toml` honest projections of the same shared secret schema.

This does **not** mean the two profiles share secret values. It means they use the same key names, value encodings, and validation rules for overlapping concepts while staying separate config files.

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
- [ ] Introduce one shared schema/contract for overlapping secret sections, key names, and value encodings consumed by both server-side TS and `apps/cli` Rust.
- [ ] Ensure workspace-dev and self-host use the same generator semantics for each shared secret type.
- [ ] Add one canonical sample secrets fixture/helper used by tests in both TS and Rust.
- [ ] Remove backward-compatibility shims or dual-read behavior for old secret keys and formats.

### Acceptance

- [ ] Shared secret section names and value formats are identical across both profiles for overlapping concepts.
- [ ] Shared secret generation and validation rules are identical across both profiles.
- [ ] Workspace-dev and self-host still use separate secrets files; only the schema is shared.
- [ ] No code path refers to `better_auth_secret` or legacy aliases anymore.

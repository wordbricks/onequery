# Workstream B — Unify shared secrets across workspace-dev and self-host

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

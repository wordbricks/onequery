# Workstream A — Fix the released `onequery serve` data-source bug first

### Goal

Make self-host generate a valid encryption master key and fail fast on invalid config before the server starts.

### TODO

- [ ] In `apps/cli/crates/onequery-cli/src/config/self_host.rs`, replace `generate_secret("master-encryption")` with a real master-key generator that produces 32 random bytes encoded in the chosen config representation.
- [ ] Keep auth secret and connector enrollment token as generated opaque secrets, but make them use explicit generators too instead of the current generic `generate_secret(label)` pattern.
- [ ] Remove the generic `generate_secret(label)` helper entirely if it encourages semantic drift.
- [ ] Add semantic validation for `crypto.master_encryption_key` when self-host secrets are loaded, not only when credentials are first encrypted.
- [ ] Add semantic validation for `crypto.masterEncryptionKey` in `packages/config/src/server-launch.ts`, matching the same chosen config representation and decoded 32-byte requirement.
- [ ] Normalize the validated master key once at the runtime boundary so request paths do not repeatedly call `deriveKeyFromBase64(...)` on transport strings.
- [ ] Make `onequery serve` fail before launching the Bun runtime if self-host secrets are invalid.
- [ ] Error must name the bad file path and the bad field, for example: `self-host/secrets.toml -> crypto.master_encryption_key`.
- [ ] Because backward compatibility is not needed, reject old invalid secrets instead of silently accepting or repairing them.
- [ ] Update `packages/config/fixtures/self-host-launch.json` to a valid master key.
- [ ] Remove all invalid test values like `"master"` and `"master-key"` from launch/runtime tests.

### Acceptance

- [ ] Fresh `onequery serve` bootstrap produces a self-host secrets file whose `master_encryption_key` decodes through the chosen config representation to exactly 32 bytes.
- [ ] Creating a data source through `POST /api/data-sources` succeeds on a fresh self-host instance.
- [ ] CLI-side source connect flow also succeeds with the same generated key.
- [ ] An invalid self-host secrets file causes startup failure with a clear config error, not a delayed 500 later.

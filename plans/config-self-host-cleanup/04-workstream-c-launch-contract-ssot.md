# Workstream C — Make the launch contract a real SSoT boundary

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

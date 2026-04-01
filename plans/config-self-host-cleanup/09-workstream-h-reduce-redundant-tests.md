# Workstream H — Reduce redundant tests and replace them with higher-value checks

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

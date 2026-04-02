# Workstreams G/H — Delete dead knobs and replace redundant tests

## Workstream G — Delete dead knobs and compatibility shims

### Goal

Remove config/options that create surface area without carrying real meaning.

### TODO

- [ ] Delete `server.log_level` from self-host config rather than wiring it through.
- [ ] Remove any serve/status JSON that only reflects dead config.
- [ ] Remove the legacy unsupported-test cleanup shim in `packages/server/src/routes/data-sources/crud.ts` (`LEGACY_UNSUPPORTED_TEST_PREFIX`) since backward compatibility is explicitly not needed here.
- [ ] Delete any stale comments/docs that still describe the old compatibility assumptions.

### Acceptance

- [ ] Every remaining config field changes real behavior.
- [ ] Route code no longer includes one-off migration cleanup for legacy states that we no longer support.

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
- fixture parity tests that only confirm the same sample shape without semantic validation
- runtime tests using invalid master keys
- overlapping serve/config tests that do not defend unique behavior

### TODO

- [ ] Create shared launch-config builders/helpers in one place for TS tests.
- [ ] Treat semantic validators and runtime smoke tests as the real contract checks; any fixture kept in the repo is only a convenience artifact, not the source of truth.
- [ ] Make all test helpers use a valid sample master key.
- [ ] Collapse duplicate launch-config builders across `packages/config`, `packages/bun-server`, and `packages/server` tests.
- [ ] Prefer small boundary-focused samples over one giant canonical launch fixture.
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

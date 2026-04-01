# Implementation order and acceptance

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

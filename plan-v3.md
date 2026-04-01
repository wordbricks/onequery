# OneQuery config rewrite plan v3

This document is the **continuation** of `plan.md` and `plan-v2.md`.

Use the three files like this:

- `plan.md`: the big rewrite and the target architecture
- `plan-v2.md`: the strict SSoT cleanup pass
- `plan-v3.md`: the **final convergence pass** that removes the last split-brain package behavior, cleans package boundaries, and trims stale/redundant tests so the repo behaves like it is architected

This file is **not** another redesign.
It assumes the architecture is already basically correct and focuses only on the remaining gaps that still keep the repo below the “Jane Street-level SSoT” bar.

---

## Where v3 starts

By the time this file begins, the repo already has the right shape:

- `workspace-dev` is a first-class profile for `bun dev`
- `self-host` is a first-class profile for `onequery serve`
- browser port and API port are intentionally separate in local dev
- self-host authored config is Rust-owned
- workspace-dev authored config is TS-owned
- Bun startup consumes a launch contract instead of mixed env parsing
- `packages/server` consumes typed runtime config instead of env-shaped config
- authored config and secrets are now strict/fail-closed at the source level

That is the hard architectural work.

v3 exists because a few **implementation seams** still violate SSoT or make the package surface behave differently depending on how it is imported.

---

## Why v3 is needed

The repo is now **good v2 architecture**, but there are still four residual issues:

1. `@onequery/config` has **split behavior between `src` and `dist`**
   - `packages/config/package.json` exports Bun to `src/*` and default resolution to `dist/*`
   - the committed `dist` output is stale relative to `src`
   - `packages/config/dist/workspace-dev.js` still contains the old merged-defaults behavior that `src/workspace-dev.ts` removed

2. the built export surface is not fully valid
   - `packages/config/dist/server-launch.js` is empty
   - `packages/config/package.json` exports `./projections/server-launch`, but the corresponding built file is missing in `dist/projections/`

3. some consumers still bypass package boundaries and import `packages/config/src/*` directly
   - examples include `packages/bun-server/src/launch-config.ts`
   - `scripts/run-bun-server.ts`
   - `apps/cli/scripts/smoke-packaged-server.js`
   - some tests in `packages/bun-server`

4. at least one wrapper-level test still encodes the **old config model**
   - `apps/web/src/lib/vite-dev-server-config.test.ts` still assumes partial/default behavior from the old merged-defaults resolver
   - this test is now both stale and redundant relative to the owner-level config tests

These are not new architecture problems.
They are the last places where the implemented repo does not fully match the intended ownership model.

---

## What “done” means after v3

Call the config architecture finished only when all of the following are true:

- `@onequery/config` has one behavior regardless of resolver condition
- every exported subpath in `packages/config/package.json` actually resolves to a working artifact
- no other package reaches into `packages/config/src/*`
- tests are owned by the package that owns the behavior being tested
- wrapper packages only keep boundary tests, not duplicated schema/projection tests
- changing the config owner changes all consumers, and there is no stale compiled output that says otherwise

A good blunt test is:

> Can two engineers import `@onequery/config` through different paths and observe different behavior from the same package version?

- If yes, v3 is not done.
- If no, the repo is much closer to the true SSoT bar.

---

## Delta diagram: current v2 vs target v3

```text
                     AFTER plan-v2 (current good v2)

               packages/config/src  ── correct strict behavior
                         │
                         ├── Bun resolver condition
                         │
                         └── packages/config/dist ── stale / incomplete behavior
                                      │
                                      └── default resolver condition

   some consumers import @onequery/config     some consumers import ../packages/config/src/*
   some wrapper tests match owner behavior    some wrapper tests still match old behavior


                     AFTER plan-v3 (target)

                  packages/config canonical implementation
                         │
            ┌────────────┴────────────┐
            │                         │
      package exports            built artifacts
      all valid                  fresh or eliminated
            │                         │
            └────────────┬────────────┘
                         │
               all consumers import package surface only
                         │
               owner package owns schema/projection tests
               wrappers keep only boundary smoke tests
```

---

## Non-goals for v3

Do **not** reopen these decisions:

- do not re-merge `workspace-dev` and `self-host`
- do not reintroduce env-shaped config as the main model
- do not add compatibility for the deleted local-env architecture
- do not add more optional knobs just because the package surface is being touched
- do not turn v3 into a broad codegen or framework project unless it is strictly necessary

v3 is a convergence pass, not a redesign.

---

## Phase 18 — make `@onequery/config` one-behavior on every import path

### Problem

Right now the same package can behave differently depending on resolution path:

- Bun/workspace consumers hit `src/*`
- default resolution hits `dist/*`
- `src` contains the new strict workspace-dev resolver
- `dist` still contains stale pre-v2 behavior in at least `workspace-dev.js`

That is a literal split-brain package.

### Goal

Make `@onequery/config` have **one behavior**, regardless of whether it is imported via Bun resolution or default Node/package resolution.

### Preferred end states

Accept either of these, but choose one explicitly:

1. **Preferred:** remove committed `dist` as a source of truth for the workspace package
   - build artifacts are ephemeral outputs, not checked-in behavior
   - package exports for workspace use source directly
   - published/packageable artifacts are generated in CI/release flow only

2. **Acceptable:** keep `dist`, but it must be treated as a strict generated artifact
   - every source change that affects exports must regenerate `dist`
   - CI must fail if `dist` is stale or incomplete
   - no consumer may observe different semantics through `dist`

### Checklist

- [ ] Decide whether `packages/config/dist` stays committed or is removed from the repo surface.
- [ ] If `dist` stays committed, regenerate it from current `src` before doing anything else.
- [ ] Fix the current broken export/build mismatch:
  - [ ] `packages/config/dist/server-launch.js` must not be empty
  - [ ] `packages/config/dist/projections/server-launch.js` must exist if `./projections/server-launch` remains exported
- [ ] Investigate and fix the current build/output collision around `server-launch.ts` vs `projections/server-launch.ts`.
- [ ] Add an artifact-integrity test or script that verifies every exported subpath in `packages/config/package.json` resolves to a non-broken target.
- [ ] Add a freshness gate so `src` and `dist` cannot silently diverge again.
- [ ] Add a targeted regression test proving `resolveWorkspaceDev()` behaves the same through the supported package surface regardless of resolver condition.

### Recommended implementation notes

If you keep `dist`, prefer an explicit CI step like:

```sh
bun run --cwd packages/config build
git diff --exit-code -- packages/config/dist packages/config/package.json
```

If you remove committed `dist`, then remove any workflow that still treats checked-in built output as authoritative.

### Done when

- importing `@onequery/config/workspace-dev` through any supported package path gives the same semantics
- no exported subpath points at an empty or missing artifact
- `dist` is either fresh by enforcement or no longer a source of truth

### Smells

- `src` and `dist` produce different parse/validation results
- one export exists in `package.json` but not in the filesystem
- a bug fix lands in `src` and silently misses default-resolution consumers

---

## Phase 19 — restore package boundaries and stop importing `src/*` across packages

### Problem

Some packages still reach directly into `packages/config/src/*` or `../../config/src/*`.
That bypasses the public package surface and hides export/build problems.

It also means the repo can “work” even while the package boundary is broken.

### Goal

All external consumers should import `@onequery/config` through its exported package surface only.
No cross-package file-path imports into `src/*` should remain.

### Checklist

- [ ] Audit all direct cross-package imports of `packages/config/src/*` or equivalent relative paths.
- [ ] Replace them with package imports such as:
  - [ ] `@onequery/config`
  - [ ] `@onequery/config/server-launch`
  - [ ] `@onequery/config/workspace-dev`
  - [ ] `@onequery/config/projections/server-launch`
- [ ] Add an explicit exported subpath for testing helpers if they are intentionally shared, for example `@onequery/config/testing`.
- [ ] If a helper is not meant to be a shared package API, move it local to the consumer instead of importing from `src/testing.ts`.
- [ ] Update:
  - [ ] `packages/bun-server/src/launch-config.ts`
  - [ ] `scripts/run-bun-server.ts`
  - [ ] `apps/cli/scripts/smoke-packaged-server.js`
  - [ ] any tests that import `../../config/src/*`
- [ ] Add a repo check that fails on new cross-package `src/*` imports.

### Recommended repo check

A simple search-based gate is enough:

```sh
rg -n 'packages/config/src|\.\./\.\./config/src|\.\./packages/config/src' apps packages scripts
```

That should return nothing outside `packages/config` itself.

### Done when

- consumers only use the package surface
- broken exports cannot be masked by direct file-path imports
- shared test helpers are either explicitly exported or intentionally local

### Smells

- a package can only compile because it sidesteps `package.json` exports
- tests import internals that production code is not allowed to import

---

## Phase 20 — trim stale and redundant tests so test ownership matches code ownership

### Problem

Some tests still reflect the old behavior or test the same thing in the wrong package.
The clearest current example is the Vite wrapper test:

- `apps/web/src/lib/vite-dev-server-config.ts` is now just a thin wrapper around `resolveWorkspaceDev()` and `projectViteDevServerConfig()`
- `apps/web/src/lib/vite-dev-server-config.test.ts` still assumes old partial/default behavior and duplicates projection semantics already owned by `packages/config`

This makes tests noisy and misleading.

### Goal

Move tests to the package that owns the behavior.
Keep wrapper packages focused on boundary wiring, not on re-specifying the config model.

### Ownership rule

- `packages/config` owns schema, parsing, projection, and launch-contract shape tests
- `packages/bun-server` owns startup/file-loading/boundary adapter tests
- `apps/web` owns only Vite-wrapper wiring smoke tests, if any are still useful
- Rust CLI owns self-host authored-file parsing and launch emission tests

### Checklist

- [ ] Rewrite or delete `apps/web/src/lib/vite-dev-server-config.test.ts`.
- [ ] If kept, reduce it to a minimal boundary smoke test that uses a full valid workspace-dev fixture, not partial/default assumptions.
- [ ] Move launch-contract invalid-shape tests to the owner package if they are really contract-shape tests.
- [ ] Keep `packages/bun-server/src/launch-config.test.ts` focused on boundary concerns such as:
  - [ ] missing file
  - [ ] unreadable file
  - [ ] invalid JSON syntax
  - [ ] one or two validation smoke cases proving the loader delegates to the contract validator
- [ ] Add or expand owner-level tests in `packages/config/src/server-launch.test.ts` so the contract owner carries the shape matrix.
- [ ] Remove duplicated negative-case matrices from consumers once the owner-level suite exists.
- [ ] Ensure no test still assumes that secrets-only files or partial config files are enough for strict workspace-dev resolution.

### Recommended split for launch tests

Keep this split tight:

- `packages/config/src/server-launch.test.ts`
  - strict shape tests
  - unknown key
  - missing key
  - wrong type
  - union mismatch
  - self-host/runtimePaths rules

- `packages/bun-server/src/launch-config.test.ts`
  - reads file from disk
  - wraps JSON parse errors cleanly
  - surfaces validator errors from the canonical contract owner

### Done when

- the owner package contains the spec tests
- wrappers contain only thin boundary tests
- no stale test still documents the deleted behavior as if it were current

### Smells

- a wrapper test re-encodes the same defaults already tested in the config package
- consumer tests fail only because they still expect the old resolver model
- negative contract-shape tests live only in consumers, not in the owner package

---

## Phase 21 — explicitly lock the launch-contract ownership decision

### Problem

The repo is close to having a clear launch-contract owner, but this needs to be made explicit so it does not drift back into “schema here, structs there, tests somewhere else” ambiguity.

### Goal

Make one file/package the undisputed owner of the launch-contract shape, then treat all other code as producer or consumer of that owner.

### Recommended decision

Keep it simple unless there is a proven need for more machinery:

- canonical owner: `packages/config/src/server-launch.ts`
- Bun consumer validation: import the canonical validator through package exports
- Rust producer: emit JSON that conforms to the canonical contract, with parity tests and fixtures

That is good enough if it is clearly documented and enforced.
You do **not** need a codegen project unless the current parity approach becomes painful.

### Checklist

- [ ] Document the canonical launch-contract owner in code comments and docs.
- [ ] Make Bun consume that owner only through the public `@onequery/config` package surface.
- [ ] Keep or strengthen Rust parity tests against the canonical contract/fixtures.
- [ ] Remove any leftover duplicate launch-shape declarations that are no longer needed after the package-boundary cleanup.
- [ ] Decide explicitly whether the current parity approach is the final bar or whether a neutral schema artifact is still required.
- [ ] Write down that decision so future contributors do not reopen the question casually.

### Done when

- you can point at one launch-contract owner without caveats
- producer and consumer tests both orbit that owner
- there is no lingering ambiguity about whether another file is “also authoritative”

---

## Phase 22 — final convergence gate

Run this only after Phases 18–21 are complete.

### Export and artifact checks

- [ ] Every exported subpath in `packages/config/package.json` resolves successfully.
- [ ] No exported JS file is empty unless it is intentionally a type-only stub and documented as such.
- [ ] If `dist` is committed, `bun run --cwd packages/config build` produces no diff.
- [ ] If `dist` is not committed, no workflow still relies on stale checked-in build output.

### Boundary checks

- [ ] `rg -n 'packages/config/src|\.\./\.\./config/src|\.\./packages/config/src' apps packages scripts` returns nothing outside `packages/config` itself.
- [ ] shared testing helpers are imported through explicit exports or are local to the package that uses them.

### Test-ownership checks

- [ ] owner-level config tests carry the schema/projection matrices
- [ ] wrapper tests only cover wrapper wiring
- [ ] no stale test still expects secrets-only or partial-config fallback behavior for `workspace-dev`

### Behavior checks

- [ ] importing `@onequery/config` through supported paths produces one behavior
- [ ] `bun dev` still resolves workspace-dev correctly
- [ ] `onequery serve` still resolves self-host correctly
- [ ] changing a config owner changes its consumers without touching stale build artifacts

### Human-review question

Ask this before calling the work done:

> Can someone accidentally fix a config bug in `src` while leaving default package consumers on different behavior through stale `dist` or direct `src` imports?

- [ ] If yes, v3 is not done.
- [ ] If no, the implementation finally matches the architecture.

---

## Recommended commit order

1. Phase 18 — fix `@onequery/config` export/build convergence
2. Phase 19 — remove cross-package `src/*` imports and add explicit test exports if needed
3. Phase 20 — rewrite/delete stale wrapper tests and move shape tests to the owner package
4. Phase 21 — lock the launch-contract ownership decision
5. Phase 22 — run the final convergence gate and clean any leftovers

---

## Red flags that mean v3 is going off track

Stop and correct course if any of these happen:

- `dist` is kept, but there is still no freshness gate
- broken package exports are worked around by more direct `src/*` imports
- wrapper tests are “updated” by reintroducing old fallback behavior into the implementation
- launch-contract ownership becomes more ambiguous instead of less
- new test helpers are shared informally through deep file imports instead of explicit package exports
- the repo starts treating checked-in build output as a second source of truth again

---

## End state summary

When v3 is complete, the repo should have this property:

```text
one architecture -> one package surface -> one behavior -> one owner per test/spec boundary
```

And it should **not** have this property:

```text
correct src + stale dist + deep-import workaround + wrapper tests that still describe the deleted model
```

That is the final gap between “good architecture on paper” and “actually Jane Street-level SSoT in implementation”.

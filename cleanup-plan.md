# OneQuery cleanup plan after v3

This file is the follow-up to `plan.md`, `plan-v2.md`, and `plan-v3.md`.

Those earlier plans got the repo to the correct **configuration architecture**:

- `workspace-dev` is the repo-owned local profile
- `self-host` is the installed-runtime profile
- `packages/server` starts from typed runtime config
- `onequery serve` starts from a serialized launch contract
- env-shaped authored config is gone
- workspace-dev config/secrets are fail-closed

At this point, the main architecture is **good**.

This cleanup plan is only for the remaining gaps where the repo is still **not fully free of redundancy / duplication / private-boundary leaks**.

This is **not** another redesign.
It is a short convergence pass.

---

## Current verdict

The repo is **close**, but it is **not yet at “no redundancy at all”**.

The remaining issues are concentrated in four areas:

1. `@onequery/config` no longer has split-brain exports, but it still carries an unused `dist` build/check pipeline.
2. A few places still import other packages through private `src/*` paths.
3. The packaged-server smoke script still appears to use env knobs that are no longer part of the current runtime contract.
4. A small amount of intentional duplication remains in the TS/Rust launch-contract story and in a few shared test constants.

The first three are the real cleanup targets.
The fourth is optional unless the goal is literal zero duplication.

---

## What is already done well

Do **not** reopen these decisions:

- keep `workspace-dev` vs `self-host` as separate profiles
- keep authored config and secrets as separate files
- keep fail-closed parsing
- keep launch-config startup for self-host
- keep typed runtime config in `packages/server`
- keep the reduced one-case wrapper smoke test in `apps/web` unless it grows again

---

## Cleanup 1 — remove the unused `@onequery/config` dist pipeline, or make it truly real

### Context

`packages/config/package.json` now exports only `src/*` for all runtime conditions.
That fixed the old split-brain problem.

But the package still has:

- `packages/config/scripts/build-dist.mjs`
- `packages/config/scripts/check-package-surface.mjs`
- `packages/config` `build` script that writes `dist/*`

At the moment, that `dist/*` output is **not the active package surface**.
So unless the package genuinely needs a built JS artifact for publishing, this is now redundant.

### Goal

Choose one model and delete the other.

### Options

#### Option A — source-only package surface (simplest)

Use this if `@onequery/config` is only consumed inside the Bun/TS monorepo.

- [x] delete the `dist` build pipeline from `packages/config`
- [x] remove `build-dist.mjs`
- [x] remove `check-package-surface.mjs`
- [x] change `packages/config/package.json` scripts so they no longer imply a second runtime artifact
- [x] remove any Turbo assumptions that `packages/config` must output `dist/**`
- [x] keep `package-surface.test.ts` if you still want the package-surface import check

#### Option B — real built package surface (only if actually needed)

Use this only if `@onequery/config` is intended to be consumable as a built JS package outside Bun/TS source resolution.

- [ ] point the package runtime exports at `dist/*`
- [ ] keep `src/*` as the authoring source only
- [ ] wire `build-dist.mjs` into a mandatory freshness/publish path
- [ ] ensure tests check the published surface, not just source files

### Recommendation

Prefer **Option A** unless there is a real external-publish requirement for this package.
The current source-only exports strongly suggest that `dist/*` is now dead weight.

### Done when

- there is only one real runtime surface for `@onequery/config`
- the repo does not generate unused `dist/*` output for that package anymore

Status:
- [x] Complete. `@onequery/config` is now source-only, and the old `dist` pipeline was removed instead of being kept as a dead second artifact.

---

## Cleanup 2 — fix remaining private `src/*` package-boundary leaks

### Context

The config-specific boundary leak is fixed, but the monorepo still has a few broader private-source imports.

Current examples:

- `scripts/run-bun-server.ts` imports `../packages/bun-server/src/assets`
- `apps/cli/scripts/build-npm-package.js` imports `../../../packages/db/src/pglite.ts`
- `packages/cli-server/src/source/effects.ts` imports `../../../server/src/services/crypto/credential-encryption`
- `packages/cli-server/src/transport/handlers/cliSourceConnect.ts` imports:
  - `../../../../server/src/routes/data-sources/schemas`
  - `../../../../server/src/services/connectors/broker`

These are not config-architecture failures, but they are still private-boundary leaks.
They make drift easier to hide and they weaken package ownership.

### Goal

Every cross-package dependency should go through one of these only:

- a public package export
- an intentional shared package
- an intentional shared fixture/artifact path (tests only)

### Checklist

- [x] add a **general package-boundary check**, not just a config-package check
- [x] fail CI/test when code outside a package imports another package’s private `src/*`
- [x] fix each current offender by either exporting or relocating the shared code

### Recommended fixes by file

#### `scripts/run-bun-server.ts`

Current issue:
- pulls `getDefaultSpaBuildDir()` from `packages/bun-server/src/assets`

Cleanup:
- [x] export `getDefaultSpaBuildDir` from `@onequery/bun-server/assets`
- [x] or move that helper into a more neutral shared package if it is conceptually not bun-server-owned
- [x] update the script to use the public subpath export

#### `packages/cli-server/src/source/effects.ts`

Current issue:
- imports `credential-encryption` through `server/src`

Cleanup:
- [x] switch to the already-exported public subpath from `@onequery/server/services/crypto/credential-encryption`

This one should be easy because the server package already exports that service.

#### `packages/cli-server/src/transport/handlers/cliSourceConnect.ts`

Current issue:
- imports server internals through `server/src`

Cleanup:
- [x] decide whether these are intentionally shared server surfaces
- [x] if yes, export them from `@onequery/server/...`
- [x] if no, move them into a more neutral shared package (for example contracts/schemas or connector-domain code)

Suggested ownership split:
- `CreateDataSourceSchema` probably belongs on an explicit shared contract/schema surface
- `ensureConnectorOrganization` may belong on a shared connector domain/service surface if CLI and server both depend on it

#### `apps/cli/scripts/build-npm-package.js`

Current issue:
- imports PGlite packaging constants through `packages/db/src/pglite.ts`

Cleanup:
- [x] export the required packaging constants from `@onequery/db`
- [x] or move those constants into CLI packaging code if they are packaging-only concerns

### Done when

- cross-package imports no longer depend on another package’s private folder layout
- the repo has one mechanical guard that prevents these leaks from returning

Status:
- [x] Complete. The remaining production callers now use public package exports, and a repo-wide boundary check blocks new cross-package `src/*` leaks.

---

## Cleanup 3 — rewrite the packaged-server smoke setup to use supported knobs only

### Context

`apps/cli/scripts/smoke-packaged-server.js` still sets a group of env vars that do not appear to have readers in the current repo source:

- `BETTER_AUTH_SECRET`
- `MASTER_ENCRYPTION_KEY`
- `ONEQUERY_PUBLIC_ORIGIN`
- `ONEQUERY_SELF_HOST_CONFIG_DIR`
- `ONEQUERY_SELF_HOST_DATA_DIR`
- `HOST`
- `PORT`

From the current CLI/runtime code, the supported path/root override appears to be `ONEQUERY_HOME` plus the existing runtime-root packaging envs, not that older env surface.

### Goal

Make the smoke test configure the packaged runtime **the same way real runtime startup now works**.

### Checklist

- [x] confirm the supported current override surface for packaged CLI/runtime startup
- [x] stop setting env vars that are no longer read by the current implementation
- [x] use one supported root override only (likely `ONEQUERY_HOME`, or platform/XDG overrides if preferred)
- [x] materialize actual self-host config/secrets files where the runtime expects them
- [x] keep only packaging/runtime env vars that the launcher actually reads (`ONEQUERY_NPM_ROOT`, `ONEQUERY_RUNTIME_ROOT`, `ONEQUERY_PGLITE_ASSET_DIR`, etc.)
- [x] add one assertion or comment explaining why each remaining env var is necessary

### Recommendation

The smoke path should look like a real packaged install, not like a leftover env-override harness.
That means:

- create a temp home/root
- write the real self-host files there
- launch the packaged CLI normally
- verify the runtime comes up

### Done when

- every env var in the smoke script has an actual reader in the current runtime path
- the smoke test no longer depends on historical config knobs that are not part of the current design

Status:
- [x] Complete. The packaged smoke harness now writes real `self-host` config/secrets files under `ONEQUERY_HOME` and leaves packaged runtime env ownership to the launcher.

---

## Cleanup 4 — decide how strict you want to be about the remaining launch-contract duplication

### Context

The current launch-contract setup is much better than before, but not mathematically zero-duplication:

- TS owns the strict validator/schema in `packages/config/src/server-launch.ts`
- Rust has its own launch structs in `apps/cli/crates/onequery-cli/src/config/self_host.rs`
- both are kept aligned with a shared JSON fixture and parity tests

This is acceptable engineering.
But if the goal is literally “no duplication at all,” then this is the last substantial conceptual duplicate.

### Recommendation

Treat this as **optional** unless you specifically want the highest possible bar.

### Two valid end states

#### Option A — accept current TS-owner + Rust-parity model

- [x] document clearly that TS schema is the canonical launch-contract owner
- [x] keep the Rust parity test mandatory
- [x] stop treating this as an open design question

#### Option B — move to one neutral contract artifact

- [ ] define one neutral launch-contract artifact (for example JSON Schema)
- [ ] derive/check both TS and Rust against it
- [ ] remove hand-maintained field duplication over time

### Recommendation

Prefer **Option A** unless the duplication is causing real churn.
The current fixture + parity approach is already strong enough for most teams.

### Done when

- the repo has one explicit final answer to “what owns the launch contract?”

Status:
- [x] Complete. The repo now explicitly treats `packages/config/src/server-launch.ts` as the canonical launch-contract owner, with Rust maintaining parity against the shared fixture.

---

## Cleanup 5 — optional small test-value dedupe pass

This is low priority.
Do it only after Cleanups 1–3.

### Context

There are still a few duplicated test constants, for example:

- `packages/config/src/testing.ts` exports `SAMPLE_MASTER_ENCRYPTION_KEY`
- `packages/server/src/routes/test-env.ts` repeats the same base64 key as `TEST_SERVER_MASTER_ENCRYPTION_KEY`
- a few test-only URLs and DB strings also appear in more than one package

This is not architecture-breaking, but it is still duplication.

### Checklist

- [ ] decide whether a shared test constant surface is actually worth it
- [ ] if yes, move only the genuinely shared test fixtures/constants to one test-helper location
- [ ] if no, leave them local and stop here

### Recommendation

Keep this optional.
Do not over-centralize test literals if it makes package ownership worse.

---

## Recommended order

1. Cleanup 1 — resolve `@onequery/config` dist-vs-source redundancy
2. Cleanup 2 — remove remaining private `src/*` package-boundary leaks
3. Cleanup 3 — rewrite packaged smoke startup to use supported knobs only
4. Cleanup 4 — decide the final launch-contract duplication policy
5. Cleanup 5 — optional tiny test-value dedupe

---

## Acceptance gate

You can call this “fully done” when all of the following are true:

- [ ] `@onequery/config` has one real package/runtime surface and no unused artifact path
- [ ] no cross-package production code imports another package’s private `src/*`
- [ ] the packaged smoke path uses only supported runtime knobs
- [ ] the repo has one explicit final answer for launch-contract ownership
- [ ] any remaining duplication is consciously accepted and documented, not accidental

At that point, the repo is not just architecturally good; it is also cleaned up enough to reasonably answer “yes” to the question of whether the remaining redundancy is gone or deliberately bounded.

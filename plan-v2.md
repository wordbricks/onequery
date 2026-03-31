# OneQuery config rewrite plan v2

This document is the **continuation** of `plan.md`, not a replacement for it.

Use `plan.md` for the **big architectural rewrite** and the target mental model.
Use this file for the **cleanup and hardening pass** required to move the repo from:

- “the right architecture landed”

to:

- “strict, fail-closed, no-duplicate, Jane Street-level SSoT”.

---

## Where this starts

This v2 plan assumes the major design from `plan.md` is already in place or mostly in place:

- `workspace-dev` is a first-class profile used by `bun dev`
- `self-host` is a first-class profile used by `onequery serve`
- local dev intentionally separates **browser port** and **API port**
- self-host is **Rust-owned**
- Bun startup consumes a **resolved launch contract**
- `packages/server` consumes a **typed runtime object**, not an env-shaped bag

That means **v2 is not another redesign**.
It is a finishing pass that removes the remaining places where the same fact still exists more than once, or where the boundary is still too soft.

---

## What is already correct and should not be reopened

Do **not** use v2 as an excuse to revisit settled architecture decisions.

Keep these decisions fixed:

- `workspace-dev` and `self-host` stay as separate profiles
- `bun dev` keeps separate browser/API ports
- `onequery serve` keeps one bundled public server topology
- self-host authored config stays **Rust-owned**
- workspace-dev authored config stays **TS-owned**
- Bun does **not** parse self-host TOML itself
- `packages/server` continues to start from typed config/runtime services
- env variables stay as **edge projections**, not the canonical model
- no compatibility layer for the old `onequery.local.env.toml` world

If a proposed change weakens any of the above, it is moving backward.

---

## Why v2 still exists

After the initial rewrite, the architecture can still be “good” without being full SSoT.
The usual remaining problems are:

1. the same defaults still exist in both code and authored files
2. config vs secrets separation exists only by convention, not by enforcement
3. parsing is not fully fail-closed on unknown or misplaced keys
4. the launch contract still has more than one real definition
5. old env-era files, scripts, docs, and literals still exist in the repo surface
6. executable files like `docker-compose.yml` still carry their own defaults
7. docs or UX text still mention old ports or old concepts

This document is only about removing those residual issues.

---

## What “Jane Street-level SSoT” means here

For this repo, call it done only when all of the following are true:

- every authored fact has **one owner**
- every consumer receives **derived config**, not its own duplicated defaults
- invalid config fails **loudly and immediately**
- secrets and non-secrets are separated **structurally**, not socially
- runtime startup uses **one launch contract** and request handling does not re-parse startup config
- no legacy config surface remains available to accidentally become a second source of truth

A useful test is:

> If you change one port, one origin, one secret location, or one runtime path, there should be one clear place to change it, and the rest of the system should only consume the derivation.

---

## Delta diagram: current good v1 vs target v2

```text
                     AFTER plan.md (good v1)

 authored dev file ──┐
                     ├─ TS resolver ──┬─ Vite
 code defaults ──────┘                ├─ Docker
                                      └─ dev launch config

 authored self-host files ── Rust resolver ── self-host launch config

 TS launch types ───────┐
                        ├─ Bun validator
 Rust launch structs ───┘

 old env files / scripts / docs still partly present


                     AFTER plan-v2 (strict SSoT)

 one authored dev file  ── TS resolver ── projections only
 one authored secrets file ─┘

 one authored self-host config ── Rust resolver ── one launch contract
 one authored self-host secrets ─┘

 one launch-contract definition / schema ── producer + consumer validation

 no old env surface
 no duplicate executable defaults
 no silent acceptance of typos / misplaced keys
```

---

## Non-goals for v2

Do **not** spend v2 time on these unless they are directly required for the cleanup:

- changing the chosen port numbers again
- adding backward compatibility for old files or old env keys
- introducing a third profile
- adding more runtime flags “just in case”
- widening config shapes to support hypothetical future uses
- building a general-purpose config framework for the whole company

This is a **tightening** pass, not a feature expansion.

---

## Phase 11 — make authored workspace-dev defaults have exactly one owner

### Problem

It is common after v1 to still have the same `workspace-dev` defaults in two places:

- the tracked authored file, such as `onequery.dev.toml`
- TS fallback literals inside `packages/config/src/workspace-dev.ts`

That is still duplicate truth.

### Goal

A `workspace-dev` default should exist in **one place only**.
For repo-local dev, that place should be the authored file committed in the repo, not duplicate literals in resolver code.

### Checklist

- [x] Pick the single owner for `workspace-dev` defaults. Recommended owner: tracked `onequery.dev.toml`.
- [x] Remove duplicated default objects from the resolver implementation, e.g. `workspaceDevDefaults` or equivalent.
- [x] Keep resolver code responsible only for:
  - loading files
  - validating shape
  - deriving computed values
  - projecting to consumers
- [x] Do not let the resolver silently invent missing non-secret values that are already supposed to be present in the tracked dev config.
- [x] Keep secret seeding behavior separate from non-secret defaults.
- [x] Add tests proving that changing the tracked dev file changes all projections without any code change.

### Done when

- the tracked dev config file is the only owner of browser/API/Postgres/flags defaults for `workspace-dev`
- resolver code contains no second copy of those values

### Smells

- a resolver constant repeats the same ports already present in `onequery.dev.toml`
- changing the tracked dev file has no effect because code defaults override it

---

## Phase 12 — make config vs secrets separation real, not social

### Problem

It is not enough to have both `workspaceDevConfigSchema` and `workspaceDevSecretsSchema` if both files are merged first and only validated as one combined object.
In that model:

- secrets can be placed in the config file
- config can be placed in the secrets file
- the loader still accepts it

That is not a hard boundary.

### Goal

Each authored file must be parsed and validated **independently** against its own strict schema.
Only after both succeed should they be combined into one resolved `workspace-dev` object.

### Checklist

- [x] Parse `onequery.dev.toml` with a **config-only** schema.
- [x] Parse `onequery.dev.secrets.toml` with a **secrets-only** schema.
- [x] Combine the validated results only after both succeed.
- [x] Make both schemas strict / fail-closed in TS.
- [x] Add tests that explicitly fail when:
  - [x] a secret key appears in the config file
  - [x] a config key appears in the secrets file
  - [x] an unknown key appears in either file
  - [x] a misspelled nested key appears in either file
- [x] Keep the same rule on the Rust side for self-host files:
  - [x] config TOML parsed with config structs only
  - [x] secrets TOML parsed with secrets structs only
  - [x] `deny_unknown_fields` (or equivalent) added to top-level and nested structs

### Recommended implementation notes

In TS, prefer strict object schemas at every authored boundary.
In Rust, add `serde(deny_unknown_fields)` to both top-level and nested authored config structs.

Do not rely on “contributors know which file to edit”. The loader should enforce it.

### Done when

- putting a secret into a non-secret file fails immediately
- putting a config key into a secrets file fails immediately
- typoed keys cannot be silently ignored

---

## Phase 13 — remove the old env-era surface completely

### Problem

Even if the runtime no longer uses the old model, leaving the old files/scripts/docs in the repo still advertises a second mental model.
That invites drift to come back.

Typical leftovers include:

- `onequery.local.env.toml`
- `onequery.local.env.toml.template`
- `packages/dev-config`
- `env:sync`
- topology drift-check scripts
- `WEB_URL` / `BETTER_AUTH_URL` references in docs and comments
- `turbo.json` `globalEnv` entries for old keys

### Goal

Remove the old surface so there is no plausible way for contributors to think the old env-shaped model is still supported.

### Checklist

- [ ] Delete `onequery.local.env.toml` from the repo surface.
- [ ] Delete `onequery.local.env.toml.template`.
- [ ] Delete `packages/dev-config` after all imports are gone.
- [ ] Delete `scripts/sync-local-env.ts`.
- [ ] Delete drift-check scripts such as `check-dev-topology` / `dev-topology-check` if any remain.
- [ ] Remove `env:sync` and other obsolete scripts from root `package.json`.
- [ ] Remove stale `WEB_URL` / `BETTER_AUTH_URL` from `turbo.json` `globalEnv` if they no longer belong there.
- [ ] Remove old compatibility comments in Vite/dev tooling that still describe the repo in terms of managed `WEB_URL`.
- [ ] Rewrite docs that still explain the old env workflow.
- [ ] Search for old filenames and delete or rewrite every remaining reference.

### Done when

The following search should return nothing useful except migration history:

```sh
rg -n 'onequery\.local\.env\.toml|onequery\.local\.env\.toml\.template|env:sync|dev-topology|WEB_URL|BETTER_AUTH_URL' .
```

### Smells

- a contributor can still find an old template file and think it is the editable source of truth
- CI/task runners still treat old env keys as first-class global inputs

---

## Phase 14 — remove duplicated executable defaults outside the config layer

### Problem

Even after resolver cleanup, duplicate truth often survives in executable files and user-facing copy:

- `docker-compose.yml` has fallback literals for ports or credentials
- docs still mention an old default URL or port
- landing pages / onboarding strings mention a stale port
- CLI copy hardcodes a base URL separately from the real self-host default helper

This is still SSoT drift, just outside the main config package.

### Goal

Anything executable or user-facing should either:

- consume a derived value from the real config owner, or
- be generated from one owner, or
- be updated so it does not duplicate the value at all

### Checklist

- [ ] Remove fallback literals from `docker-compose.yml` that duplicate `workspace-dev` defaults.
- [ ] Feed Docker from one derived projection path only.
- [ ] Audit onboarding/docs/landing/README copy for stale port numbers or old commands.
- [ ] Update any stale references such as `4545` if the real self-host default is now something else.
- [ ] Remove separately hardcoded CLI base URL strings and derive them from the same self-host default helper.
- [ ] Check smoke tests and snapshots for copied literals that should come from config helpers.
- [ ] Audit comments, README examples, and shell snippets for outdated URLs.

### Recommended approach

For Docker, either:

- inject an env/projection file from the TS resolver at compose invocation time, or
- generate a small derived compose input file from the resolver

Do **not** keep meaningful defaults duplicated inside `docker-compose.yml` itself.

### Done when

- changing the chosen default port in its real owner automatically updates all executable consumers, or at least all consumers derive from the same helper
- no stale user-facing copy points to the wrong port

### Smells

- `docker-compose.yml` has `:-5454` style defaults that also exist in `onequery.dev.toml`
- docs say one port while the launcher uses another

---

## Phase 15 — collapse the launch contract to one real definition

### Problem

It is better to have a launch contract than ad-hoc env parsing, but it still is not full SSoT if the same contract is hand-maintained in multiple places, for example:

- TS interface/type in `packages/config`
- Bun validator schema in `packages/bun-server`
- Rust `ServerLaunchConfig` struct in the CLI

That is contract duplication.

### Goal

The launch contract should have **one canonical definition**.
All producers and consumers should validate against that same definition rather than keeping manually mirrored copies.

### Preferred target

Adopt one neutral contract artifact for the launch shape, for example a schema owned in one place and consumed from both sides.

Examples of acceptable end states:

1. **Preferred:** one neutral schema artifact (for example JSON Schema) with:
   - Rust producer conformance tests
   - TS/Bun runtime validation generated or derived from the same schema

2. **Acceptable if kept simple:** one TS-owned schema in `packages/config` used directly by Bun, plus strong Rust conformance tests against golden JSON fixtures emitted by the CLI.

The key rule is:

- there must be **one canonical contract definition**, not three hand-edited ones

### Checklist

- [ ] Choose the canonical owner for the launch contract definition.
- [ ] Move Bun validation to consume that owner directly.
- [ ] Remove duplicate launch-shape declarations that no longer need to exist.
- [ ] Add round-trip tests proving the Rust-emitted launch JSON validates against the canonical contract.
- [ ] Add fixture tests for malformed launch files:
  - [ ] unknown key
  - [ ] missing required key
  - [ ] invalid discriminated union member
  - [ ] wrong scalar type
- [ ] Keep launch config validation only at startup/load boundaries, not during request handling.

### Important note

Do **not** turn this into an overly abstract codegen project if it makes the repo harder to operate.
The winning solution is the one that gives one real contract definition with the least operational complexity.

### Done when

- you can point to one file/artifact and say “this is the launch contract”
- Bun startup validation and Rust producer tests both rely on that same source

---

## Phase 16 — add the negative tests that prove the architecture is actually hard

### Problem

Positive-path tests are not enough. A config architecture only proves itself when the bad cases fail in the right place.

### Goal

Add the tests that make the remaining regressions impossible to reintroduce quietly.

### Checklist

#### Workspace-dev authored file tests
- [ ] unknown key in `onequery.dev.toml` fails
- [ ] unknown key in `onequery.dev.secrets.toml` fails
- [ ] secret key in config file fails
- [ ] config key in secrets file fails
- [ ] missing required non-secret key fails if the tracked dev file is incomplete
- [ ] changing browser/API ports changes all derived projections

#### Self-host authored file tests
- [ ] unknown key in `config.toml` fails
- [ ] unknown key in `secrets.toml` fails
- [ ] secret key in `config.toml` fails
- [ ] config key in `secrets.toml` fails
- [ ] self-host startup does not read repo-local dev files

#### Launch contract tests
- [ ] malformed `launch.json` fails at startup
- [ ] extra key in `launch.json` fails if contract is strict
- [ ] runtime path omissions fail when required for self-host
- [ ] valid Rust-emitted launch JSON passes consumer validation

#### Regression / surface tests
- [ ] root/local docs do not mention old env files
- [ ] smoke/onboarding examples use the actual chosen self-host default
- [ ] no request-path code parses startup config again

### Done when

The architecture is protected by negative tests, not just by reviewer memory.

---

## Phase 17 — final acceptance gate before calling it “done”

Run these checks only after the earlier phases are complete.

### Ownership checks

- [ ] For each of the following concepts, identify one owner and verify no second authored owner exists:
  - [ ] workspace browser port
  - [ ] workspace API port
  - [ ] workspace Postgres host/container ports
  - [ ] self-host default public/listen port
  - [ ] auth secret location
  - [ ] crypto master key location
  - [ ] runtime paths for self-host
  - [ ] launch contract definition

### Search-based checks

- [ ] `rg -n 'onequery\.local\.env\.toml|onequery\.local\.env\.toml\.template|env:sync|dev-topology' .` returns nothing useful.
- [ ] `rg -n 'WEB_URL|BETTER_AUTH_URL' packages apps scripts docs` returns only deliberate edge-adapter history or nothing.
- [ ] `rg -n 'process\.env\.' packages/server packages/bun-server` shows only startup-boundary reads, not app/runtime logic.
- [ ] `rg -n '4545' apps packages docs scripts` returns nothing unless `4545` is still intentionally the chosen current default.
- [ ] `rg -n '5656|8080|3000|3001|5454|5432' apps packages docs scripts` shows one clear owner per concept and only derived consumers elsewhere.

### Behavior checks

- [ ] `bun dev` still runs with separate browser/API ports.
- [ ] `onequery serve` still runs from self-host launch config only.
- [ ] self-host startup still succeeds with repo-local dev files absent.
- [ ] changing a tracked workspace-dev value changes Vite/Docker/Drizzle behavior without touching code.
- [ ] changing a self-host default helper changes CLI/user-facing output without hunting literals across the repo.

### Human-review check

Ask one blunt question before declaring success:

> Can a new contributor find two different places that both appear to own the same config fact?

- [ ] If yes, v2 is not done.
- [ ] If no, the architecture is likely in the right place.

---

## Recommended commit order

Use small green commits. Recommended order:

1. Phase 11 — remove duplicated workspace-dev defaults
2. Phase 12 — strict config/secrets boundaries and fail-closed parsing
3. Phase 13 — delete old env-era files/scripts/docs surface
4. Phase 14 — remove duplicated executable/user-facing defaults
5. Phase 15 — collapse launch contract definition
6. Phase 16 — add negative tests
7. Phase 17 — run acceptance gate and clean any remaining stragglers

---

## Red flags that mean v2 went off track

Stop and correct course if any of these happen:

- a new compatibility adapter is introduced for the deleted env model
- resolver code starts reintroducing fallback defaults already owned by authored files
- config/secrets schemas become looser “for convenience”
- Docker or docs become the place contributors actually change ports first
- the launch contract gains two owners again because codegen was skipped halfway
- request middleware starts validating startup config again
- tests only verify happy paths and not the negative cases

---

## End state summary

When this file is complete, the repo should have this property:

```text
one fact -> one owner -> one strict parser -> one resolved value -> many derived consumers
```

And it should **not** have this property:

```text
one fact -> file default + code default + docs literal + compose fallback + test copy
```

That is the bar for calling the config architecture truly SSoT.

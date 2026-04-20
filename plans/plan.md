# Audit V2 Architecture Plan

Audit V2 treats audit as workflow infrastructure, not log decoration. The design target is precise enough that independent implementations converge on the same write-side truth and the same read-side behavior.

## Companion Documents

This file is the entry point for the Audit V2 plan set. The companion documents in this directory define the detailed contracts:

- [shared-kernel.md](./shared-kernel.md) defines the workflow contract shared by every family: commands, decisions, reducers, rejects, effects, and lifecycle axes.
- [storage-contract.md](./storage-contract.md) defines durable write-side behavior: idempotency, append rules, folding, outbox emission, replay, and recovery.
- [query-family.md](./query-family.md) defines the `query_action` state machine.
- [source-api-family.md](./source-api-family.md) defines the `source_api_action` state machine.
- [projection-and-api.md](./projection-and-api.md) defines the rebuildable read model and the public feed contract.
- [spec.md](./spec.md) summarizes directory-level document ownership and precedence.

## Target Properties

- write-side truth is explicit workflow state, not observer logging
- failure, retry, resume, and rejection appear as documented lifecycle transitions
- the unified feed is rebuildable from committed events and stable while actions continue to evolve
- projector lag is surfaced at the API boundary instead of hidden

Failure, retry, resume, and rejection are normal lifecycle transitions. Nothing important is allowed to hide behind exceptions, callbacks, or observer side channels.

## Baseline

This repository already contains an Audit V1 path for CLI query actions:

- write-side schema in `packages/db/src/schema/cli-query-action-schema.ts`
- command-side logging in `packages/cli-server/src/query/logging.ts`
- query workflow in `packages/cli-server/src/query/workflow.ts`
- contracts in `packages/contracts/src/audit.ts`
- feed endpoint in `packages/server/src/routes/organizations.ts`

Audit V2 is therefore a replacement plan for an existing in-repo implementation, not a greenfield design.

> Comment: the current `/organizations/:slug/audit` endpoint orders by `lastEventAt`. That is reasonable for a mutable aggregate row, but it is the wrong order for a stable one-row-per-action feed.

## Non-negotiable Decisions

- The authoritative write-side truth is the per-family event log.
- The folded action row is a transactional cache of `reduce`, maintained for write-path state access and optimistic concurrency.
- The folded action row stores only decision-carrying state and concurrency anchors. Audit-facing summaries belong in projections.
- Command idempotency is durable. The system must answer "have we already decided this command?" without re-running `decide`.
- Effects are emitted only through a transactional outbox. "Commit, then best-effort callback" is not allowed.
- `surface` is attribution and routing metadata. It is orthogonal to `family`.
- The unified feed is one row per action, not one row per event.
- Feed ordering is by immutable action start time, not mutable last activity time.
- Event ordering is required per family. Audit V2 does not define a cross-family global commit position.
- Lifecycle legality belongs in reducers and transition tests. Database constraints enforce structure, not the transition matrix.
- Audit V2 does not mix V1 and V2 storage at runtime.

## Scope

Included:

- one shared workflow kernel with pure `decide` and `reduce`
- family-owned write models for `query_action` and `source_api_action`
- explicit retry and resume transitions where the family requires them
- one rebuildable unified audit feed
- public API semantics that surface projector lag explicitly

Excluded:

- one generic event schema shared by all families
- reducer-side I/O
- exception-shaped retry or resume control flow
- runtime fan-in across V1 and V2 stores
- raw payload retention in the main audit store

## Replacement Discipline

The shipped system serves exactly one semantic model: Audit V2.

- There is no runtime compatibility layer, no dual-read stage, and no rollover stage.
- Historical backfill and retention planning are out of scope for this plan.
- Existing V1 code may be used only as an implementation reference while porting behavior.
- Once the V2 path is wired, superseded V1 schema, logging, and read-path dependencies should be deleted from production code.

Temporary implementation sequencing does not change the target architecture.

## Delivery Sequence

- [x] Land the shared kernel contract.
  Exit criteria:
  - every family implements the same `decide` and `reduce` shape
  - generic rejection handling and illegal-transition tests exist
- [x] Land the storage contract.
  Exit criteria:
  - command journaling, event append, fold update, and outbox emission are atomic
  - every family event table has a strict per-family `commit_position`
- [x] Port `query_action`.
  Exit criteria:
  - every query lifecycle outcome is represented as commands and events
  - V1-style observer logging is removed from the workflow path
- [ ] Land `source_api_action`.
  Exit criteria:
  - describe, preview-only invoke, execute, resume, and terminal failure are explicit transitions
  - continuation identity is bound to the audited action and resume point
- [ ] Build the unified projection and public API.
  Exit criteria:
  - the feed rebuilds from committed events
  - cursor pagination remains stable while actions continue to evolve
- [ ] Remove superseded V1 paths.
  Exit criteria:
  - the public API and UI read only V2 projection rows
  - superseded V1 schema, logging, and read-path dependencies are deleted from production code

## Definition Of Done

Audit V2 is done only when all of the following are true:

- every family has an explicit command algebra, event algebra, and rejection algebra
- reducers are the only place lifecycle legality is encoded
- rejected commands are durably recorded without fabricating events
- write-side effects are durable through outbox rows
- the read side can be truncated and rebuilt without loss of meaning
- the public API is defined only in terms of V2 projection rows
- transition tests prove the documented state machines rather than a few happy paths

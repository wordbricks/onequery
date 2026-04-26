# CLI / CLI Server Architecture Follow-Up Plan

Use this checklist to track progress toward a more Jane-Street-ish architecture for
`packages/cli-server` and `apps/cli`.

## Large Workflow Modules

- [x] Split `packages/cli-server/src/audit/storage.ts` into smaller modules by invariant boundary.
  - Suggested boundaries: command storage, replay/folding, effect dispatch storage, transaction commit helpers, corruption handling.
- [x] Split `packages/cli-server/src/audit/source-api-action-family.ts` into focused modules.
  - Suggested boundaries: schemas, commands/events, decision logic, reducer, projections.
- [x] Split `packages/cli-server/src/audit/query-action-family.ts` into focused modules.
  - Suggested boundaries: schemas, commands/events, decision logic, reducer, projections.
- [x] Split `apps/cli/crates/onequery-cli/src/commands/source_api/workflow.rs` into smaller Rust modules.
  - Suggested boundaries: state, reducer, effects, retry policy, rendering/execution orchestration.
- [x] Split `apps/cli/crates/onequery-cli/src/commands/gateway/runtime.rs` into smaller Rust modules.
  - Suggested boundaries: runtime state, process supervision, transport setup, shutdown handling.
- [x] Re-check module sizes after the split and keep new modules locally auditable.

## Workflow Effect Dispatch Consistency

- [x] Add a regression test for the crash window between storing an effect result command and completing the workflow effect dispatch row.
- [x] Decide whether completion should be reconciled on replay or made atomic with result-command storage.
- [x] Implement the chosen consistency fix in `packages/cli-server/src/connect/service/workflow-effect-dispatch.ts` and related storage code.
- [x] Verify pending/leased/completed effect states remain consistent after retries and replay.

## Impossible States And Runtime Invariants

- [x] Replace `unreachable!()` paths in Rust workflow effect executors with narrower effect enums or typed conversion boundaries.
- [x] Review generated-enum conversion paths and ensure `UNSPECIFIED`/unknown values are rejected at the boundary before reaching reducers/renderers.
- [x] Replace generic internal `throw new Error(...)` workflow invariant failures with typed corruption/internal-invariant results where practical.
- [x] Keep genuine corruption paths distinct from normal domain failures in presentation and telemetry.

## TypeScript Workflow Schema Boundaries

- [ ] Reduce drift risk between Zod schemas and TypeScript workflow union types.
- [ ] Prefer schema-derived types or colocated constructors where they reduce duplication without hiding invariants.
- [ ] Keep reducers consuming already-validated workflow commands/events.
- [ ] Add focused tests around schema parsing for persisted workflow payloads when modules are split.

## Sensitive Data Boundaries

- [ ] Review where encrypted credential fields flow through CLI server domain types.
- [ ] Confirm encrypted credentials never enter audit descriptors, request logs, debug logs, or user-visible errors.
- [ ] Add tests or type boundaries if credential-bearing records are too easy to pass into persisted audit paths.

## Repository Hygiene

- [x] Confirm local `.DS_Store` files under `packages/cli-server` and `apps/cli` are ignored.
- [x] Remove local `.DS_Store` files if they are not needed.

## Keep As-Is Unless New Evidence Appears

- [ ] Keep the current Connect/protobuf/Hono architecture.
- [ ] Keep protocol support explicit in the Connect Node adapter.
- [ ] Keep protobuf validation and idempotency annotations as the canonical API boundary.
- [ ] Keep the Rust transport client's authenticated/unauthenticated type-state model.
- [ ] Keep the reducer/effect workflow runner pattern in the CLI.

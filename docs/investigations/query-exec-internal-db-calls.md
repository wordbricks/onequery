# Investigation: `onequery query exec` internal DB calls

Date: 2026-05-04

Scope: `apps/cli`, `packages/self-host-runtime`, `proto`, and
`packages/cli-server`. This note counts calls/statements against OneQuery's
internal storage DB. It does not count the external source database query.

## Summary

Reducing a single `onequery query exec` response path to fewer than 10 internal
DB calls is a good direction, but only if the goal is "less request-path storage
chatter" rather than "less audit fidelity".

Implementation status:

- Step 1 is done: `ExecuteQuery` no longer awaits the global audit feed
  projection before returning the CLI response.
- Step 3 is done for `query_action`: `pending_workflow_effects` now tracks only
  recoverable `persist_usage` effects, while inline preparation/execution
  effects remain journal-only.

The biggest original request-path issue was not the Rust CLI or the self-host
runtime wrapper. It was the server-side audit path:

1. `ExecuteQuery` writes several durable `query_action` journal commits.
2. Each commit also updates read/projection tables.
3. `handleExecuteQuery` then awaited a global audit feed projection sync before
   returning the CLI response. This is done and no longer happens.

The first move removed the synchronous audit feed projection from
`handleExecuteQuery`. That preserves the durable journal and should remove
roughly 12-22 DB calls from the response path on a common successful query.

To reliably get the whole response path below 10 calls, deferring feed projection
is not enough if we count every internal SQL statement plus transaction
round-trip. The next cuts should be:

- stop writing `pending_workflow_effects` rows for inline effects that no worker
  actually recovers, and keep it for truly async/recoverable work only;
- collapse the fresh happy path from multiple audit command transactions into a
  smaller number of commits, while preserving at least a durable "received"
  record before external SQL execution.

## Call Flow

### CLI

`onequery query exec` is `QuerySubcommand::Execute`. The command is defined in
`apps/cli/crates/onequery-cli/src/cli/args.rs:345` and dispatched through
`apps/cli/crates/onequery-cli/src/commands/mod.rs:247`.

The query workflow runs in
`apps/cli/crates/onequery-cli/src/commands/query/execute.rs:49`:

- load SQL or JSON input;
- ensure local auth and selected org;
- call `execute_read_only_query_with_controls`;
- retry only on retryable API failures, up to
  `QUERY_MAX_ATTEMPTS = 3` in
  `apps/cli/crates/onequery-cli/src/commands/query/mod.rs:37`.

There is no query polling loop. Retries issue another full `ExecuteQuery` RPC.
If no stable `--request-id` is supplied, retries are likely new server request
IDs, so journal idempotency does not collapse them.

The Rust transport calls `CliQueryService.ExecuteQuery` in
`apps/cli/crates/onequery-cli/src/transport/query.rs:127`.

### Proto

The public CLI RPC is:

- `CliQueryService.ExecuteQuery` in `proto/onequery/cli/v1/cli.proto:50`;
- `ExecuteQueryRequest` in `proto/onequery/cli/v1/query.proto:39`;
- `ExecuteQueryResponse` in `proto/onequery/cli/v1/query.proto:57`.

The internal durable workflow contract is `query_action` in
`proto/onequery/workflow/v1/query_action.proto:10`. The important effects are:

- `prepare_execute_query`;
- `execute_query`;
- `persist_usage`;

defined in `proto/onequery/workflow/v1/query_action.proto:56`.

### Self-host runtime

`packages/self-host-runtime` mostly wires the path. It prepares storage and
mounts the CLI route; it does not own the audit logic.

Relevant mount points:

- runtime app mounts CLI API in `packages/self-host-runtime/src/app.ts:118`;
- `createCliRoute` bridges Hono to Connect in
  `packages/cli-server/src/connect/hono.ts:20`.

The storage DB is shared with the normal server storage created by the runtime.
The repeated audit calls are therefore visible in self-host mode, but the audit
implementation lives in `packages/cli-server` and
`packages/server/src/audit/feed`.

### CLI server

`ExecuteQuery` is registered in
`packages/cli-server/src/connect/rpc.ts:68` and handled by
`packages/cli-server/src/connect/service/query/execute.ts:25`.

The handler does:

1. resolve session/org/source state;
2. parse read controls;
3. run `runCliQueryExecutionWorkflowResult`;
4. return without waiting for audit feed projection;
5. build the response.

The org+source lookup is already combined in
`packages/cli-server/src/connect/service/query/context.ts:20` and
`packages/cli-server/src/organization/effects.ts:58`. The source lookup is then
seeded into `createQueryWorkflowResourceCache` at
`packages/cli-server/src/connect/service/query/execute.ts:49`, so the happy
path does not repeatedly reload the source row.

## Current Audit Model

The main durable path is:

`storeAcceptedQueryActionCommand` ->
`storeQueryActionCommandViaJournal` ->
`appendWorkflowJournalBatch` ->
`createDbWorkflowJournalStore`.

Key files:

- `packages/cli-server/src/connect/service/query/workflow-runtime.ts:242`
- `packages/cli-server/src/audit/storage/query-action-journal.ts:170`
- `packages/cli-server/src/audit/storage/journal.ts:272`
- `packages/cli-server/src/audit/storage/journal-db.ts:81`

On a successful fresh exec, the workflow stores these audit decisions:

1. `start_execute`: emits `action_received`, schedules
   `prepare_execute_query`.
2. `record_execute_preparation_succeeded`: emits `source_loaded`,
   `query_validated`, `credentials_loaded`, schedules `execute_query`.
3. `record_query_execution_succeeded`: emits `query_executed`, schedules
   `persist_usage`.
4. `record_usage_persistence_succeeded`: emits `usage_persisted`.

The decision points are in:

- `packages/cli-server/src/audit/query-action-family/decision.ts:75`
- `packages/cli-server/src/audit/query-action-family/decision.ts:198`
- `packages/cli-server/src/audit/query-action-family/decision.ts:304`
- `packages/cli-server/src/audit/query-action-family/decision.ts:381`

The integration test documents the happy-path journal shape as 20
`workflow_journal` rows: 4 commands, 6 events, 3 scheduled effects, 3 completed
effects, and 4 checkpoints. See
`packages/cli-server/src/connect/service/query/workflow.integration.test.ts:369`.

Usage persistence is already deferred with `setTimeout(..., 0)` in
`packages/cli-server/src/connect/service/query/workflow-execution.ts:70`. It
updates `data_sources.last_used_at` in
`packages/cli-server/src/query/effects.ts:103`, then records the usage
persistence audit command.

Startup recovery scans only pending `persist_usage` effects:

- `packages/cli-server/src/connect/hono.ts:55`
- `packages/cli-server/src/connect/service/query/workflow-execution.ts:121`

Comment: `pending_workflow_effects` is updated for `prepare_execute_query` and
`execute_query`, but I found recovery code only for `persist_usage`. If no worker
drains the inline effect rows, those schedule/delete writes carry little
operational value on the normal query path.

## Estimated DB Call Shape

These numbers are estimates from code inspection, not measured traces.

Fresh successful exec, warm runtime, no CLI auth refresh:

| Area | Request path? | Approx internal DB statements |
| --- | --- | ---: |
| Resolve org + source access | yes | 1 |
| `start_execute` journal commit | yes | 3 |
| `record_execute_preparation_*` journal commit | yes | 4 |
| `record_query_execution_*` journal commit | yes | 4 |
| Synchronous audit feed projection | yes | 12-13 common path, more with backlog |
| `persist_usage` follow-up | after response | 4 |

If the driver counts transaction begin/commit as calls, add roughly two
round-trips per journal/projection transaction. That makes the common total land
comfortably in the dozens.

The synchronous audit feed projection was the biggest avoidable request-path
block. `handleExecuteQuery` no longer awaits it before building the response.
The removed wrapper called `syncAuditFeedProjection` through
`packages/cli-server/src/connect/service/query/audit-projection.ts`.

`syncAuditFeedProjection` advances both `query_action` and `source_api_action`
families for up to five batches per request:

- constants in `packages/server/src/audit/feed/constants.ts:1`;
- loop in `packages/server/src/audit/feed/projection.ts:649`.

This means one CLI query can pay for unrelated source API audit backlog.

Comment: this is surprising because `ExecuteQueryResponse` does not need the
audit feed row. Audit list/detail routes already call `syncAuditFeedProjection`
before reading:

- `packages/server/src/audit/feed/list.ts:278`
- `packages/server/src/audit/feed/detail.ts:521`

## Recommendation

### Good target

"Fewer than 10 internal DB calls for the user-visible query response" is a good
target. It improves CLI latency, self-host runtime behavior, and pglite/Postgres
load without changing the public RPC contract.

### Bad target

"Fewer than 10 total internal DB calls including durable audit, feed freshness,
usage persistence, and retries" is probably the wrong target unless we are
willing to weaken durability or accept more eventual consistency.

The design should keep:

- a durable audit record before external SQL execution starts;
- deterministic replay/idempotency for request IDs;
- a final durable outcome record;
- best-effort or eventual usage persistence.

## Proposed Plan

### Step 1 (done): remove audit feed sync from the response path

Changed `handleExecuteQuery` so it does not await audit feed projection.

Options:

- remove it and rely on audit list/detail reads to sync;
- schedule a debounced background projector;
- schedule a fire-and-forget sync with clear logging and no response blocking.

Expected impact: remove roughly 12-22 request-path calls in the common path.

Risk: the audit feed is eventually consistent until a background sync or audit
read happens. This should be acceptable if the durable journal remains the source
of truth.

### Step 2: target projection scope if immediate feed freshness is required

If product requirements need an audit feed row immediately after query exec, add
a targeted projection path for the current `query_action` only.

Avoid calling the global projector that advances both workflow families. A
targeted path can use the already-known action/cursor data from the query
workflow and upsert one `audit_feed_entries` row.

### Step 3 (done): stop pending-effect projection for inline effects

`prepare_execute_query` and `execute_query` run inline in the request handler.
The only startup recovery path I found consumes `persist_usage`.

Consider writing `pending_workflow_effects` only for effects that can be picked
up by a recovery worker. That would avoid schedule/delete writes for inline
effects while preserving the journal rows.

This should be lower risk than changing the journal contract, but it needs tests
for crash/replay assumptions.

### Step 4: collapse happy-path audit commits

For a stronger below-10 target, reduce the fresh happy path from four audit
command transactions to two:

1. initial commit: `action_received` before external SQL execution;
2. final commit: preparation result, execution result, and usage result or usage
   scheduling.

This likely needs new internal workflow command shapes in
`proto/onequery/workflow/v1/query_action.proto`, while keeping old command
shapes replayable for existing journal rows.

This is the highest-risk optimization because it changes the durable workflow
shape. It should come after the feed projection and pending-effect cuts.

### Step 5: coalesce `lastUsedAt`

`data_sources.last_used_at` does not need one DB update per successful query on
the response path. Options:

- keep it as deferred best-effort work;
- debounce by `sourceId`;
- include it in the final audit/usage transaction if we decide usage persistence
  should be synchronous.

## Expected End State

A realistic response-path target after Step 1 and Step 3:

- session cache hit: 0 storage reads for auth;
- org + source access: 1 read;
- initial audit commit: about 2-3 statements;
- preparation/execution result commit: about 3-4 statements;
- no synchronous global feed projection.

That lands near 6-9 storage statements, depending on transaction accounting and
the exact journal/projection shape.

If transaction begin/commit are counted as separate calls, the only reliable way
to stay below 10 is to reduce the number of audit transactions as in Step 4.

## Notes For Implementation

- No generated proto/runtime files should be edited manually.
- If Step 4 changes `proto/onequery/workflow/v1/query_action.proto`, regenerate
  the `packages/proto-workflow` output with Buf according to the repo rules.
- Add tests around the expected journal row sequence, idempotent replay, and
  projection freshness. Existing coverage is in
  `packages/cli-server/src/connect/service/query/workflow.integration.test.ts`.
- A measured trace should be added before/after the first change so the call
  count target is based on observed storage statements, not only code reading.

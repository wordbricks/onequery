# Query workflow journal architecture

Goal: reduce `onequery query exec` happy-path DB calls by replacing cross-table workflow bookkeeping with one append-only workflow journal.

Target shape: workflow/audit bookkeeping before the user receives a query result should be three journal appends, plus only the domain reads/writes that are inherently needed to execute the query. Usage persistence finishes as journal-backed asynchronous follow-up work.

## Architecture

The write path appends one ordered journal batch per durable boundary.

```text
workflow_journal entries:
  command
  event
  effect_scheduled
  effect_started
  effect_completed
  effect_failed
  checkpoint
```

The journal is the only correctness source.

```text
state = fold(workflow_journal entries for stream)
```

No other workflow or audit table may be required to decide whether a command already happened, whether an effect may run, whether an effect completed, or what the current workflow state is.

Current workflow/audit tables become derived state.

```text
workflow_commands          -> journal command entries
query_action_events        -> journal event entries
source_api_action_events   -> journal event entries
workflow_effect_dispatches -> journal effect entries or worker index
query_actions              -> projection
source_api_actions         -> projection
audit_feed_entries         -> projection
```

Derived state is replaceable. If it is deleted, stale, or partially rebuilt, workflow execution must still be recoverable from the journal.

Keep useful domain event names such as `action_received`, `source_loaded`, `query_validated`, `credentials_loaded`, and `query_executed`. Drop names and payload shapes that only exist because of the old table layout or runtime bookkeeping model.

## Migration

Prefer a one-shot backfill for historical audit facts only. Old runtime bookkeeping that has no meaning in the journal model should be dropped. Do not add dual-write or a long compatibility path.

```text
1. Create workflow_journal.
2. Backfill old command/event history that maps cleanly to journal entries.
3. Drop old lease/retry/projection/checkpoint state that is only runtime bookkeeping.
4. Recreate projections against the journal.
5. Rebuild projections from the backfilled journal.
6. Drop old audit/workflow tables after validation.
```

Do not preserve data just because it exists. If an old row is not part of the new correctness or audit model, drop it instead of encoding legacy semantics into the journal. The backfill must not become a legacy compatibility layer.

## Append Contract

All workflow persistence goes through one append operation.

```text
append:
  check command idempotency
  check expected stream position
  insert all entries for the durable boundary
  return fresh effect tokens and next state cursor
```

One command may append multiple events and effects. The runner carries the returned state cursor through the hot path instead of reading projections.

Fresh effects returned by append may run directly from that cursor. They do not need a separate `effect_started` entry on the synchronous request path.

`effect_started` is for recovery and asynchronous workers. It records a claim when the executor did not receive the effect directly from the append that scheduled it.

## Query Execute Flow

The user-visible success path uses three durable appends.

```text
TX1 Start:
  command start_execute
  event action_received
  effect_scheduled prepare_execute_query
  checkpoint preparing

Run prepare_execute_query:
  load source
  validate query
  load credentials

TX2 Prepared:
  command record_execute_preparation
  event source_loaded
  event query_validated
  event credentials_loaded
  effect_completed prepare_execute_query
  effect_scheduled execute_query
  checkpoint executing

Run execute_query:
  external SQL execution

TX3 Executed:
  command record_query_execution
  effect_completed execute_query
  event query_executed | query_unavailable | query_timed_out | query_execution_failed
  effect_scheduled persist_usage, only on success
  checkpoint terminal query success or terminal failure

Return query result to the user after TX3.

Run persist_usage asynchronously, only on success.

TX4 Usage follow-up:
  command record_usage_persistence
  effect_completed persist_usage
  event usage_persisted | usage_persist_failed
```

Preparation failure commits one terminal batch.

```text
TX2 Preparation failed:
  command record_execute_preparation
  effect_completed prepare_execute_query
  terminal failure event
  checkpoint terminal failure
```

Critical invariant:

```text
external SQL execution requires a durable execute_query effect_scheduled entry.
the synchronous runner may execute only effects returned by its own successful append.
recovered or asynchronous execution must claim the effect with effect_started first.
```

## Composite Effects

Use composite effects for internal preparation. Do not make source lookup, validation, or credential loading separate durable effects.

```text
prepare_execute_query:
  source lookup
  query interface check
  query validation
  credentials load

prepare_validate_query:
  source lookup
  query interface check
  query validation
```

Composite effects append only meaningful audit events: source loaded, query validated, credentials loaded, or terminal failure.

Usage persistence failure is recorded for audit and recovery, but it does not turn a completed query execution into a user-visible query failure or delay the query result response.

## Projections

Projection workers advance by journal commit position.

```text
query_actions:
  latest query action checkpoint

source_api_actions:
  latest source API action checkpoint

audit_feed_entries:
  folded audit summary

pending_effects:
  rebuildable work queue derived from effect_scheduled, effect_started, and effect_completed entries
```

Keep existing projection names where they are still useful API surfaces, but redefine them as pure journal-derived read models. They are no longer correctness tables.

`pending_effects` is a derived work queue, not a correctness source. Workers use it to find work, then claim by appending `effect_started` to the journal. If `pending_effects` is lost, stale, or corrupted, it is rebuilt from the journal.

Query execution does not sync projections on the request path. Audit/feed APIs may read stale projected state with lag metadata, run bounded sync, or rely on a background projector.

## Recovery

Recovered execution uses journal state.

```text
1. Find candidate effects from pending_effects.
2. Rebuild state from the latest checkpoint plus journal tail.
3. Skip effects that already have effect_completed.
4. Claim expired or pending effects by appending effect_started.
5. Execute the effect.
6. Append the result batch.
```

Duplicate commands load the existing journal batch, fold to a cursor, and return the replay result.

Recovery must not depend on old lease, retry, action, or audit tables. Those tables can exist during migration, but the fully migrated system recovers from journal state only.

## Validation Goals

```text
- duplicate commands do not append duplicate entries.
- external SQL cannot run without durable execute_query scheduling.
- query execution completes execute_query, schedules usage persistence, and returns the query result after the third append.
- hot path does not read projection tables for correctness.
- recovered path reaches the same final state as fresh path.
- projections can be dropped and rebuilt from the journal.
- credential values are never stored in journal payloads.
```

## Implementation Progress

- [x] Add workflow journal schema and append/fold/replay core.
- [x] Add DB-backed workflow journal store adapter.
- [x] Update query workflow proto contract for composite preparation effects.
- [x] Move query execution start/preparation/execution commits to journal append batches.
- [x] Replace per-step internal preparation effects with composite preparation effects.
- [x] Move usage persistence behind the user-visible query result.
- [x] Run fresh query effects directly from append-returned journal tokens.
- [x] Replay completed duplicate query effects from journal state.
- [x] Record failed query effects and retry claims in journal state.
- [x] Route query and source-api command storage APIs through journal.
- [x] Run and replay source-api effects from journal state.
- [x] Build journal-derived projections for action state, audit feed, and pending effects.
- [x] Move recovery and duplicate command replay to journal state.
- [x] Remove old workflow/audit tables from the correctness path.

# Query Action Family

`query_action` models one query intent from start to terminal outcome. It is single-pass from a business perspective: once started, it never resumes into later pages or later execution attempts.

## State Model

### Family Fields

- `queryMode`: `validate | execute`
- `sourceDescriptor`: normalized source execution descriptor required by later effects, null until source lookup succeeds
- `queryText`: raw query text carried from the start command
- `validatedQuery`: validated query form required by later effects, null until `query_validated`
- `usageRecordingStatus`: `not_started | succeeded | failed`

There is no separately stored `normalizedSqlChanged` field in folded state. Audit projections derive that flag from the raw and validated query forms when both exist.

### Phases

- `load_source`
- `validate_query`
- `load_credentials`
- `execute_query`
- `persist_usage`
- `completed`

### Failure Codes

- `source_not_found`
- `source_not_queryable`
- `query_rejected`
- `query_preparation_failed`
- `query_unavailable`
- `query_timed_out`
- `query_execution_failed`

### Family Invariants

- `queryMode = validate` never reaches `load_credentials`, `execute_query`, or `persist_usage`.
- `usageRecordingStatus != not_started` only after `usage_persisted` or `usage_persist_failed`.
- `outcome = failed` implies `usageRecordingStatus = not_started`.
- `usageRecordingStatus = failed` implies `outcome = succeeded`.
- `validatedQuery is null` until `query_validated`

`usageRecordingStatus` is intentionally orthogonal to the terminal action outcome. Query execution may succeed while usage persistence ends in `failed`.

## Command Algebra

External commands:

- `start_validate`
- `start_execute`

Internal commands:

- `record_source_lookup`
- `record_query_validation`
- `record_credentials_load`
- `record_query_execution`
- `record_usage_persistence`

## Effect Algebra

- `load_source`
- `validate_query`
- `load_credentials`
- `execute_query`
- `persist_usage`

## Event Algebra

- `action_received`
- `source_loaded`
- `source_not_found`
- `source_not_queryable`
- `query_validated`
- `query_rejected`
- `credentials_loaded`
- `query_preparation_failed`
- `query_executed`
- `query_unavailable`
- `query_timed_out`
- `query_execution_failed`
- `usage_persisted`
- `usage_persist_failed`

## Transition Relation

| Command | Accepted when | Emits | Advances to | Schedules |
| --- | --- | --- | --- | --- |
| `start_validate` | `state = null` | `action_received` | `load_source / pending` | `load_source` |
| `start_execute` | `state = null` | `action_received` | `load_source / pending` | `load_source` |
| `record_source_lookup { kind: "found" }` | `phase = load_source` | `source_loaded` | `validate_query / pending` | `validate_query` |
| `record_source_lookup { kind: "not_found" }` | `phase = load_source` | `source_not_found` | `completed / failed / source_not_found` | none |
| `record_source_lookup { kind: "not_queryable" }` | `phase = load_source` | `source_not_queryable` | `completed / failed / source_not_queryable` | none |
| `record_query_validation { kind: "accepted" }` and `queryMode = validate` | `phase = validate_query` | `query_validated` | `completed / succeeded` | none |
| `record_query_validation { kind: "accepted" }` and `queryMode = execute` | `phase = validate_query` | `query_validated` | `load_credentials / pending` | `load_credentials` |
| `record_query_validation { kind: "rejected" }` | `phase = validate_query` | `query_rejected` | `completed / failed / query_rejected` | none |
| `record_query_validation { kind: "preparation_failed" }` | `phase = validate_query` | `query_preparation_failed` | `completed / failed / query_preparation_failed` | none |
| `record_credentials_load { kind: "loaded" }` | `phase = load_credentials` | `credentials_loaded` | `execute_query / pending` | `execute_query` |
| `record_credentials_load { kind: "preparation_failed" }` | `phase = load_credentials` | `query_preparation_failed` | `completed / failed / query_preparation_failed` | none |
| `record_query_execution { kind: "succeeded" }` | `phase = execute_query` | `query_executed` | `persist_usage / pending` | `persist_usage` |
| `record_query_execution { kind: "unavailable" }` | `phase = execute_query` | `query_unavailable` | `completed / failed / query_unavailable` | none |
| `record_query_execution { kind: "timed_out" }` | `phase = execute_query` | `query_timed_out` | `completed / failed / query_timed_out` | none |
| `record_query_execution { kind: "failed" }` | `phase = execute_query` | `query_execution_failed` | `completed / failed / query_execution_failed` | none |
| `record_usage_persistence { kind: "succeeded" }` | `phase = persist_usage` | `usage_persisted` | `completed / succeeded` with `usageRecordingStatus = succeeded` | none |
| `record_usage_persistence { kind: "failed" }` | `phase = persist_usage` | `usage_persist_failed` | `completed / succeeded` with `usageRecordingStatus = failed` | none |

## Rejections

This family adds no reject codes beyond the shared kernel codes.

The only family-specific rejection rule is that `record_credentials_load`, `record_query_execution`, and `record_usage_persistence` reject with `invalid_phase` when delivered to a `validate` action.

All other rejections are the shared kernel cases.

## Projection-Derived Audit Fields

- `sourceSummary`
- `queryText`
- `validatedQuery`
- `normalizedSqlChanged`, derived from `queryText` and `validatedQuery`
- `rowCount`
- `elapsedMs`
- `retryable`
- `errorDetail`
- `errorHint`

These fields belong in family event payloads and `audit_feed_entries`, not in `<family>_actions` unless a future decision actually depends on them.

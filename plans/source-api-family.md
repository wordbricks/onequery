# Source API Action Family

`source_api_action` models one describe or invoke intent as one action. Later resume commands append to that same action when pagination or retry requires user re-entry.

## State Model

### Family Fields

- `requestKind`: `describe | invoke`
- `invokeMode`: `preview_only | execute | null`
- `sourceDescriptor`: normalized source execution descriptor required by later effects
- `requestDescriptor`: resolved descriptor and operation selection required to prepare or execute requests
- `preparedRequestFingerprint`: stable request identity required to resume execution safely
- `pageProgress`: minimal redacted pagination progress required to schedule the next `execute_page` effect
- `attemptNumber`: `number | null`

Public request and response summaries belong in the read side unless a later decision needs them.

Resume legality does not require a family-specific mirror of the current resume point. When `phase = await_resume`, shared `lastEventId` already identifies the exact page-fetch event a resume token must match.

### Phases

- `load_source`
- `describe_source`
- `prepare_request`
- `execute_request`
- `await_resume`
- `completed`

### Failure Codes

- `source_not_found`
- `descriptor_unavailable`
- `invalid_request`
- `permission_denied`
- `request_failed`
- `request_timed_out`
- `execution_failed`
- `execution_state_invalid`

Rejected resume commands do not mutate the action and therefore do not use `failureCode`.

### Family Invariants

- `requestKind = describe` never reaches `prepare_request`, `execute_request`, or `await_resume`.
- `invokeMode is null` if and only if `requestKind = describe`.
- `phase = await_resume` if and only if shared `lastEventId` identifies the latest committed `page_fetch_succeeded` with `hasContinuation = true` or `page_fetch_failed` with `kind = retryable_failure`.
- `attemptNumber is null` if and only if no `execute_page` effect has been emitted yet.
- after the first execution attempt, each accepted `resume_requested` event increases `attemptNumber` by exactly one.

## Command Algebra

External commands:

- `start_describe`
- `start_invoke`
- `resume_invoke`

Internal commands:

- `record_source_lookup`
- `record_descriptor_resolution`
- `record_request_preparation`
- `record_page_fetch`

## Effect Algebra

- `load_source`
- `resolve_descriptor`
- `prepare_request`
- `execute_page`

## Event Algebra

- `action_received`
- `source_loaded`
- `source_not_found`
- `descriptor_resolved`
- `descriptor_resolution_failed`
- `request_prepared`
- `request_preparation_failed`
- `resume_requested`
- `page_fetch_succeeded`
- `page_fetch_failed`

`resume_requested`, `page_fetch_succeeded`, and `page_fetch_failed` may occur more than once on the same action. That is repeatability of the state machine, not permission for duplicate delivery. Duplicate delivery is still handled by command idempotency.

## Transition Relation

| Command | Accepted when | Emits | Advances to | Schedules |
| --- | --- | --- | --- | --- |
| `start_describe` | `state = null` | `action_received` | `load_source / pending` | `load_source` |
| `start_invoke` | `state = null` | `action_received` | `load_source / pending` | `load_source` |
| `record_source_lookup { kind: "found" }` | `phase = load_source` | `source_loaded` | `describe_source / pending` | `resolve_descriptor` |
| `record_source_lookup { kind: "not_found" }` | `phase = load_source` | `source_not_found` | `completed / failed / source_not_found` | none |
| `record_descriptor_resolution { kind: "resolved" }` and `requestKind = describe` | `phase = describe_source` | `descriptor_resolved` | `completed / succeeded` | none |
| `record_descriptor_resolution { kind: "resolved" }` and `requestKind = invoke` | `phase = describe_source` | `descriptor_resolved` | `prepare_request / pending` | `prepare_request` |
| `record_descriptor_resolution { kind: "failed" }` | `phase = describe_source` | `descriptor_resolution_failed` | `completed / failed / descriptor_unavailable or permission_denied` | none |
| `record_request_preparation { kind: "prepared" }` and `invokeMode = preview_only` | `phase = prepare_request` | `request_prepared` | `completed / succeeded` | none |
| `record_request_preparation { kind: "prepared" }` and `invokeMode = execute` | `phase = prepare_request` | `request_prepared` | `execute_request / pending` with `attemptNumber = 1` | `execute_page(attemptNumber = 1)` |
| `record_request_preparation { kind: "failed" }` | `phase = prepare_request` | `request_preparation_failed` | `completed / failed / invalid_request or permission_denied` | none |
| `record_page_fetch { kind: "succeeded", hasContinuation: true }` | `phase = execute_request` | `page_fetch_succeeded` | `await_resume / pending`; shared `lastEventId` now identifies the resumable success event | none |
| `record_page_fetch { kind: "succeeded", hasContinuation: false }` | `phase = execute_request` | `page_fetch_succeeded` | `completed / succeeded` | none |
| `record_page_fetch { kind: "retryable_failure" }` | `phase = execute_request` | `page_fetch_failed` | `await_resume / pending`; shared `lastEventId` now identifies the resumable failure event | none |
| `record_page_fetch { kind: "terminal_failure" }` | `phase = execute_request` | `page_fetch_failed` | `completed / failed / request_failed or request_timed_out or execution_failed or execution_state_invalid` | none |
| `resume_invoke` | `phase = await_resume` and token `resumeFromEventId` equals shared `lastEventId` | `resume_requested` | `execute_request / pending` with `attemptNumber = previous attemptNumber + 1` | `execute_page(next attemptNumber)` |

## Resume Identity Rules

- start commands create actions; `resume_invoke` never creates a new action
- a continuation token must carry `actionId`, `resumeFromEventId`, and `preparedRequestFingerprint`

`resume_invoke` is accepted only if:

- the token `actionId` identifies an existing action
- the action is in `await_resume / pending`
- the token `resumeFromEventId` equals shared `lastEventId`

If any precondition fails, the command is rejected. The intended reject code is `invalid_phase` for the wrong lifecycle position and `causation_mismatch` for a stale or mismatched resume point.

Prepared-request validity against the current source and descriptor is checked by the `execute_page` effect on every attempt. If the fingerprint no longer matches executable state, the effect reports a terminal failure and the action moves to `completed / failed / execution_state_invalid`.

## Payload Rules

- every `page_fetch_succeeded` and `page_fetch_failed` event carries `attemptNumber`
- every successful page fetch carries `pageIndex`
- main audit tables store continuation identity metadata, not raw continuation state

## Projection-Derived Audit Fields

- `sourceSummary`
- `operationSummary`
- `descriptorVersion`
- `pageCount`
- `httpStatus`
- `contentType`
- `responseBytes`
- `retryable`
- `errorDetail`
- `latestRequestSummary`
- `latestResponseSummary`

These fields belong in family event payloads and `audit_feed_entries`, not in `<family>_actions` unless a future decision actually depends on them. The fold may keep a smaller normalized execution descriptor when later effects require it.

## Redaction Rules

- store header names, not header values
- do not store raw request bodies
- do not store raw response bodies
- do not store raw continuation state in the main audit tables

If payload retention is ever required, it belongs in a separate restricted store with its own retention and access policy.

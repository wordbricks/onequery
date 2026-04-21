# Write-Side Storage Contract

This document specifies how kernel decisions become durable rows. It defines write-side storage behavior, not family-specific transitions.

## Store Ownership

Each family owns:

- `<family>_actions`
- `<family>_action_events`

The shared workflow kernel owns:

- `workflow_commands`
- `workflow_effect_dispatches`
- `audit_projection_checkpoints`

Authoritative domain truth lives in `<family>_action_events`.

`workflow_commands` is authoritative only for command idempotency, command causation, command attribution metadata, and durable rejection outcomes.

`<family>_actions` is a transactional fold cache used for:

- current lifecycle state
- current family decision fields
- resume legality derived from shared lifecycle fields and the latest event pointer, plus only any additional non-derivable family data
- optimistic concurrency
- latest event pointer

`<family>_actions` is not a read model. If a field exists only to render audit UI, drive search, or support operator diagnostics, it belongs in event payloads or projections, not in the fold cache.

## Command Journal

Every command, accepted or rejected, produces exactly one `workflow_commands` row.

Required columns:

- `id`
- `family`
- `surface`
- `organization_id`
- `actor_snapshot_json`
- `action_id`
- `command_type`
- `command_invocation_id`
- `request_id`
- `caused_by_event_id`
- `decision_kind`
- `reject_code`
- `reject_detail`
- `created_at`

Required invariants:

- `(family, command_invocation_id)` is unique
- `decision_kind = rejected` if and only if `reject_code is not null`
- `action_id` is non-null for every accepted command

The command journal is what makes duplicate command delivery deterministic even when the original command was rejected.

Accepted command outcomes are recovered by reading that command's event rows through `command_id`. The journal does not duplicate per-command event pointers.

## Action Rows

Required columns:

- `id`
- `organization_id`
- `phase`
- `outcome`
- `failure_code`
- `started_at`
- `last_event_id`
- `last_event_sequence`
- `completed_at`
- family-specific decision fields

Required invariants:

- `last_event_id` references the event whose `sequence = last_event_sequence`
- if a family's follow-up command legality is anchored to the latest committed event, it uses shared `last_event_id` rather than a duplicated family-specific event-id column
- the shared lifecycle invariants from [shared-kernel.md](./shared-kernel.md) hold in persisted form

`last_event_sequence` is the only optimistic-concurrency counter. Do not duplicate it under a separate `version` column.

## Event Rows

Required columns:

- `id`
- `action_id`
- `sequence`
- `commit_position`
- `event_type`
- `command_id`
- `occurred_at`
- family-specific payload

Required invariants:

- event tables are append-only
- `sequence` is unique and gap-free per `action_id`
- `commit_position` is unique and strictly increasing per family
- `command_id` references `workflow_commands.id`

Event rows do not duplicate command-scoped metadata such as `command_invocation_id`, `request_id`, or `caused_by_event_id`. Those facts are recovered through `command_id`.

`commit_position` is intentionally a per-family total order. Audit V2 does not define a cross-family global event order.

## Outbox Rows

Required columns:

- `id`
- `family`
- `action_id`
- `origin_event_id`
- `effect_type`
- `effect_key`
- `payload_json`
- `status`
- `attempt_count`
- `available_at`
- `leased_until`
- `last_error_code`
- `last_error_detail`
- `created_at`
- `completed_at`

Required invariants:

- `effect_key` is unique
- an emitted effect's outbox row is inserted in the same transaction as the originating command and events

## Projection Checkpoints

Required columns:

- `projection_name`
- `family`
- `last_commit_position`
- `updated_at`

`(projection_name, family)` is unique.

## Transaction Protocol

The write path is:

1. Look up `workflow_commands` by `(family, command_invocation_id)`.
2. If a row already exists, return its stored outcome without re-running `decide`. For an accepted command, load its emitted events by `command_id` in `sequence` order.
3. Otherwise load the current folded action state, or null for a start command.
4. Run `decide`.
5. Open one transaction.
6. If the accepted command starts a new action, allocate `action_id`.
7. Insert the `workflow_commands` row. If the unique key on `(family, command_invocation_id)` loses a race, roll back and return the winning row's stored outcome.
8. If the command is rejected, commit only the command row.
9. If the command is accepted:
   - append the accepted events
   - fold them with `reduce`
   - insert outbox rows for emitted effects
   - insert or update the action row with optimistic concurrency over `last_event_sequence`
10. Commit.

There is no valid implementation in which events commit without the fold update, or effects are scheduled outside the commit that created their originating events.

## Concurrency Rule

Accepted commands update the fold row optimistically:

- load action row at `last_event_sequence = s`
- decide from that state
- append event sequence `s + 1 ...`
- update the fold row only where `last_event_sequence = s` and `last_event_id` still matches
- if the update loses the race, roll back and retry from fresh state

The event log and the action row must never diverge.

## Constraint Discipline

The database enforces structure, not the transition relation.

Good database constraints:

- append-only shape
- foreign keys
- uniqueness
- nullability alignment
- cheap cross-field invariants such as `completed_at` versus `outcome`

Bad database constraints:

- a duplicated event-type-to-phase matrix that attempts to restate reducer logic in SQL

> Comment: the current `cli_query_action` schema hard-codes much of the lifecycle matrix in SQL checks. That duplicates reducer truth and makes change harder than it needs to be. Audit V2 forbids that pattern.

## Recovery Rules

- If an action row is missing or corrupt, rebuild it by folding that action's event stream.
- If a projection is missing or corrupt, rebuild it from family `commit_position` order.
- If an outbox worker crashes after leasing an effect but before completion, the effect becomes dispatchable again after lease expiry.
- Retrying an effect never creates new domain facts directly. New facts appear only if the retried effect re-enters as an accepted command.

# Unified Projection And API

The read side consumes the committed family events and folded action state defined in the shared kernel, storage contract, and family specifications.

## Projection Model

The Audit tab reads one derived projection, `audit_feed_entries`.

This table is not authoritative. It is a rebuildable materialization of family action state. Each row represents exactly one action.

## Projection Row Contract

Required columns:

- `organization_id`
- `family`
- `family_action_id`
- `origin_surface`
- `origin_actor_json`
- `target_json`
- `action_name`
- `phase`
- `outcome`
- `failure_code`
- `started_at`
- `last_event_at`
- `completed_at`
- `last_event_type`
- `title`
- `subtitle`
- `metrics_json`
- `family_preview_json`
- `search_document`

`started_at` is the action start time, not the latest update time.

`origin_surface` and `origin_actor_json` come from the accepted start command that created the action. They are immutable for the life of the action. Resume commands and internal commands may have their own attribution in command or event records, but they do not overwrite the feed row's origin attribution.

The public/API feed identifier is derived from `family` and `family_action_id`. Projection storage does not need a duplicate persisted surrogate key for that identity.

## Projector Contract

- the projector reads each family event table in that family's `commit_position` order
- the projector checkpoints progress in `audit_projection_checkpoints`
- the projector upserts one feed row per action
- projector updates are idempotent
- truncating the projection and replaying from `commit_position = 0` rebuilds the same rows
- the projector derives action-origin attribution from the action's first committed event and its `command_id`; that accepted start command supplies `origin_surface` and `origin_actor_json`

The projector may consult the folded action row for convenience, but the event log remains the source of truth.

Because the projection is one row per action, projector processing order across families does not need to be globally total. A per-family checkpoint is sufficient.

## Feed Ordering And Cursors

The public feed orders by `started_at desc, id desc`, where `id` is the derived identity from `family` and `family_action_id`.

That order is immutable for a given action and therefore stable under updates. The feed must not order by `last_event_at`, because that would cause rows to move between pages as actions continue to evolve.

The cursor encodes:

- `started_at`
- `family`
- `family_action_id`

Pagination uses the same immutable order as the feed, so cursor comparisons remain correct even while actions receive new events.

If the product later needs "latest activity" semantics, that is a separate event-oriented projection.

If the product later needs "latest operator" or "latest resume actor" semantics, that is a separate derived field or event-oriented projection. It must not overload the action-origin attribution used by the feed.

## Search And Filters

- search and filtering operate on the projection, not family tables
- search indexes only redacted, user-visible text
- raw payload data is never required for feed search

## Public API Contract

The public API is feed-oriented and family-aware. It does not expose raw event history.

Each response must include:

- `families`: the families included in the result set
- `items`: feed rows in feed order
- `nextCursor`: the pagination cursor for the next page, or null
- `projectedThrough`: the latest projector checkpoint per family, or null if that family has not been projected yet

Each feed item is the public projection of one `audit_feed_entries` row. Public API fields use the same stems as projection columns, converted to `camelCase`.

Each feed item may expose an `id`, but that value is derived from `family` and `family_action_id` rather than read from a duplicate stored projection column.

Each feed item must expose:

- `id`
- `family`
- `familyActionId`
- `originSurface`
- `originActor`
- `target`
- `actionName`
- `phase`
- `outcome`
- `failureCode`
- `startedAt`
- `lastEventAt`
- `completedAt`
- `lastEventType`
- `title`
- `subtitle`
- `metrics`
- `preview`

`metrics` and `preview` may be null.

Family-specific preview data is intentionally shallow:

- `query_action` preview may expose `queryText`, `validatedQuery`, `rowCount`, `elapsedMs`, and `usageRecordingStatus`
- `source_api_action` preview may expose `operation`, `method`, `selector`, `httpStatus`, `pageCount`, `attemptNumber`, and `invokeMode`

`projectedThrough` makes projector lag explicit instead of implicit.

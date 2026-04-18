# Shared Workflow Kernel

This document defines the semantic contract shared by every workflow family. It specifies common concepts and invariants. It does not specify storage layout or any family-specific transition relation.

## Shared Vocabulary

Every family must expose the following shared concepts.

### Family And Surface

- `family` identifies the workflow family. Audit V2 currently defines `query_action` and `source_api_action`.
- `surface` identifies where the action came from. Audit V2 currently uses `cli`, `web`, `agent`, and `system`.

`family` determines behavior. `surface` does not.

Commands record their own `surface` and `actorSnapshot` for per-command attribution. When a one-row-per-action projection needs a single origin attribution, it uses the accepted start command's values. Later resume commands and internal commands do not rewrite the action's origin.

### Naming Discipline

- The same semantic fact keeps the same stem across boundaries. Only case changes. Example: `failureCode` / `failure_code`, `startedAt` / `started_at`, `lastEventId` / `last_event_id`.
- In-memory workflow state, command envelopes, event payload keys, and public API fields use `camelCase`.
- Database columns use `snake_case`.
- Use `*Kind` for disjoint semantic variants, `*Mode` for caller-selected execution modes, `*Status` for non-terminal subprocess progress, `*Code` for machine classifications, `*Id` for identifiers, and `*At` for timestamps.
- Structured JSON/blob columns must say so in the name with `*Json` / `*_json`.
- Avoid generic names such as `type`, `reason`, `data`, and `info` when a domain term is available.

### Action State

Every family state must carry these common lifecycle fields:

- `phase`
- `outcome`
- `failureCode`
- `startedAt`
- `completedAt`
- `lastEventId`
- `lastEventSequence`

Families may add family-specific fields, but they may not remove or reinterpret the shared ones.

Families may use shared `phase` and `lastEventId` together as the legality pointer for follow-up commands such as resume. They should not duplicate that same event identity in a family-specific field unless some additional non-derivable datum is required.

Family-specific folded state must stay minimal:

- keep facts that future `decide` calls need
- keep facts needed to build later effect descriptors
- do not store fields that are pure derivations of other folded state
- do not store public audit summaries here unless a later decision depends on them

### Command Envelope

Every command must be represented with:

- `family`
- `surface`
- `organizationId`
- `actorSnapshot`
- `commandInvocationId`
- `requestId`
- `actionId`
- `causedByEventId`
- `observedAt`
- `commandPayload`

`commandInvocationId` is the durable idempotency key for the logical command. Re-delivery of the same logical command must resolve to the same stored decision.

`actionId` is null only for a start command before the action exists.

`causedByEventId` is null for external commands. For internal commands it identifies the committed event whose emitted effect is now reporting back.

### Decision Result

Every family decision returns exactly one of:

- accept: a non-empty ordered event list and zero or more effect descriptors
- reject: a machine-readable reject code and optional detail

Shared reject codes are:

- `unknown_action`
- `invalid_phase`
- `causation_mismatch`

Families may add reject codes only where the shared set is not precise enough.

## Kernel Laws

- Commands are the only ingress for new workflow facts.
- `decide` is pure, total, and deterministic.
- `reduce` is pure, total, and deterministic.
- An accepted command emits a non-empty ordered event list.
- A rejected command emits no events and schedules no effects.
- Rejections are durable command outcomes, but they are not domain events.
- Families may extend the model, but they may not weaken these laws.

The consequence is intentional: workflow control flow is explicit. There is no valid mutation path outside `decide`, `reduce`, and outbox-driven internal commands.

## Lifecycle Axes

Every family uses the same three lifecycle axes:

- `phase`: where the action is now
- `outcome`: `pending`, `succeeded`, or `failed`
- `failureCode`: machine-readable terminal failure classification, or null

Required invariants:

- `outcome = pending` if and only if `completedAt = null`
- `outcome != pending` if and only if `phase = completed`
- `failureCode = null` if and only if `outcome != failed`
- terminal success and terminal failure both use `phase = completed`

`phase` answers "where are we?" `outcome` answers "how did it end?" `failureCode` answers "why did failure happen?"

## Command Classes

Commands fall into two classes:

- external commands, initiated by a user or API caller
- internal commands, produced by effect dispatch and re-entered through the same write path

Internal commands are not a special control path. They are subject to the same idempotency, rejection, and causation rules as external commands.

## Effects

Effects are durable descriptions of work to perform later. They are not callbacks and they are not permission to mutate state out of band.

Every effect descriptor must be:

- fully serializable at commit time
- idempotent under repeated dispatch
- independent of ambient process state once persisted

Effect handlers may read external systems, but they may not mutate workflow state directly. A completed effect attempt reports its outcome by submitting exactly one internal command, which is then accepted or rejected under the same kernel rules as any other command.

## Causality

For every accepted command:

- each emitted event belongs to exactly one action
- each emitted event is caused by exactly one committed command
- each internal command identifies the event that scheduled its originating effect

Families may reject a late or mismatched internal command with `causation_mismatch` when `causedByEventId` no longer matches the action state the effect was issued from.

## Replay Contract

The shared kernel requires the following replay properties:

- folding one action's event stream with `reduce` reproduces that action's folded state exactly
- replaying a family's event stream in `commit_position` order reproduces that family's projections
- replaying the outbox does not re-run `decide`; it dispatches already-committed effects

## Responsibility Split

- reducers and transition tests own lifecycle legality
- storage owns append-only structure, idempotency, and durability
- folded action rows own only decision-carrying state
- projections own read shaping only

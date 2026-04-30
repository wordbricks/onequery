# Modeling

## State

State nodes represent modes where behavior changes.

Use states for:

- editing vs saving vs saved vs error
- idle vs loading vs success vs failure
- unauthenticated vs authenticating vs authenticated
- selecting vs confirming vs submitting
- parent workflow phases

If a boolean changes which events are legal, it is probably a state. If two booleans can combine into an impossible situation, they are probably states.

## Context

Context holds durable facts.

Use context for:

- identifiers
- form drafts
- selected values
- persisted values
- data returned by actors
- error details the UI must render after a transition

Use helpers and selectors for data derived from current state and context.

## Events

Events are domain facts or commands.

Good event names:

- `budget.inputChanged`
- `budget.save`
- `budget.clear`
- `device.verificationSubmitted`
- `invite.accepted`

Event payloads should carry domain data captured at the boundary. Implementation dependencies belong in `.provide(...)`.

## Guards

Use guards to decide whether a transition is legal from the current context and event.

Name guards when they encode policy.

Use `snapshot.can(event)` in UI when button enablement should mirror machine legality.

## Tags

Use tags for UI semantics that may span multiple concrete states.

Examples:

- `loading`
- `saving`
- `editable`
- `error`
- `dirty`
- `blocked`

Prefer `snapshot.hasTag("saving")` for UI status and `snapshot.matches("saving")` for concrete state-specific behavior.

## Delays

Use named delays for delayed transitions.

Reference named delays from `after`. Override them with `.provide({ delays })` in tests.

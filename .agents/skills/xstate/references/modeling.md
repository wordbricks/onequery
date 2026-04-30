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

Do not store data that can be derived from current state and context. Prefer helpers and selectors for derived values.

## Events

Events are domain facts or commands.

Good event names:

- `budget.inputChanged`
- `budget.save`
- `budget.clear`
- `device.verificationSubmitted`
- `invite.accepted`

Event payloads should carry domain data captured at the boundary. Implementation dependencies belong in `.provide(...)`, not event payloads.

## Guards

Use guards to decide whether a transition is legal from the current context and event.

Guards should be named when they encode policy:

```ts
guards: {
  canSubmit: ({ context }) => context.input.trim().length > 0,
}
```

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

Use named delays.

```ts
import { setup } from "xstate";

setup({
  delays: {
    savedIdle: 2000,
  },
}).createMachine({
  states: {
    saved: {
      after: {
        savedIdle: "editing",
      },
    },
  },
});
```

Reference them by name in `after`. Override them with `.provide({ delays })` in tests.

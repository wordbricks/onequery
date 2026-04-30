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

## State Types

Use the state node type that matches the workflow shape:

- atomic: no child states; this is the default
- compound: one active child state, with `initial` and `states`
- parallel: multiple active child regions, with `type: "parallel"`
- final: terminal state for a completed workflow or nested phase, with `type: "final"`

```ts
states: {
  checkout: {
    initial: "shipping",
    states: {
      shipping: {},
      payment: {},
      complete: { type: "final" },
    },
    onDone: "submitted",
  },
  syncing: {
    type: "parallel",
    states: {
      profile: {},
      billing: {},
    },
  },
}
```

Use final states for domain endpoints such as `submitted`, `accepted`, `completed`, `canceled`, or `failed`. A root final state completes the machine actor with snapshot status `"done"`. A nested final state completes its parent and raises the parent's `onDone`; a parallel parent completes after every region reaches a final state.

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

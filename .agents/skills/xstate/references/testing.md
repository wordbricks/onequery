# Testing

Test machines as actors when actor behavior matters.

## Actor Tests

Create actors with input and provided implementations.

```ts
import { createActor, fromPromise } from "xstate";

const actor = createActor(
  machine.provide({
    actors: {
      saveBudget: fromPromise(async ({ input }) => ({
        monthlyBudgetUsd: input.nextBudgetUsd,
      })),
    },
    delays: {
      savedIdle: 10,
    },
  }),
  {
    input: { initialBudgetUsd: 10 },
  }
).start();
```

Start the actor, send domain events, and assert snapshots.

## Async Actors

Use `waitFor(actor, predicate, { timeout })` for invoked actor completion.

```ts
import { waitFor } from "xstate";

actor.send({ type: "budget.save" });

const saved = await waitFor(actor, (snapshot) => snapshot.matches("saved"), {
  timeout: 1000,
});
```

Use resolving and rejecting test actors to cover `onDone` and `onError`.

## Timing

Provide short named delays in tests with `.provide({ delays })`. Install the wait before advancing fake timers when a transition may happen quickly.

## State-Space Tests

Use `xstate/graph` for synchronous state-space coverage: legal paths, guarded transitions, and state invariants.

```ts
import { getShortestPaths } from "xstate/graph";

const paths = getShortestPaths(machine, {
  events: (snapshot) => [
    { type: "budget.inputChanged", value: "25" },
    { type: "budget.save" },
    { type: "budget.clear" },
  ],
  filterEvents: (snapshot, event) => snapshot.can(event),
});

for (const path of paths) {
  expect(path.state.context.input).toBeDefined();
}
```

Graph tests explore external events. Use actor tests for invoked actor success, failure, cancellation, and delayed completion.

## Coverage Targets

Cover:

- legal transitions
- blocked guarded transitions
- actor success
- actor failure
- cancellation by leaving an invoking state
- delayed transitions
- important tags and `can(...)` behavior

Use graph tests for synchronous state-space coverage. Use actor tests for invoked behavior.

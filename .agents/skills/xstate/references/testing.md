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

Test standalone promise logic with `createActor(fromPromise(...), { input })` and `waitFor(actor, (snapshot) => snapshot.status === "done")` for output.

Use `toPromise(actor)` or an error observer for rejected promise actors.

```ts
import { toPromise } from "xstate";
```

For cancellation tests, use an abortable fake that records `signal.addEventListener("abort", ...)`; start the actor, leave the invoking state, then assert the abort handler ran.

## Timing

Provide short named delays in tests with `.provide({ delays })`. Install the wait before advancing fake timers when a transition may happen quickly.

## Pure Transitions

Use `initialTransition(...)` and `transition(...)` for deterministic checks of guards, eventless routing, delayed-transition configuration, and selected actions.

```ts
import { initialTransition, transition } from "xstate";

const [initial] = initialTransition(machine, { initialBudgetUsd: 10 });
const [next] = transition(machine, initial, { type: "budget.save" });

expect(next.matches("saving")).toBe(true);
```

Use actor tests for executed actions, invoked actors, timers, and emitted events.

For transition modeling, read [Transitions](transitions.md).

## State-Space Tests

Use `xstate/graph` for synchronous state-space coverage: legal paths, guarded transitions, tags, `can(...)`, and state invariants.

```ts
import { getShortestPaths, getSimplePaths } from "xstate/graph";

const graphOptions = {
  events: () => [
    { type: "budget.inputChanged", value: "25" },
    { type: "budget.save" },
    { type: "budget.clear" },
  ],
  filterEvents: (snapshot, event) => snapshot.can(event),
};

const shortestPaths = getShortestPaths(machine, graphOptions);
const simplePaths = getSimplePaths(machine, graphOptions);

for (const path of [...shortestPaths, ...simplePaths]) {
  expect(path.state.context.input).toBeDefined();
}
```

Use shortest paths for representative coverage. Use simple paths when branch combinations carry important risk.

Graph tests explore external events and synchronous transitions. Use actor tests for invoked actor success, failure, cancellation, emitted events, and delayed completion.

For promise actor cases, read [Promises](promises.md).

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

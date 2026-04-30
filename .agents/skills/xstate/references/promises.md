# Promises

Promise actors model one async run.

## Actor Shape

Use `fromPromise` for a request that starts with the actor and settles once.

```ts
import { fromPromise } from "xstate";

const saveBudget = fromPromise<
  { monthlyBudgetUsd: number | null },
  { nextBudgetUsd: number | null }
>(async ({ input, signal }) => {
  const response = await fetch("/api/budget", {
    body: JSON.stringify(input),
    method: "POST",
    signal,
  });

  return response.json();
});
```

Promise creators receive `{ input, signal, self, system, emit }`.

Use:

- `input` for request data
- `signal` with abortable APIs
- `emit` for typed observer events consumed with `actor.on(...)`
- `self` and `system` for actor-system integration

## Invocation

Treat `invoke.input` as the request snapshot.

```ts
import { assertEvent } from "xstate";

saving: {
  invoke: {
    src: "saveBudget",
    input: ({ context, event }) => {
      assertEvent(event, "budget.save");
      return { nextBudgetUsd: context.nextBudgetUsd };
    },
    onDone: {
      target: "saved",
      actions: {
        type: "storeSavedBudget",
        params: ({ event }) => event.output,
      },
    },
    onError: {
      target: "failed",
      actions: {
        type: "storeSaveError",
        params: ({ event }) => ({ error: event.error }),
      },
    },
  },
}
```

Derive input from context, or from the entering event after `assertEvent(...)`.
Start a new request by re-entering the invoking state or spawning a new promise actor.

## Results

Use returned values for parent workflow data. Read success data from `event.output` in `onDone`.

Use thrown values for parent workflow failures. Read failure data from `event.error` in `onError`, then route to a modeled retry, failure, or escalation state.

Promise actors receive their input at start and react through their lifecycle: active, done, error, or stopped. Model interactive async workflows with a child machine.

## Cancellation

State exit and actor stop abort the active promise run.

Each started promise actor receives its own `AbortSignal`. Completed and errored runs settle with `output` or `error`; stopped runs follow the transition that stopped the actor.

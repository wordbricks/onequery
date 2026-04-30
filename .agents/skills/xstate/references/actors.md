# Actors

Actors own side effects and lifecycles.

## Choosing Actor Types

Use `fromPromise` for one request and one result.

Use `fromCallback` for:

- subscriptions
- sockets
- browser APIs that call back repeatedly
- event streams
- imperative integrations that need cleanup

Use a child machine when the child has its own modes, retries, cancellation, history, or durable state.

Use `fromObservable` for streams of snapshot values.

Use `fromEventObservable` for observable streams that send events to the parent.

Use `fromTransition` for reducer-like child actors with simple event-to-state updates.

## Invocation

Invoke actors from the state where the actor is active.

```ts
import { assertEvent } from "xstate";

saving: {
  invoke: {
    src: "saveBudget",
    input: ({ context, event }) => {
      assertEvent(event, "budget.save");
      return { nextBudgetUsd: parseBudget(context.input) };
    },
    onDone: {
      target: "saved",
      actions: {
        type: "storeBudget",
        params: ({ event }) => ({ value: event.output.monthlyBudgetUsd }),
      },
    },
    onError: {
      target: "error",
    },
  },
}
```

Compute request input at `invoke.input`. Do not relay request data through context unless that data must remain useful after the actor stops.

Use `event` in `invoke.input` only when the state was entered by that event. Narrow it with `assertEvent(...)`. Otherwise derive input from context.

## Outputs

Store only the output data the parent needs after completion.

Use `onDone` for actors that complete with output, such as promise actors, observables, and child machines that reach a top-level final state. Use `onError` for failures. Keep the failure policy explicit: retry, return to editing, show error state, or escalate.

Callback actors communicate by sending events back and by returning cleanup logic.

## Cancellation

Leaving an invoking state stops the invoked actor. Use that property as the cancellation model.

For promise work, use the provided abort signal with abortable APIs. For subscriptions and imperative resources, use callback actor cleanup.

## Implementations

Define typed default actors in `setup({ actors })`. Replace compatible actors with `.provide({ actors })` when the implementation depends on app services, React closures, test doubles, or environment.

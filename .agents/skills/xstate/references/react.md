# React

React owns rendering. XState owns process behavior.

## Local Actors

Use `useActor(logic, options)` for local component-owned actors that the component reads. It creates, starts, subscribes, and returns `[snapshot, send, actorRef]`.

```ts
import { useActor } from "@xstate/react";
import { fromPromise } from "xstate";

const [snapshot, send] = useActor(
  machine.provide({
    actors: {
      saveBudget: fromPromise(({ input }) => saveBudget(input.nextBudgetUsd)),
    },
  }),
  {
    input: { initialBudgetUsd },
  }
);
```

Use root actor `input` for initialization. It is evaluated once for that actor instance. If the machine declares `types.input`, pass `options.input` when creating the actor.

## Provided Implementations

Use `.provide(...)` in render for implementations that depend on current React closures. Apply it to stable machine logic so implementations refresh without resetting actor state.

Good candidates:

- mutation functions
- toast actions
- navigation actions
- analytics actions
- permission guards
- test doubles

## Shared Actors

Use `useActorRef` when the current component owns an actor ref but reads it selectively. It creates and starts an actor ref; read it with `useSelector`.

```ts
import { useActorRef, useSelector } from "@xstate/react";

const actorRef = useActorRef(machine, { input });
const canSave = useSelector(actorRef, (snapshot) =>
  snapshot.can({ type: "budget.save" })
);
```

For shared actors, create or own the actor once in an owner or provider, then pass the actor ref or consume it through context. Read externally owned actor refs with `useSelector`.

## Snapshot-Driven UI

Use:

- `snapshot.matches(...)` for concrete state
- `snapshot.hasTag(...)` for semantic state
- `snapshot.can(event)` for enabled commands
- selectors for context slices

Derive display values in render or selectors. Do not mirror machine state into React state.

## External Changes

Changed props do not reinitialize a running actor. Changed closures inside `.provide(...)` are refreshed. Changed machine config creates a new actor from the previous persisted snapshot.

Choose the external-change policy deliberately:

- key the actor owner when the process should restart
- send a domain event when an external fact updates the current process
- invoke a subscription actor when the machine owns an external stream

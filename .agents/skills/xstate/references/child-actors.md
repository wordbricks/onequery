# Child Actors

Child actors model owned concurrent work.

## Ownership

Use `invoke` when the child lifecycle is tied to a state.

Use `spawn` when a dynamic child must outlive one state and its actor ref belongs in context.

Use `spawnChild` for declarative child startup from an action.

```ts
import { assign, setup, spawnChild, stopChild } from "xstate";

const machine = setup({
  actors: {
    worker: workerMachine,
  },
  actions: {
    spawnWorker: spawnChild("worker", { id: "worker" }),
    stopWorker: stopChild("worker"),
    storeWorker: assign({
      workerRef: ({ spawn }) => spawn("worker", { id: "dynamicWorker" }),
    }),
  },
}).createMachine({});
```

Store actor refs in context when the parent must address that child later.

Use `stopChild` when the parent owns a child that needs explicit cleanup.

## Addressing

Send events to child refs with `sendTo(...)` or `childRef.send(...)` at the boundary.

Use child machines for workflows with their own states, retries, history, and durable facts.

## Inspection

Use `createActor(logic, { inspect })` or React actor context options for diagnostics.

Inspection events expose actor, event, and snapshot flow. Keep domain behavior in machines and actors.

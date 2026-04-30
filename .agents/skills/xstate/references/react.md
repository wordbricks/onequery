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

## Actor Identity and Rerenders

`useActor(...)`, `useMachine(...)`, and `useActorRef(...)` create, start, and stop an actor with the component. A normal React rerender should keep that actor.

The identity boundary is the machine config:

- Stable config: keeps the actor.
- Changed implementations via `machine.provide(...)`: keeps the actor and refreshes closures.
- Changed machine config: replaces the actor from the previous persisted snapshot.
- New process: use a React `key` or move the actor owner so remounting is intentional.

Keep machine definitions out of render unless replacement is the point:

```tsx
// Avoid: render creates a new config identity.
const [snapshot, send] = useActor(
  setup({}).createMachine({
    context: { projectId },
    // ...
  })
);

// Prefer: stable machine plus per-instance input.
const [snapshot, send] = useActor(projectMachine, {
  input: { projectId },
});

// Also OK: stable machine logic with current React closures provided in render.
const [snapshot, send] = useActor(
  projectMachine.provide({
    actions: {
      notifySaved: () => toast.success("Saved"),
    },
  }),
  { input: { projectId } }
);
```

If a prop changes after the actor starts, `input` will not be re-read. Decide the policy explicitly: send a domain event, invoke a subscription actor, or remount with a React `key`.

## Event Handlers

Keep UI event handlers thin. Send domain events from render-time closures:

```tsx
<button
  onClick={() => send({ type: "budget.save" })}
  disabled={!snapshot.can({ type: "budget.save" })}
>
  Save
</button>
```

Use provided actions or invoked actors for async work, navigation, toasts, and service calls that happen after transitions.

For async actor choices, read [Promises](promises.md) and [Callbacks](callbacks.md).

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

Use `useActorRef` when the current component owns the actor but should not rerender for every snapshot. Read selected values with `useSelector`.

```ts
import { useActorRef, useSelector } from "@xstate/react";

const actorRef = useActorRef(machine, { input });
const canSave = useSelector(actorRef, (snapshot) =>
  snapshot.can({ type: "budget.save" })
);
```

For shared actors, own the actor once in an owner or provider, then pass the actor ref or consume it through context. Read externally owned actor refs with `useSelector`. Use `useActor(...)` or `useMachine(...)` when the component should rerender on every actor snapshot.

Define selectors outside the component when possible. If a selector returns an object or array, either preserve the reference or pass a comparator such as `shallowEqual`.

```tsx
import { shallowEqual, useActorRef, useSelector } from "@xstate/react";
import type { SnapshotFrom } from "xstate";

const selectCanSave = (snapshot: SnapshotFrom<typeof projectMachine>) =>
  snapshot.can({ type: "project.save" });
const selectUser = (snapshot: SnapshotFrom<typeof projectMachine>) =>
  snapshot.context.user;

function ProjectOwner({ projectId }: { projectId: string }) {
  const actorRef = useActorRef(projectMachine, { input: { projectId } });
  const canSave = useSelector(actorRef, selectCanSave);
  const user = useSelector(actorRef, selectUser, shallowEqual);

  return <ProjectForm actorRef={actorRef} canSave={canSave} user={user} />;
}
```

Use `createActorContext(logic)` when one actor should be app- or feature-scoped. Put the provider at the ownership boundary, then consume with `Context.useActorRef()` and `Context.useSelector(...)`.

## Snapshot-Driven UI

Use:

- `snapshot.matches(...)` for concrete state
- `snapshot.hasTag(...)` for semantic state
- `snapshot.can(event)` for enabled commands
- selectors for context slices

Derive display values in render or selectors. Keep machine-owned values in snapshots and context.

## External Changes

Changed props leave the running actor intact. Choose the external-change policy in [Actor Identity and Rerenders](#actor-identity-and-rerenders) deliberately.

For subscription actors, read [Callbacks](callbacks.md) and [Observables](observables.md).

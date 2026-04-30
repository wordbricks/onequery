# Transitions

Transitions define the legal movement of the workflow.

## Event Transitions

Use event transitions for domain commands and facts.

```ts
on: {
  "budget.save": {
    guard: "canSave",
    target: "saving",
  },
}
```

Use arrays when priority matters. XState takes the first transition whose guard passes.

```ts
on: {
  "payment.completed": [
    { guard: "needsReview", target: "reviewing" },
    { target: "fulfilled" },
  ],
}
```

## Guards

Put policy in named guards.

```ts
import { and, not, or, setup } from "xstate";

setup({
  guards: {
    hasAmount: ({ context }) => context.amount > 0,
    withinLimit: ({ context }) => context.amount <= context.limit,
  },
}).createMachine({
  on: {
    submit: {
      guard: and(["hasAmount", "withinLimit"]),
      target: "submitting",
    },
    skip: {
      guard: or([not("hasAmount"), "withinLimit"]),
      target: "idle",
    },
  },
});
```

## Action and Guard Params

Use dynamic `params` for named actions and guards that should stay reusable and independent from a specific machine shape. Prefer params over reading `event` directly inside action and guard implementations; use `assertEvent(...)` there only when params are infeasible.

```ts
import { setup } from "xstate";

const feedbackMachine = setup({
  types: {
    context: {} as {
      user: { name: string };
    },
  },
  actions: {
    greet: (_, params: { name: string }) => {
      console.log(`Hello, ${params.name}`);
    },
  },
  guards: {
    hasName: (_, params: { name: string }) => params.name.length > 0,
  },
}).createMachine({
  context: {
    user: { name: "David" },
  },
  entry: {
    type: "greet",
    params: ({ context }) => ({
      name: context.user.name,
    }),
  },
  on: {
    submit: {
      guard: {
        type: "hasName",
        params: ({ context }) => ({
          name: context.user.name,
        }),
      },
      target: "submitted",
    },
  },
});
```

## Eventless Transitions

Use `always` for immediate routing after context changes, actor completion, or state entry.

```ts
checking: {
  always: [
    { guard: "isApproved", target: "approved" },
    { guard: "isDenied", target: "denied" },
    { target: "manualReview" },
  ],
}
```

Keep `always` transitions finite and convergent.

## Delayed Transitions

Use `after` with named delays for time-based workflow movement.

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

Use delay functions when duration depends on context or the entering event.
Override named delays with `.provide({ delays })` in tests.

## Pure Checks

Use `initialTransition(...)` and `transition(...)` for deterministic transition checks.

```ts
import { initialTransition, transition } from "xstate";

const [initial] = initialTransition(machine, { initialBudgetUsd: 10 });
const [next, actions] = transition(machine, initial, {
  type: "budget.save",
});

expect(next.matches("saving")).toBe(true);
expect(actions.map((action) => action.type)).toContain("markSaveStarted");
```

Pure transition helpers return snapshots and executable actions. Execute side effects through actor tests.

For test strategy, read [Testing](testing.md).

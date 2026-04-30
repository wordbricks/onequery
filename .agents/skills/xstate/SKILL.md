---
name: xstate
description: >
  Design, implement, and review XState v5 state machines and @xstate/react integrations in TypeScript.
  Use when modeling finite workflows, async actors, statecharts, guarded transitions, delayed transitions,
  actor systems, or machine-driven React behavior.
references:
  - references/modeling.md
  - references/actors.md
  - references/react.md
  - references/testing.md
---

# XState

Use XState when the domain has meaningful modes, transitions, async lifecycle, cancellation, guards, delays, or actor boundaries. The goal is not "state management"; the goal is to make the process explicit, typed, inspectable, and hard to misuse.

## Core Standard

- Prefer `setup({ types, actors, actions, guards, delays }).createMachine(...)` for typed machines with named implementations.
- Put finite modes in states.
- Put durable facts in context.
- Put side effects behind actors, actions, guards, and delays.
- Put request data in `invoke.input`.
- Put UI decisions on snapshots: `matches`, `hasTag`, `can`, and selected context.
- Initialize each actor instance with `input`.
- Define default implementations in `setup(...)`; replace runtime implementations with `.provide(...)`.
- Model later external changes as keyed remounts, domain events, or subscription actors.

## Reading Guide

Read only the references needed for the task:

- [Modeling](references/modeling.md): states, context, events, guards, tags, delays.
- [Actors](references/actors.md): async work, actor choice, invocation, outputs, cancellation.
- [React](references/react.md): `@xstate/react`, `.provide(...)`, actor input, selectors.
- [Testing](references/testing.md): actor tests, `waitFor`, provided implementations, timing.

## Working Loop

1. Name the process and its legal modes.
2. Define the domain events.
3. Decide what data survives transitions.
4. Move effects into actors or named implementations.
5. Connect UI through actor hooks and snapshot reads.
6. Test behavior at the actor boundary.

---
name: onequery-cli-mutation
description: Use when you need to reason about future mutating OneQuery CLI flows or local state changes such as auth/org selection without assuming data-plane write access.
---

# OneQuery CLI Mutation

This leaf skill extends `.agents/skills/onequery-cli/SKILL.md`.

## Guardrails

- Follow `.agents/skills/onequery-cli/SKILL.md` before running local state mutations.
- Do not assume write access to remote data-plane resources through the public CLI surface.
- Prefer explicit confirmation before changing persistent local CLI state.

## Workflow

1. Distinguish local state changes such as `oneq auth import`, `oneq auth logout`, or `oneq org use` from remote data mutations.
2. Confirm why the state change is needed before applying it.
3. Report the resulting local state clearly after the command completes.

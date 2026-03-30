---
name: onequery-cli-mutation
description: Use when you need to change only local CLI state, such as auth import/logout or org selection, without touching protected remote resources.
---

# OneQuery CLI Mutation

This leaf skill extends `apps/cli/docs/skills/SKILL.md`.

## Guardrails

- Follow `apps/cli/docs/skills/SKILL.md` before running local state mutations.
- Prefer `--dry-run` first when the command supports it.
- Limit scope to local CLI state; do not use this skill for remote writes.

## Workflow

1. Confirm the command is local-state-only.
2. Run a dry run first when available.
3. Execute the mutation.
4. Summarize the changed local state and any follow-up auth or org implications.

---
name: local-state
description: Use when you need to change only local OneQuery CLI state, such as login, auth import or logout, or active-org selection. Do not use for remote writes or query execution.
disable-model-invocation: true
---

# OneQuery local state

Use this skill only when the user explicitly wants to change local OneQuery CLI state.

## Workflow

1. Confirm the CLI is available with `command -v onequery`.
2. Inspect the current state first when helpful:
   - `onequery auth whoami --output json`
   - `onequery org current --output json`
3. For auth import, prefer `onequery auth import --input <path|-> --dry-run` before running the same command without `--dry-run`.
4. For logout, prefer `onequery auth logout --dry-run` before running logout without `--dry-run`.
5. For active-org persistence, prefer `onequery org use <slug> --dry-run` before running it without `--dry-run`.
6. Run `onequery auth login` only when the user wants an interactive browser or device-code login flow.
7. After a mutation, re-check the resulting state with `onequery auth whoami --output json` or `onequery org current --output json`.

## Guardrails

- Do not use this skill unless the user has explicitly asked for the local state change.
- Prefer `--dry-run` first when the command supports it.
- Limit scope to local CLI state; do not use this skill for remote writes.
- Tell the user when a step requires browser interaction or fresh credentials.

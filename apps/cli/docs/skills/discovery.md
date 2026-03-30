---
name: onequery-cli-discovery
description: Use when you need to inspect the CLI's public command surface, resolve org context, or identify a queryable source before taking a narrower action.
---

# OneQuery CLI Discovery

This leaf skill extends `apps/cli/docs/skills/SKILL.md`.

## Guardrails

- Follow `apps/cli/docs/skills/SKILL.md` and branch immediately into the schema-only path when the task is just command discovery.
- Prefer `onequery schema commands --output json` or `onequery schema command <path> --output json` before guessing command shapes.
- Resolve org and source ambiguity before proposing SQL.

## Workflow

1. Use schema commands when the task is command or contract discovery.
2. For protected workflows, confirm auth with `onequery auth whoami`.
3. Resolve org context with `onequery org current` and `onequery org list` when needed.
4. Resolve sources with `onequery source list` and confirm query support with `onequery source show <source_key>`.

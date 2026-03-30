---
name: onequery-cli-discovery
description: Use when you need to inspect org context, available sources, or the CLI's own machine-readable schema surface before issuing a narrower OneQuery command.
---

# OneQuery CLI Discovery

This leaf skill extends `.agents/skills/onequery-cli/SKILL.md`.

## Guardrails

- Follow `.agents/skills/onequery-cli/SKILL.md` and branch immediately into the schema-only
  path when the task is just command discovery.
- Prefer `onequery schema commands --output json` when you need command capabilities.
- `onequery schema commands` and `onequery schema command <path>` do not require browser auth or
  org setup.
- Resolve org and source ambiguity before moving on to query execution.

## Workflow

1. If the task is schema-only, run `onequery schema commands --output json` first and
   `onequery schema command <path> --output json` when you need one exact contract.
2. If the task needs org or source discovery, confirm auth and org context.
3. Use `onequery org current`, `onequery org list`, `onequery source list`, and `onequery source show`
   to narrow the target.

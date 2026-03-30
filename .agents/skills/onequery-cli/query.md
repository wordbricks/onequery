---
name: onequery-cli-query
description: Use when you need to run a read-only SQL query against a OneQuery-managed source after org and source selection are already clear.
---

# OneQuery CLI Query

This leaf skill extends `.agents/skills/onequery-cli/SKILL.md`.

## Guardrails

- Follow `.agents/skills/onequery-cli/SKILL.md` before running query commands.
- Start with the smallest cheap validation query that can answer the question.
- Prefer file or stdin input for multi-line SQL to avoid shell escaping mistakes.
- Raise `--timeout <sec>` for a single slow query run instead of editing persisted config.

## Workflow

1. Confirm the source is queryable with `oneq source show <source_key>`.
2. Start with a bounded read-only SQL statement.
3. Tighten filters or reduce result width before widening scope.

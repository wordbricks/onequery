---
name: source-connect
description: Use when the user explicitly wants to create a new OneQuery source connection. Do not use for read-only discovery or querying.
disable-model-invocation: true
---

# OneQuery source connect

Use this skill only for explicit source-creation requests.

## Workflow

1. Confirm the CLI is available with `command -v onequery`.
2. Confirm auth with `onequery auth whoami --output json`.
3. Resolve org context with `onequery org current --output json` and `onequery org list --output json` if needed.
4. Prefer `--org <slug>` unless the user explicitly wants to persist a default org.
5. Fetch the provider-specific connection guide first:
   - `onequery --org <slug> source connect --source <provider> --output json`
6. Show the returned guide and required input shape before attempting a mutation.
7. Only run the creation step after the user provides or approves the JSON payload:
   - `onequery --org <slug> source connect --source <provider> --input '<json>' --output json`
8. After creation, confirm the resulting source and next command from the structured output.

## Guardrails

- Do not run this skill unless the user explicitly asks to create or modify a OneQuery source.
- Always fetch and inspect the provider guide before attempting `--input`.
- Never invent credentials or connection fields.
- Treat all credentials and secrets as sensitive.

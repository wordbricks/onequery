---
name: internal-data-analysis
description: Use OneQuery CLI-backed Hermes plugin tools to inspect company data safely without direct database credentials.
---

# Internal Data Analysis With OneQuery

Use this skill when a user asks Hermes to analyze internal company data,
warehouse metrics, product funnels, incidents, customer health, or operational
data that should be accessed through OneQuery.

## Rules

- Never ask for direct database credentials.
- Always use OneQuery plugin tools for internal data access.
- Resolve org and source before writing SQL.
- Run `onequery_show_source` before query validation.
- Run `onequery_validate_query` before `onequery_execute_query`.
- Let OneQuery validate and enforce SQL policy; do not pre-screen SQL in Hermes.
- Prefer aggregate queries before row samples.
- Include a clear `purpose`, `time_bound`, and `request_id` for execution.
- Include org, source, request id, and query purpose in the final answer.
- Use `onequery_api_describe` before `onequery_api_call` when the task needs a connected source API rather than SQL.

## Workflow

1. Call `onequery_status`.
2. If org is unclear, ask the user for the OneQuery org slug or call `onequery_list_sources` after the user gives it.
3. Call `onequery_list_sources` and identify candidate sources.
4. If multiple sources match, ask the user to choose before querying.
5. Call `onequery_show_source` for the chosen source.
6. Draft the smallest useful SQL query with explicit date bounds.
7. Call `onequery_validate_query`.
8. If validation passes, call `onequery_execute_query`.
9. For source API tasks, call `onequery_api_describe`, then call `onequery_api_call` with the smallest operation target and request body that answers the question.
10. Synthesize results with evidence and state any remaining uncertainty.

## Safety Defaults

- Use `max_rows` no higher than 200 unless the user explicitly asks for more.
- Use `max_bytes` no higher than 50000 unless needed.
- Prefer `dry_run` first for unfamiliar source API calls.
- Prefer aggregate or scoped source API operations before broad list calls.
- If sensitive fields may be involved, ask OneQuery to validate the request path and prefer redacted or aggregate alternatives.

## Final Answer Shape

Return:

- Short conclusion
- Evidence table with source, query purpose, request id, and result
- Root-cause candidates ordered by confidence
- Gaps or blocked access
- Next smallest query if more evidence is needed

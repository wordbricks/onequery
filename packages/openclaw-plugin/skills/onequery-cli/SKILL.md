---
name: onequery-openclaw
description: Use OpenClaw's OneQuery tools to inspect orgs, sources, and run bounded read-only SQL through the OneQuery CLI.
metadata: {"openclaw":{"requires":{"bins":["onequery"]},"homepage":"https://github.com/wordbricks/onequery"}}
---

Use this skill when the user wants company or customer data that should be read
through OneQuery-managed access, or when you need to resolve org and source
context before a bounded query.

Use the tools in this order:

1. `onequery_auth_whoami`
2. `onequery_org_current` or `onequery_org_list`
3. `onequery_source_list`
4. `onequery_source_show`
5. `onequery_query_validate`
6. `onequery_query_exec`

Rules:

- Always pass an explicit `org` to source and query tools.
- Prefer `onequery_query_validate` before `onequery_query_exec` for unfamiliar
  SQL or provider dialects.
- Start with `select 1`, a row count, or a bounded aggregate before wide row
  dumps.
- Keep reads aggressively bounded with `maxRows`, `maxBytes`, and
  `cellMaxChars`.
- Treat informal source names as aliases to resolve, not literal source keys.
- If the tools are unavailable, ask the operator to add `"onequery"` to
  `tools.allow`.
- In your final answer, report the org, source, and any request id returned by
  the CLI.

Recovery:

- Auth issues: inspect `onequery_auth_whoami`, then ask the user to refresh the
  OneQuery CLI session if needed.
- Org ambiguity: `onequery_org_list`
- Source ambiguity: `onequery_source_list`, then `onequery_source_show`
- SQL shape issues: `onequery_query_validate`

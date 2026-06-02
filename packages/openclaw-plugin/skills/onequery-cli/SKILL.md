---
name: onequery-openclaw
description: Use OpenClaw's exec tool to inspect orgs, sources, and run bounded read-only SQL through the OneQuery CLI directly.
metadata: {"openclaw":{"requires":{"bins":["onequery"]},"homepage":"https://onequery.dev"}}
---

Use this skill when the user wants company or customer data that should be read
through OneQuery-managed access, or when you need to resolve org and source
context before a bounded query.

Use OpenClaw's `exec` tool to run the `onequery` CLI directly.

Use these commands in this order:

1. `onequery auth whoami`
2. `onequery org current` or `onequery org list --page-size 25`
3. `onequery source list --org <org> --page-size 25`
4. `onequery source show <source> --org <org>`
5. `onequery query validate --org <org> --source <source> --sql '<sql>' --max-rows 100 --max-bytes 1048576 --cell-max-chars 2000 --timeout-ms 60000`
6. `onequery query exec --org <org> --source <source> --sql '<sql>' --max-rows 100 --max-bytes 1048576 --cell-max-chars 2000 --timeout-ms 60000`

Rules:

- Always pass an explicit `--org` to org-scoped source and query commands.
- Prefer `query validate` before `query exec` for unfamiliar SQL or provider
  dialects.
- Start with `select 1`, a row count, or a bounded aggregate before wide row
  dumps.
- Keep reads aggressively bounded with `--max-rows`, `--max-bytes`,
  `--cell-max-chars`, and small page sizes.
- `query exec` supports `--page-size`, `--cursor`, and `--page-all`;
  `query validate` does not.
- Only run read-only SQL. Reject obviously mutating statements instead of
  executing them.
- Treat informal source names as aliases to resolve, not literal source keys.
- Use shell-safe argument construction. Do not pass user text through shell
  operators, command substitution, or chained commands.
- For long or quote-heavy SQL, write it to a temporary UTF-8 file and use
  `--file <path>` instead of forcing brittle shell escaping.
- If `onequery` is unavailable, ask the operator to install it or expose it on
  `PATH`.
- If `exec` runs under restrictive approval or allowlist policy, ask the
  operator to allow the resolved `onequery` binary or enable skill-bin
  auto-allow.
- In your final answer, report the org, source, and any request id returned by
  the CLI.

Recovery:

- Auth issues: rerun `onequery auth whoami`, then ask the user to refresh the
  OneQuery CLI session if needed.
- Org ambiguity: `onequery org list --page-size 25`
- Source ambiguity: `onequery source list --org <org> --page-size 25`, then
  `onequery source show <source> --org <org>`
- SQL shape issues: `onequery query validate ...`

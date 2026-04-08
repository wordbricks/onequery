# Command Patterns

Use these sequences when the user asks to query company data, inspect a
source, or investigate the OneQuery CLI surface.

## Discover The CLI Surface

```bash
onequery schema skills
onequery --help
onequery org --help
onequery source --help
onequery query exec --help
onequery query validate --help
```

Use these when command shape, read controls, or packaged guardrails are
unclear. Unlike Velen, OneQuery's OSS-safe schema surface currently exposes
`schema skills` but not `schema commands`, so subcommand `--help` is the
fallback for deeper discovery.

## Establish Context

```bash
command -v onequery
onequery auth whoami
onequery org current
onequery org list
onequery org use acme
```

Interpretation:

- `onequery auth whoami` confirms the current identity and effective org
  context.
- `onequery org current` shows whether org resolution came from `--org`,
  local config, or is unresolved.
- `onequery org list` is the recovery path when org access or org selection is
  unclear.
- Prefer `onequery --org <slug> ...` once the org is known instead of mutating
  persisted local state unless the user wants that change.

## Inspect Sources Before Querying

```bash
onequery --org acme source list
onequery --org acme source show warehouse
```

Use the source list to pick a source that matches the user's target system.
Use `source show` to confirm the canonical `source_key`, provider, status, and
query support before writing SQL.

## Validate Query Shape Before Execution

```bash
onequery --org acme query validate --source warehouse --sql "select 1"
```

Use `query validate` first when the SQL is unfamiliar, the provider dialect is
uncertain, or you want a cheap syntax and access check before execution.

## Run A Short Validation Query

```bash
onequery --org acme query exec --source warehouse --sql "select 1" --max-rows 10
```

Use this first when you want to verify auth, org, source selection, and
queryability without spending time on a large query.

## Run A Real Analysis Query

```bash
onequery --org acme query exec --source warehouse --sql "select date_trunc('day', created_at) as day, count(*) as signups from users where created_at >= current_date - interval '7 days' group by 1 order by 1 desc" --max-rows 200 --max-bytes 50000 --cell-max-chars 500
```

Guidance:

- Add explicit date bounds.
- Add `limit` where it makes sense.
- Start with aggregate checks before wide row dumps or heavy joins.
- Tailor SQL dialect to the provider shown by `onequery source show`.
- Use `--page-size`, `--max-bytes`, and `--cell-max-chars` when tighter read
  bounds materially reduce payload size.
- Use `--request-id <id>` when you want stable trace correlation across
  multiple related CLI calls.

## Use File Or Stdin For Longer SQL

```bash
onequery --org acme query validate --source warehouse --file ./analysis.sql
onequery --org acme query exec --source warehouse --file ./analysis.sql --max-rows 200
cat ./analysis.sql | onequery --org acme query exec --source warehouse --stdin
```

Prefer `--file` or `--stdin` for multi-line SQL so the query can be inspected,
revised, and rerun cleanly.

## Query Company Data

- Resolve the org first, then inspect sources in that org.
- Narrow source selection by the most relevant product name or provider before
  inspecting multiple candidates.
- Confirm the source with `onequery source show <source_key>`.
- Start with a bounded aggregate or `select 1` before wider inspection.

## Validate A Metric

- Start with the smallest aggregate or count that tests the metric definition.
- Add explicit date bounds before expanding the query.
- Prefer follow-up breakdowns only after the base aggregate looks correct.

## Work Across Orgs

```bash
onequery --org acme source list
onequery --org acme query exec --source warehouse --sql "select 1"
onequery org use acme
```

Use `--org <slug>` for one-off checks. Use `onequery org use <slug>` only when
the rest of the session should stay pinned to that org.

## Resolve Informal Source Names

- If the user gives a product name, environment, or nickname instead of a
  canonical source key, treat it as an alias to resolve.
- Prefer exact source-key or source-name matches first, then obvious prefix
  matches.
- If multiple candidate sources still fit, report the ambiguity before
  querying.

## Common Recovery Moves

```bash
onequery auth login
onequery auth import --input ./session.json
onequery org list
onequery --org acme source list
onequery --org acme source show warehouse
onequery query exec --help
```

Map failures to the smallest recovery step first:

- Auth problems: `onequery auth login` or `onequery auth import --input ...`
- Org problems: `onequery org list`
- Source lookup problems: `onequery --org <slug> source list`
- Query shape problems: `onequery query exec --help`
- Queryability problems: pick a source that supports read-only query execution

# Command Patterns

Use these sequences when the user asks to query company data, inspect a source, validate a metric, or inspect the CLI's public schema surface.

## Confirm CLI Availability

```bash
command -v oneq
```

Interpretation:

- Start here for every workflow, including schema-only discovery.

## Establish Protected Access Context

```bash
oneq auth whoami
oneq org current
oneq org list
oneq org use acme
```

Interpretation:

- `oneq auth whoami` confirms the current identity and the effective org source for
  protected commands.
- `oneq org current` shows whether org resolution came from `--org`, config, or is
  unresolved.
- `oneq org list` is the recovery path when org access or org selection is unclear.

## Inspect Sources Before Querying

```bash
oneq source list
oneq source show warehouse
```

Use the source list to pick a source where `QUERY` is `yes`. Use `source show` to confirm the canonical `source_key`, provider, and org before writing SQL.

## Run A Short Validation Query

```bash
oneq query --source warehouse --sql "select 1"
```

Use this first when you want to verify auth, org, source selection, and queryability without spending time on a large query.

## Run A Real Analysis Query

```bash
oneq query --source warehouse --sql "select date_trunc('day', created_at) as day, count(*) as signups from users where created_at >= current_date - interval '7 days' group by 1 order by 1 desc"
```

Guidance:

- Add explicit date bounds.
- Add `limit` where it makes sense.
- Start with aggregate checks before wide row dumps or heavy joins.
- Tailor SQL dialect to the provider shown by `oneq source show`.

## Use File Or Stdin For Longer SQL

```bash
oneq query --source warehouse --file ./analysis.sql
cat ./analysis.sql | oneq query --source warehouse --stdin
oneq --org acme query --source warehouse --file ./analysis.sql
```

Prefer `--file` or `--stdin` for multi-line SQL so the query can be inspected, revised, and rerun cleanly.

## Query Company Data

- Resolve the org first, then inspect sources in that org.
- Narrow source selection by the most relevant product name or provider before inspecting multiple candidates.
- Confirm the source with `oneq source show <source_key>`.
- Start with a bounded aggregate or `select 1` before wider inspection.

## Validate A Metric

- Start with the smallest aggregate or count that tests the metric definition.
- Add explicit date bounds before expanding the query.
- Prefer follow-up breakdowns only after the base aggregate looks correct.

## Inspect The CLI Schema Surface

```bash
oneq schema commands --output json
oneq schema command query execute --output json
```

Use `schema commands` to discover the current public command grammar and `schema command <path>` when you need the exact current contract for one command.
These discovery commands are available without browser auth or org setup.

## Work Across Orgs

```bash
oneq --org acme source list
oneq --org acme query --source warehouse --sql "select 1"
oneq org use acme
```

Use `--org <slug>` for one-off checks. Use `oneq org use <slug>` only when the rest of the session should stay pinned to that org.

## Resolve Informal Source Names

- If the user gives a product name, environment, or nickname instead of a canonical source key, treat it as an alias to resolve.
- Prefer exact source-key or source-name matches first, then obvious prefix matches.
- If multiple queryable sources still fit, report the ambiguity before querying.

## Common Recovery Moves

```bash
oneq auth login
oneq org list
oneq source list
oneq source show warehouse
```

Map failures to the smallest recovery step first:

- Auth problems: `oneq auth login`
- Org problems: `oneq org list`
- Source lookup problems: `oneq source list`
- Queryability problems: pick a source with `QUERY` set to `yes`

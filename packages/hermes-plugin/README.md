# OneQuery Hermes Plugin

Hermes plugin that lets Hermes Agent inspect and analyze internal company data
through the `onequery` CLI without receiving direct database credentials.

The plugin is intentionally CLI-only. Hermes calls local plugin tools, the
plugin calls `onequery` with argv-based subprocess execution, and OneQuery
enforces auth, org/source access, query validation, read-only controls, and
source API permissions, and audit history.

## Install

From the OneQuery repository:

```bash
hermes plugins install https://github.com/wordbricks/onequery.git --enable
```

From a checkout of this repository:

```bash
hermes plugins install file:///Users/dev/git/onequery --force --enable
```

Hermes installs plugins from Git repository roots. The repository root contains
a thin `plugin.yaml` and `__init__.py` wrapper so the official installer can
load the implementation in `packages/hermes-plugin`.

## Requirements

```bash
command -v onequery
onequery auth login
onequery org current
```

The plugin does not install or authenticate OneQuery for the user. It reports
missing CLI/auth/org state as structured JSON errors so Hermes can recover or
ask for the next step.

## Tools

- `onequery_status`: Check local CLI availability, auth identity, and current org.
- `onequery_list_sources`: List sources in a OneQuery org.
- `onequery_show_source`: Show provider/status/query support for one source.
- `onequery_validate_query`: Ask OneQuery to validate a SQL query.
- `onequery_execute_query`: Execute a bounded read-only SQL query with request-id tracking.
- `onequery_api_describe`: Describe a connected source API.
- `onequery_api_call`: Call a connected source API through `onequery api`.

## Demo Prompt

Inside Hermes:

```text
Load skill onequery:internal-data-analysis.

Use OneQuery to check my current org and list available sources. Do not query any source yet.
```

The examples under `examples/internal-analysis/` include a longer prompt and
expected report shape for an enterprise activation-rate investigation.

## Safety Defaults

- Direct DB credentials are never requested.
- All source access goes through OneQuery CLI.
- `org` and `source` are explicit tool parameters.
- Query execution requires `purpose` and `time_bound`.
- SQL policy, read-only validation, source API permissions, and audit behavior are owned by OneQuery.
- Query execution defaults to `maxRows=200`, `maxBytes=50000`, `cellMaxChars=500`.
- Source API calls support `dry_run`, headers, fields, request bodies over stdin, pagination controls, and `jq` selection through `onequery api`.

# OneQuery CLI Examples

Common workflows for the OneQuery CLI. Each section includes runnable commands
you can copy directly. Matching `.sh` scripts are available in this directory for
local use.

> **Prerequisites** — install the CLI before trying these examples:
>
> ```bash
> brew install wordbricks/tap/onequery    # Homebrew
> npm install -g @onequery/cli            # npm
> bun add -g @onequery/cli                # Bun
> ```
>
> Or run without installing: `npx @onequery/cli --help`

---

## Table of Contents

- [Self-Host Quickstart](#self-host-quickstart)
- [Connect Sources](#connect-sources)
- [Query Workflows](#query-workflows)
- [Org Management](#org-management)
- [Config Management](#config-management)
- [Source API](#source-api)
- [JSON Output & Scripting](#json-output--scripting)
- [Backup & Restore](#backup--restore)
- [Auto-Debug Demo](#auto-debug-demo)

---

## Self-Host Quickstart

Start a local gateway, log in, and run your first query.
([script](./01-self-host-quickstart.sh))

```bash
# Start the self-host gateway in the background (default: http://127.0.0.1:5656)
onequery gateway start

# Check that the gateway is running
onequery gateway status

# Open your browser for login and persist the session locally
onequery auth login

# Verify the session
onequery auth whoami
```

Connect a source and run a test query:

```bash
onequery source connect --source postgres \
  --input '{
    "name": "warehouse",
    "credentials": {
      "host": "localhost",
      "port": 5432,
      "database": "app",
      "username": "onequery",
      "password": "secret"
    }
  }'

onequery query exec --source warehouse --sql "SELECT 1 AS ping"
```

When you're done:

```bash
onequery gateway stop
```

---

## Connect Sources

Connect various data sources to OneQuery.
([script](./02-connect-sources.sh))

### PostgreSQL

```bash
onequery source connect --source postgres \
  --input '{
    "name": "warehouse",
    "credentials": {
      "host": "db.example.com",
      "port": 5432,
      "database": "analytics",
      "username": "readonly",
      "password": "secret"
    }
  }'
```

### Supabase

```bash
onequery source connect --source supabase \
  --input '{
    "name": "supabase-prod",
    "credentials": {
      "host": "aws-0-us-east-1.pooler.supabase.com",
      "port": 5432,
      "database": "postgres",
      "username": "postgres.xxxx",
      "password": "your-supabase-password"
    }
  }'
```

### MySQL

```bash
onequery source connect --source mysql \
  --input '{
    "name": "legacy-mysql",
    "credentials": {
      "host": "mysql.example.com",
      "port": 3306,
      "database": "orders",
      "username": "readonly",
      "password": "secret"
    }
  }'
```

### BigQuery

```bash
onequery source connect --source bigquery \
  --input '{
    "name": "bigquery-prod",
    "credentials": {
      "projectId": "my-gcp-project",
      "serviceAccountKey": "{...}"
    }
  }'
```

### GitHub

```bash
onequery source connect --source github \
  --input '{
    "name": "github-org",
    "credentials": {
      "token": "ghp_xxxxxxxxxxxx"
    }
  }'
```

### Linear

```bash
onequery source connect --source linear \
  --input '{
    "name": "linear-workspace",
    "credentials": {
      "apiKey": "lin_api_xxxxxxxxxxxx"
    }
  }'
```

List all connected sources:

```bash
onequery source list
```

---

## Query Workflows

Execute and validate queries with result controls.
([script](./03-query-workflows.sh))

### Inline SQL

```bash
onequery query exec --source warehouse \
  --sql "SELECT id, name, created_at FROM users LIMIT 10"
```

### SQL from a file

```bash
onequery query exec --source warehouse --file ./queries/active-users.sql
```

### SQL from stdin

```bash
echo "SELECT COUNT(*) AS total FROM orders WHERE status = 'completed'" \
  | onequery query exec --source warehouse --stdin
```

### Result window controls

```bash
# Cap the number of returned rows
onequery query exec --source warehouse \
  --sql "SELECT * FROM events" --max-rows 100

# Limit the total response payload size
onequery query exec --source warehouse \
  --sql "SELECT * FROM events" --max-bytes 65536

# Truncate long cell values
onequery query exec --source warehouse \
  --sql "SELECT body FROM logs" --cell-max-chars 200

# Override the query execution timeout
onequery query exec --source warehouse \
  --sql "SELECT * FROM large_table" --timeout-ms 30000
```

### Validate without executing

```bash
onequery query validate --source warehouse \
  --sql "SELECT id, email FROM users WHERE active = true"
```

### Field projection

```bash
onequery query exec --source warehouse \
  --sql "SELECT id, name FROM users LIMIT 5" --fields "rows"
```

### Full request payload from JSON

```bash
onequery query exec --source warehouse --input ./queries/complex-request.json
```

---

## Org Management

List, inspect, and switch between organizations.
([script](./04-org-management.sh))

```bash
# List available orgs
onequery org list

# Show which org this invocation will use
onequery org current

# Get detailed org info
onequery org get

# Get only specific fields
onequery org get --fields "slug,name"

# Persist a different org as the active default
onequery org use my-team

# Validate the selection without persisting
onequery org use staging-org --dry-run
```

### Per-command org override

Use `--org` to override for a single command without changing the stored default:

```bash
onequery source list --org other-team
```

### Paginated org listing

```bash
onequery org list --page-size 5
onequery org list --page-all
```

---

## Config Management

Read and persist CLI configuration.
([script](./05-config-management.sh))

### Read config values

Each key prints the resolved value from the config layering:
**built-in defaults → user config file → runtime overrides**.

```bash
onequery config get org.active
onequery config get api.server_url
onequery config get api.request_timeout_sec
```

### Persist config values

```bash
# Point the CLI at a different server
onequery config set api.server_url https://onequery.example.com

# Set a custom request timeout (in seconds)
onequery config set api.request_timeout_sec 60
```

### Per-command config overrides

Override any config key for a single invocation with `-c KEY=VALUE`:

```bash
onequery source list -c api.server_url=http://localhost:5656

onequery query exec --source warehouse \
  --sql "SELECT 1" \
  -c api.request_timeout_sec=120
```

### Per-command request timeout

The `--timeout` flag overrides `api.request_timeout_sec` for one invocation:

```bash
onequery source list --timeout 10
```

### JSON output with origin metadata

```bash
onequery config get api.server_url --output json
```

---

## Source API

Use `onequery api` for connected source APIs (e.g. GitHub, Linear).
([script](./06-source-api.sh))

### Describe available operations

```bash
onequery api --source github-org
```

### Execute a source API call

```bash
onequery api --source github-org /repos/wordbricks/onequery
```

### Explicit operation and HTTP method

```bash
onequery api --source github-org --op http_request /user/repos
onequery api --source github-org -X GET /user/repos
```

### Headers and field patches

```bash
# Custom headers
onequery api --source github-org \
  -H "Accept:application/vnd.github.v3+json" \
  /repos/wordbricks/onequery

# -f sends raw string fields, -F sends typed fields (auto-parses JSON values)
onequery api --source github-org /repos/wordbricks/onequery/issues \
  -F "per_page=5" \
  -f "state=open"
```

### Pagination

```bash
# Follow pagination tokens automatically
onequery api --source github-org /user/repos --paginate

# Combine paginated pages into one array
onequery api --source github-org /user/repos --paginate --slurp

# Cap the number of pages
onequery api --source github-org /user/repos --paginate --max-pages 3
```

### JQ expression

```bash
onequery api --source github-org /user/repos -q ".[].full_name"
```

### Other options

```bash
# Include response headers
onequery api --source github-org /user -i

# Dry run — preview without executing
onequery api --source github-org /user/repos --dry-run

# Silent — suppress body output (useful with -i for headers only)
onequery api --source github-org /user --silent -i
```

---

## JSON Output & Scripting

Machine-readable JSON output for pipelines.
([script](./07-json-output.sh))

Any command supports `--output json`. When stdout is not a TTY, JSON is the
default.

```bash
onequery auth whoami --output json
onequery org list --output json
onequery source list --output json
onequery config get api.server_url --output json
```

### Pipe to jq

```bash
onequery source list --output json | jq '.sources[].key'
onequery org list --output json | jq '.orgs[] | {slug, name}'
```

### Scripting patterns

```bash
# Check if a source exists before querying
if onequery source show warehouse --output json 2>/dev/null; then
  onequery query exec --source warehouse --sql "SELECT 1"
fi

# Iterate over sources
for key in $(onequery source list --output json | jq -r '.sources[].key'); do
  echo "Source: $key"
  onequery source show "$key" --output json
done
```

### Verbose and request ID tracing

```bash
# --verbose emits workflow tracing on stderr while keeping stdout clean
onequery query exec --source warehouse \
  --sql "SELECT 1" --output json --verbose 2>debug.log

# --request-id attaches a caller-supplied ID for audit log tracing
onequery query exec --source warehouse \
  --sql "SELECT 1" --request-id "batch-2024-01-15-001"
```

---

## Backup & Restore

Create and restore self-host backup archives.
([script](./08-backup-restore.sh))

```bash
# Create a backup (written to the standard backups directory)
onequery backup

# Include self-host secrets.toml in the archive
onequery backup --include-secrets

# Write to a specific path
onequery backup --archive-path ./backups/onequery-backup-2024-01-15.tar.gz

# Restore from a backup archive
onequery restore ./backups/onequery-backup-2024-01-15.tar.gz
```

---

## Auto-Debug Demo

An end-to-end example where an AI agent uses OneQuery to diagnose a database
error and open a GitHub pull request with the fix — all through a single
interface. Includes a minimal TODO app, setup scripts, and an agent prompt.
([full demo](./auto-debug-demo/))

#!/usr/bin/env bash
# 07-json-output.sh — Machine-readable JSON output for scripting and pipelines.
set -euo pipefail

# ── JSON output mode ─────────────────────────────────────────────────────────
# Any command supports --json for machine-readable output.
# When stdout is not a TTY, JSON is the default; use --text to force text.

onequery auth whoami --json

onequery org list --json

onequery source list --json

onequery config get api.server_url --json

# ── Pipe to jq ───────────────────────────────────────────────────────────────
# Extract specific fields from JSON output.
onequery source list --json \
  | jq '.sources[] | {source: (.provider + "://" + .sourceKey), status}'

onequery org list --json | jq '.orgs[] | {slug, name}'

# ── Scripting patterns ───────────────────────────────────────────────────────
# Check if a source exists before querying.
if onequery source show postgres://warehouse --json 2>/dev/null; then
  onequery query exec --source postgres://warehouse --sql "SELECT 1"
fi

# Iterate over sources.
for source in $(
  onequery source list --json \
    | jq -r '.sources[] | "\(.provider)://\(.sourceKey)"'
); do
  echo "Source: $source"
  onequery source show "$source" --json
done

# ── Verbose mode ─────────────────────────────────────────────────────────────
# Add --verbose to emit workflow tracing on stderr while keeping stdout clean.
onequery query exec --source postgres://warehouse \
  --sql "SELECT 1" \
  --json \
  --verbose 2>debug.log

# ── Request ID tracing ───────────────────────────────────────────────────────
# Attach a caller-supplied request ID for tracing through audit logs.
onequery query exec --source postgres://warehouse \
  --sql "SELECT 1" \
  --request-id "batch-2024-01-15-001"

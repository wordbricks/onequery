#!/usr/bin/env bash
# 07-json-output.sh — Machine-readable JSON output for scripting and pipelines.
set -euo pipefail

# ── JSON output mode ─────────────────────────────────────────────────────────
# Any command supports --json for machine-readable output.
# When stdout is not a TTY, JSON is the default.

onequery auth whoami --json

onequery org list --json

onequery source list --json

onequery config get api.server_url --json

# ── Pipe to jq ───────────────────────────────────────────────────────────────
# Extract specific fields from JSON output.
onequery source list --json | jq '.sources[].key'

onequery org list --json | jq '.orgs[] | {slug, name}'

# ── Scripting patterns ───────────────────────────────────────────────────────
# Check if a source exists before querying.
if onequery source show warehouse --json 2>/dev/null; then
  onequery query exec --source warehouse --sql "SELECT 1"
fi

# Iterate over sources.
for key in $(onequery source list --json | jq -r '.sources[].key'); do
  echo "Source: $key"
  onequery source show "$key" --json
done

# ── Verbose mode ─────────────────────────────────────────────────────────────
# Add --verbose to emit workflow tracing on stderr while keeping stdout clean.
onequery query exec --source warehouse \
  --sql "SELECT 1" \
  --json \
  --verbose 2>debug.log

# ── Request ID tracing ───────────────────────────────────────────────────────
# Attach a caller-supplied request ID for tracing through audit logs.
onequery query exec --source warehouse \
  --sql "SELECT 1" \
  --request-id "batch-2024-01-15-001"

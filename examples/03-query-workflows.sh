#!/usr/bin/env bash
# 03-query-workflows.sh — Execute and validate queries with result controls.
set -euo pipefail

SOURCE="postgres://warehouse"

# ── Inline SQL ────────────────────────────────────────────────────────────────
onequery query exec --source "$SOURCE" \
  --sql "SELECT id, name, created_at FROM users LIMIT 10"

# ── SQL from a file ──────────────────────────────────────────────────────────
onequery query exec --source "$SOURCE" \
  --file ./queries/active-users.sql

# ── SQL from stdin ───────────────────────────────────────────────────────────
echo "SELECT COUNT(*) AS total FROM orders WHERE status = 'completed'" \
  | onequery query exec --source "$SOURCE" --stdin

# ── Result window controls ───────────────────────────────────────────────────
# Cap the number of returned rows.
onequery query exec --source "$SOURCE" \
  --sql "SELECT * FROM events" \
  --max-rows 100

# Limit the total response payload size.
onequery query exec --source "$SOURCE" \
  --sql "SELECT * FROM events" \
  --max-bytes 65536

# Truncate long cell values.
onequery query exec --source "$SOURCE" \
  --sql "SELECT body FROM logs" \
  --cell-max-chars 200

# Override the query execution timeout.
onequery query exec --source "$SOURCE" \
  --sql "SELECT * FROM large_table" \
  --timeout-ms 30000

# ── Validate without executing ───────────────────────────────────────────────
# Check that a query is safe and parseable before running it.
onequery query validate --source "$SOURCE" \
  --sql "SELECT id, email FROM users WHERE active = true"

# ── Field projection ────────────────────────────────────────────────────────
# Return only specific fields from the response.
onequery query exec --source "$SOURCE" \
  --sql "SELECT id, name FROM users LIMIT 5" \
  --fields "rows"

# ── Full request payload from JSON ───────────────────────────────────────────
# Pass a complete request payload from a JSON file.
onequery query exec --source "$SOURCE" \
  --input ./queries/complex-request.json

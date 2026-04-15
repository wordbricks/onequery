#!/usr/bin/env bash
# 06-source-api.sh — Use `onequery api` for connected source APIs.
set -euo pipefail

# ── Describe a source API ────────────────────────────────────────────────────
# Without a target, `onequery api` describes the available operations.
onequery api --source github-org

# ── Execute a source API call ────────────────────────────────────────────────
# Pass a target to execute an operation.
onequery api --source github-org /repos/wordbricks/onequery

# ── Explicit operation ───────────────────────────────────────────────────────
onequery api --source github-org --op http_request /user/repos

# ── HTTP method override ─────────────────────────────────────────────────────
onequery api --source github-org -X GET /user/repos

# ── Custom headers ───────────────────────────────────────────────────────────
onequery api --source github-org \
  -H "Accept:application/vnd.github.v3+json" \
  /repos/wordbricks/onequery

# ── Field patches ────────────────────────────────────────────────────────────
# -f sends raw string fields, -F sends typed fields (auto-parses JSON values).
onequery api --source github-org /repos/wordbricks/onequery/issues \
  -F "per_page=5" \
  -f "state=open"

# ── Request body from file ───────────────────────────────────────────────────
onequery api --source github-org --op http_request /user/repos \
  --input ./payload.json

# ── Pagination ───────────────────────────────────────────────────────────────
# Follow pagination tokens automatically.
onequery api --source github-org /user/repos --paginate

# Combine paginated pages into one array.
onequery api --source github-org /user/repos --paginate --slurp

# Cap the number of pages followed.
onequery api --source github-org /user/repos --paginate --max-pages 3

# ── JQ expression ────────────────────────────────────────────────────────────
# Apply a JSON selection expression to the response.
onequery api --source github-org /user/repos \
  -q ".[].full_name"

# ── Include response headers ─────────────────────────────────────────────────
onequery api --source github-org /user -i

# ── Dry run ──────────────────────────────────────────────────────────────────
# Preview the request without executing it.
onequery api --source github-org /user/repos --dry-run

# ── Silent mode ──────────────────────────────────────────────────────────────
# Suppress body output (useful with -i to see headers only).
onequery api --source github-org /user --silent -i

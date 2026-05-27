#!/usr/bin/env bash
# 01-self-host-quickstart.sh — Start a local gateway, log in, and run your first query.
set -euo pipefail

# ── 1. Start the self-host gateway ────────────────────────────────────────────
# Launch the bundled server in the background. The default listen address is
# http://127.0.0.1:5656.
onequery gateway start

# Check that the gateway is running.
onequery gateway status

# ── 2. Authenticate ──────────────────────────────────────────────────────────
# Opens your browser for login and persists the session locally.
onequery auth login

# Verify the session.
onequery auth whoami

# ── 3. Connect a source ──────────────────────────────────────────────────────
# Connect a local Postgres database as a source named "warehouse".
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

# ── 4. Run a query ───────────────────────────────────────────────────────────
# Execute a simple test query against the connected source.
onequery query exec --source postgres://warehouse --sql "SELECT 1 AS ping"

# ── 5. Stop the gateway ──────────────────────────────────────────────────────
onequery gateway stop

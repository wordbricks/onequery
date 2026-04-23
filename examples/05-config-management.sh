#!/usr/bin/env bash
# 05-config-management.sh — Read and persist CLI configuration.
set -euo pipefail

# ── Read config values ───────────────────────────────────────────────────────
# Each key prints the resolved value from the config layering:
# built-in defaults -> user config file -> runtime overrides.

# Show the active org slug.
onequery config get org.active

# Show the server URL.
onequery config get api.server_url

# Show the request timeout in seconds.
onequery config get api.request_timeout_sec

# ── Persist config values ────────────────────────────────────────────────────
# Point the CLI at a different server.
onequery config set api.server_url https://onequery.example.com

# Set a custom request timeout (in seconds).
onequery config set api.request_timeout_sec 60

# ── Per-command config overrides ─────────────────────────────────────────────
# Override any config key for a single invocation with -c KEY=VALUE.
onequery source list -c api.server_url=http://localhost:5656

# Multiple overrides.
onequery query exec --source warehouse \
  --sql "SELECT 1" \
  -c api.request_timeout_sec=120

# ── Per-command request timeout ──────────────────────────────────────────────
# The --timeout flag overrides api.request_timeout_sec for one invocation.
onequery source list --timeout 10

# ── Config in JSON mode ─────────────────────────────────────────────────────
# JSON output includes origin metadata (which layer set the value).
onequery config get api.server_url --json

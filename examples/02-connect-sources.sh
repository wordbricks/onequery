#!/usr/bin/env bash
# 02-connect-sources.sh — Connect various data sources to OneQuery.
set -euo pipefail

# ── PostgreSQL ────────────────────────────────────────────────────────────────
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

# ── Supabase ──────────────────────────────────────────────────────────────────
onequery source connect --source supabase \
  --input '{
    "name": "supabase-prod",
    "credentials": {
      "host": "db.xxxx.supabase.co",
      "port": 5432,
      "database": "postgres",
      "username": "postgres",
      "password": "your-supabase-password"
    }
  }'

# ── MySQL ─────────────────────────────────────────────────────────────────────
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

# ── BigQuery ──────────────────────────────────────────────────────────────────
# BigQuery uses a service account key JSON for authentication.
onequery source connect --source bigquery \
  --input '{
    "name": "bigquery-prod",
    "credentials": {
      "projectId": "my-gcp-project",
      "serviceAccountKey": "{...}"
    }
  }'

# ── GitHub ────────────────────────────────────────────────────────────────────
onequery source connect --source github \
  --input '{
    "name": "github-org",
    "credentials": {
      "token": "ghp_xxxxxxxxxxxx"
    }
  }'

# ── Linear ────────────────────────────────────────────────────────────────────
onequery source connect --source linear \
  --input '{
    "name": "linear-workspace",
    "credentials": {
      "apiKey": "lin_api_xxxxxxxxxxxx"
    }
  }'

# ── List all connected sources ────────────────────────────────────────────────
onequery source list

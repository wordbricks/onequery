#!/usr/bin/env bash
# 04-org-management.sh — List, inspect, and switch between organizations.
set -euo pipefail

# ── List available orgs ──────────────────────────────────────────────────────
onequery org list

# ── Inspect the current org ──────────────────────────────────────────────────
# Show which org this invocation will use.
onequery org current

# ── Get detailed org info ────────────────────────────────────────────────────
onequery org get

# Get only specific fields.
onequery org get --fields "slug,name"

# ── Switch the active org ────────────────────────────────────────────────────
# Persist a different org as the active default.
onequery org use my-team

# Validate the selection without persisting.
onequery org use staging-org --dry-run

# ── Per-command org override ─────────────────────────────────────────────────
# Use a different org for a single command without changing the stored default.
onequery source list --org other-team

# ── Paginated org listing ────────────────────────────────────────────────────
# Control page size and use cursors for large org lists.
onequery org list --page-size 5
onequery org list --page-all

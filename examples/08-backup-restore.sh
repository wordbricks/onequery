#!/usr/bin/env bash
# 08-backup-restore.sh — Create and restore self-host backup archives.
set -euo pipefail

# ── Create a backup ──────────────────────────────────────────────────────────
# Creates a backup archive of the current self-host runtime state.
# By default the archive is written to the standard backups directory.
onequery backup

# ── Include secrets ──────────────────────────────────────────────────────────
# Include self-host secrets.toml in the backup archive.
onequery backup --include-secrets

# ── Custom archive path ──────────────────────────────────────────────────────
# Write the archive to a specific location.
onequery backup --archive-path ./backups/onequery-backup-2024-01-15.tar.gz

# ── Restore from a backup ───────────────────────────────────────────────────
# Restore self-host runtime state from a backup archive.
onequery restore ./backups/onequery-backup-2024-01-15.tar.gz

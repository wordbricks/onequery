#!/usr/bin/env bash
# setup.sh — Bootstrap the auto-debug demo environment.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

: "${GITHUB_TOKEN:?Set GITHUB_TOKEN to a GitHub PAT with repo scope}"

echo "=== 1. Start demo database ==="
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d --wait

echo "=== 2. Initialize schema and seed data ==="
PGPASSWORD=demo_secret psql -h localhost -p 5480 -U demo -d demo_app \
  -f "$SCRIPT_DIR/src/schema.sql"
PGPASSWORD=demo_secret psql -h localhost -p 5480 -U demo -d demo_app \
  -f "$SCRIPT_DIR/src/seed.sql"

echo "=== 3. Install dependencies and start the demo app ==="
cd "$SCRIPT_DIR" && bun install && bun run src/index.ts &
sleep 2

echo "=== 4. Ensure OneQuery gateway is running ==="
onequery gateway status 2>/dev/null || onequery gateway start

echo "=== 5. Connect PostgreSQL source ==="
onequery source connect --source postgres \
  --input '{
    "name": "demo-app-db",
    "credentials": {
      "host": "localhost",
      "port": 5480,
      "database": "demo_app",
      "username": "demo",
      "password": "demo_secret"
    }
  }'

echo "=== 6. Connect GitHub source ==="
onequery source connect --source github \
  --input "{
    \"name\": \"demo-github\",
    \"credentials\": {
      \"token\": \"$GITHUB_TOKEN\"
    }
  }"

echo ""
echo "Setup complete."
echo "  - Demo app:  http://localhost:3456/health"
echo "  - DB source: demo-app-db"
echo "  - GH source: demo-github"
echo ""
echo "Next: run ./agent-workflow.sh or paste agent-prompt.md into Claude Code."

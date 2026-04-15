#!/usr/bin/env bash
# setup.sh — Bootstrap the auto-debug demo environment.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
APP_LOG="$SCRIPT_DIR/demo-app.log"
APP_URL="http://127.0.0.1:3456/health"
APP_PID=""

: "${GITHUB_TOKEN:?Set GITHUB_TOKEN to a GitHub PAT with repo scope}"

run_psql_file() {
  local sql_file="$1"
  docker compose -f "$COMPOSE_FILE" exec -T demo-db \
    psql -v ON_ERROR_STOP=1 -U demo -d demo_app < "$sql_file"
}

wait_for_demo_app() {
  local max_attempts=20
  local attempt

  for ((attempt = 1; attempt <= max_attempts; attempt++)); do
    if ! kill -0 "$APP_PID" 2>/dev/null; then
      echo "Demo app exited before becoming ready. See $APP_LOG for details."
      tail -n 40 "$APP_LOG" || true
      return 1
    fi

    if APP_URL="$APP_URL" bun --eval '
      try {
        const response = await fetch(process.env.APP_URL);
        if (!response.ok) process.exit(1);
      } catch {
        process.exit(1);
      }
    ' >/dev/null 2>&1; then
      return 0
    fi

    sleep 1
  done

  echo "Demo app did not become ready within ${max_attempts}s. See $APP_LOG for details."
  kill "$APP_PID" 2>/dev/null || true
  tail -n 40 "$APP_LOG" || true
  return 1
}

echo "=== 1. Start demo database ==="
docker compose -f "$COMPOSE_FILE" up -d --wait

echo "=== 2. Initialize schema and seed data ==="
run_psql_file "$SCRIPT_DIR/src/schema.sql"
run_psql_file "$SCRIPT_DIR/src/seed.sql"

echo "=== 3. Install dependencies and start the demo app ==="
cd "$SCRIPT_DIR"
bun install
bun run src/index.ts >"$APP_LOG" 2>&1 &
APP_PID=$!
wait_for_demo_app

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
echo "  - App log:   $APP_LOG"
echo "  - DB source: demo-app-db"
echo "  - GH source: demo-github"
echo ""
echo "Next: paste agent-prompt.md into Claude Code or OpenClaw."

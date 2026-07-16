#!/usr/bin/env bash
# Launch Claude Control Panel: start the dev server if it isn't already running,
# wait for it to come up, then open the dashboard in the default browser.
set -euo pipefail

# project root = parent of this script's directory (portable, no hardcoded path)
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
URL="http://localhost:5173"
LOG="/tmp/claude-control-panel.log"

is_up() { curl -fsS -o /dev/null --max-time 2 "$URL" 2>/dev/null; }

if ! is_up; then
  cd "$PROJECT_DIR"
  # detach fully so the server keeps running after this script (and terminal) exit
  setsid nohup npm run dev >"$LOG" 2>&1 &
  # wait up to ~30s for Vite to be ready
  for _ in $(seq 1 60); do
    is_up && break
    sleep 0.5
  done
fi

xdg-open "$URL" >/dev/null 2>&1 || true

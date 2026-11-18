#!/usr/bin/env bash
# Starts the shared backend proxy quietly in the background, then runs Expo
# in the foreground with its real terminal attached.
#
# Why not just use `concurrently` for both? Because concurrently pipes each
# child process's stdout through itself to add the "[proxy]"/"[metro]"
# prefixes, and that pipe makes Expo think it isn't running in an
# interactive terminal. Expo checks for that before deciding whether to
# render the QR code and enable the r/i/a keyboard shortcuts — under
# concurrently it silently disables all of that. Running Expo directly here
# keeps it attached to the real terminal so the QR code actually shows up.
set -e

cd "$(dirname "$0")/.."

LOG_FILE="./.proxy.log"
npm --prefix ../stockroom-website run dev > "$LOG_FILE" 2>&1 &
PROXY_PID=$!

cleanup() {
  kill "$PROXY_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "Backend proxy starting in the background (log: $LOG_FILE)…"
echo ""

npx expo start

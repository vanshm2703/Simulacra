#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  trap - EXIT INT TERM HUP
  echo ""
  echo "Shutting down…"
  # Gracefully stop tracked children
  for pid in $BACKEND_PID $FRONTEND_PID; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  # Brief wait for graceful shutdown
  sleep 1
  # Force-kill anything still holding our ports
  for port in 3000 8000; do
    pids=$(lsof -ti :"$port" 2>/dev/null) || true
    if [ -n "$pids" ]; then
      echo "Killing leftover processes on :$port (PIDs: $pids)"
      echo "$pids" | xargs kill -9 2>/dev/null || true
    fi
  done
  exit 0
}
trap cleanup EXIT INT TERM HUP

echo "Starting backend on :8000 …"
(cd "$ROOT/backend" && uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000) &
BACKEND_PID=$!

echo "Starting frontend on :3000 …"
(cd "$ROOT/frontend" && bun dev) &
FRONTEND_PID=$!

# Wait for either to exit — cleanup handles the rest
wait

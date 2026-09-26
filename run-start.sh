#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  trap - EXIT INT TERM HUP
  echo ""
  echo "Shutting down…"
  for pid in $BACKEND_PID $FRONTEND_PID; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  sleep 1
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

echo "Building frontend… (this may take ~30s)"
(cd "$ROOT/frontend" && bun run build) || { echo "Frontend build failed — aborting."; exit 1; }
echo "Frontend build complete."

echo "Starting backend on :8000…"
(cd "$ROOT/backend" && uv run uvicorn main:app --host 0.0.0.0 --port 8000) &
BACKEND_PID=$!

echo "Starting frontend on :3000…"
(cd "$ROOT/frontend" && bun run start) &
FRONTEND_PID=$!

echo ""
echo "SIMULACRA running:"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop."

wait

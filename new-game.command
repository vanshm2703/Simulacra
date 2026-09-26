#!/usr/bin/env bash
# Start a fresh match (double-click in Finder, or run ./new-game.command).
# Restarts only the sim worker; the website + backend keep running.
# Options: SIM_ROUNDS=5 ./new-game.command
set -euo pipefail

export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! lsof -iTCP:8000 -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  echo "✗ The game server isn't running. Start everything first with ./run-city.sh"
  read -r -p "Press Enter to close…" _ || true
  exit 1
fi

echo "▸ stopping the old match…"
pkill -f "python[0-9.]* sim_worker\.py$" 2>/dev/null || true
sleep 1

echo "▸ starting a new match (${SIM_ROUNDS:-3} rounds)…"
cd "$ROOT/backend"
SIM_ROUNDS="${SIM_ROUNDS:-3}" SIM_CRISIS_START="${SIM_CRISIS_START:-0}" \
SIM_ROUND_SECONDS="${SIM_ROUND_SECONDS:-25}" \
  nohup uv run python sim_worker.py >/tmp/simulacra-worker.log 2>&1 &
disown

for _ in $(seq 30); do
  if grep -q "round 0" /tmp/simulacra-worker.log 2>/dev/null; then
    echo "✓ New game started! Refresh http://localhost:3000/city and claim a role."
    sleep 3
    exit 0
  fi
  sleep 1
done
echo "✗ The new game didn't start. Last lines of the log:"
tail -5 /tmp/simulacra-worker.log
read -r -p "Press Enter to close…" _ || true

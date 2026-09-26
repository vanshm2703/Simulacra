#!/usr/bin/env bash
# Launch the multiplayer "playable city" stack (MongoDB edition):
#   1. local LLM server   (mlx_lm.server on :8080, if not already running; skip with SIM_ENGINE=scripted)
#   2. FastAPI backend    (:8000 — REST + /city/ws live socket, reads/writes MongoDB)
#   3. Python sim worker  (seeds + drives rounds into MongoDB)
#   4. Next.js frontend   (open http://localhost:3000/city)
#
# MongoDB itself is not started here: set MONGODB_URI in backend/.env (Atlas or local).
# Logs go to /tmp/simulacra-*.log. Ctrl-C stops everything started here.
set -euo pipefail

export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MLX_VENV="${MLX_VENV:-$HOME/mlx-server/.venv}"
LLM_MODEL="${LLM_MODEL:-prism-ml/Ternary-Bonsai-27B-mlx-2bit}"
PIDS=()

# 1. local model server (skipped when backend/.env points LLM_BASE_URL at another machine)
LLM_BASE_URL="${LLM_BASE_URL:-$(grep -E '^LLM_BASE_URL=' "$ROOT/backend/.env" 2>/dev/null | cut -d= -f2-)}"
if [ -n "$LLM_BASE_URL" ] && [[ "$LLM_BASE_URL" != *127.0.0.1* && "$LLM_BASE_URL" != *localhost* ]]; then
  echo "▸ using remote model server at $LLM_BASE_URL"
elif [ "${SIM_ENGINE:-llm}" != "scripted" ]; then
  if ! lsof -iTCP:8080 -sTCP:LISTEN -n -P >/dev/null 2>&1; then
    echo "▸ starting local model server ($LLM_MODEL) on :8080…"
    "$MLX_VENV/bin/mlx_lm.server" --model "$LLM_MODEL" --host 127.0.0.1 --port 8080 \
      >/tmp/simulacra-llm.log 2>&1 &
    PIDS+=($!)
  else
    echo "▸ model server already running on :8080"
  fi
fi

# 2. backend (REST + /city/ws)
if ! lsof -iTCP:8000 -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  echo "▸ starting backend on :8000…"
  ( cd "$ROOT/backend" && uv run uvicorn main:app --host 0.0.0.0 --port 8000 >/tmp/simulacra-api.log 2>&1 ) &
  PIDS+=($!)
fi

# 3. worker  (uv run → LangChain deps available; SIM_ENGINE=llm by default)
echo "▸ starting sim worker…"
( cd "$ROOT/backend" && \
  SIM_ROUNDS="${SIM_ROUNDS:-3}" SIM_CRISIS_START="${SIM_CRISIS_START:-0}" SIM_ROUND_SECONDS="${SIM_ROUND_SECONDS:-25}" \
  uv run python sim_worker.py >/tmp/simulacra-worker.log 2>&1 ) &
PIDS+=($!)

# 4. frontend
echo "▸ starting Next.js (http://localhost:3000/city)…"
( cd "$ROOT/frontend" && bun dev >/tmp/simulacra-web.log 2>&1 ) &
PIDS+=($!)

trap 'echo; echo "stopping…"; kill "${PIDS[@]}" 2>/dev/null || true' INT TERM

echo
echo "✓ stack up. Open http://localhost:3000/city  (open it in several tabs to play together)"
echo "  logs: /tmp/simulacra-{llm,api,worker,web}.log"
wait

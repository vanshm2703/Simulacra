# SIMULACRA — Agent Instructions

## Package Managers
- **Frontend**: Bun — `bun install`, `bun dev`, `bun build`
- **Backend**: uv — `uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000`

## File-Scoped Commands
| Task | Command |
|------|---------|
| Lint | `cd frontend && bun lint` |
| Format | `cd frontend && bun format` |
| Backend tests | `cd backend && uv run pytest` |

## Key Conventions
- **Phaser client-only**: wrap in `next/dynamic` with `ssr: false`; page must be `"use client"`
- **Linting**: Biome 2.2.0 — not ESLint. Rules live in `frontend/biome.json`
- **EventBridge**: singleton in `src/game/bridge/` bridges React ↔ Phaser via `sim:*` events
- **LLM model**: any OpenAI-compatible server via `LLM_BASE_URL`/`LLM_MODEL` in `backend/.env` (default: local `mlx_lm.server` serving `prism-ml/Ternary-Bonsai-27B-mlx-2bit` on :8080)
- **Database**: MongoDB (`MONGODB_URI`, `MONGODB_DB`) — multiplayer city state lives in `backend/services/mongo_store.py`; browsers get live updates over `WS /city/ws` (`backend/routers/city.py`)
- **Next.js 16**: has breaking changes — read `node_modules/next/dist/docs/` before using unfamiliar APIs

## Environment Variables
```
MONGODB_URI=mongodb://127.0.0.1:27017   # or mongodb+srv://... (Atlas)
MONGODB_DB=simulacra
LLM_BASE_URL=http://127.0.0.1:8080/v1
LLM_MODEL=prism-ml/Ternary-Bonsai-27B-mlx-2bit
LLM_API_KEY=local
```

## Project Layout
```
frontend/src/
  components/    # UI: ChatBubble, Dashboard, EventFeed, GameCanvas, NPCProfileModal, PolicyInput
  game/          # Phaser: scenes/, systems/, effects/, entities/, bridge/, map/
  hooks/         # useSimulation (WebSocket)
  services/      # wsClient
  types/         # index.ts (frontend types), backend.ts (backend types)
backend/
  graph/nodes/   # parse_policy, npc_orchestrator, run_round
  routers/       # simulate.py — POST /simulate + WebSocket /simulate/{id}/ws
```

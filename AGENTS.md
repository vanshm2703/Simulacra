# Repository Guidelines

## Project Structure

- `frontend/`: Next.js 16 (App Router) + Phaser client game.
  - Source: `frontend/src/` (`app/`, `components/`, `game/`, `hooks/`, `services/`).
  - Assets: `frontend/public/` (tilemaps/tilesets live under `public/assets/`).
  - Frontend tests: colocated `*.test.ts` / `*.test.tsx` under `frontend/src/`.
- `backend/`: FastAPI + LangGraph simulation service.
  - Entry point: `backend/main.py`; config in `backend/config.py`.
  - Graph: `backend/graph/`; API routes in `backend/routers/`.
  - Backend tests: `backend/tests/` (pytest).
- Docs/design notes: `README.md`, `design.md`, `proposal.md`.

## Build, Test, and Development Commands

- Run both servers: `./run.sh` (frontend `:3000`, backend `:8000`).
- Backend:
  - Install deps: `cd backend && uv sync`
  - Dev server: `cd backend && uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000`
  - Tests: `cd backend && uv run pytest`
- Frontend:
  - Install deps: `cd frontend && bun install`
  - Dev server: `cd frontend && bun dev`
  - Lint/format: `cd frontend && bun lint` / `cd frontend && bun format`
  - Tests: `cd frontend && bunx vitest`

## Coding Style & Naming Conventions

- TypeScript/React: Biome is the source of truth (`frontend/biome.json`) with 2-space indentation; keep files `PascalCase.tsx` for components and `camelCase.ts` for utilities.
- Python: follow standard 4-space indentation; keep API/Pydantic types in `backend/models/` and orchestration logic in `backend/graph/`.
- Prefer small, testable modules; avoid cross-layer imports (frontend doesn’t import from `backend/`).

## Testing Guidelines

- Backend: pytest (`backend/tests/test_*.py`). Use `pytest-asyncio` for async code.
- Frontend: Vitest (`*.test.ts(x)`), colocated near the module under test.

## Commit & Pull Request Guidelines

- Commits generally follow a lightweight Conventional-Commits style: `feat: ...`, `fix: ...`, `design: ...` (keep the subject imperative and scoped).
- PRs: include a short summary, how to test (commands + expected result), and screenshots/gifs for UI changes. Link related issues and call out any env var changes.

## Security & Configuration

- Never commit secrets. Use `backend/.env.local` for API keys (ignored by `.gitignore`).
- Keep logs free of credentials and user-provided policy text unless required for debugging.

> **Superseded:** the SpacetimeDB layer described below has been replaced by MongoDB (`backend/services/mongo_store.py`, `backend/routers/city.py`, `frontend/src/services/cityConnection.tsx`). Kept for history.

# Simulacra → SpacetimeDB "Playable City" — Change List

> **STATUS: built & validated end-to-end (2026-05-30).** Module + worker + frontend
> all done. Run with `./run-city.sh`, then open http://localhost:3000/city.
> See "Run it" and "What was built" at the bottom.

**Goal:** Turn the single-player policy sim into a multiplayer game where humans
**claim roles** (seats) in the city and shape a **shared, live economy** alongside
the LLM. Unclaimed seats are driven by the existing LangGraph engine.

**Target:** SpacetimeDB Launchpad Hackathon (NYC Tech Week, Jun 5–7) — "best
multiplayer / collaborative real-time app on SpacetimeDB."

---

## Architecture decision (MVP-first)

SpacetimeDB becomes the **source of truth + transport + multiplayer layer**.
The Python LangGraph engine stays, but becomes a **headless "sim worker"** that
connects to SpacetimeDB as a client.

```
 Browsers (N players) ──TS SDK──▶  SpacetimeDB module (Rust)  ◀──Python SDK── LangGraph worker
   - subscribe to tables             - tables (world state)        - reads state + queued human actions
   - call reducers (claim/act)       - reducers (claim/act/apply)  - runs LLM for EMPTY seats
   - Phaser renders from rows        - round timer / tick          - writes round result via reducers
```

Key choice: **economic resolution + LLM reasoning stay in Python.** Rust reducers
are mostly state writers + claim/action bookkeeping. This minimizes the rewrite —
we are NOT porting the LangGraph cascade logic into Rust.

---

## A. NEW — SpacetimeDB module (Rust)  `/stdb/`

- [ ] `stdb/` crate scaffolded via `spacetime init --lang rust`.
- [ ] **Tables** (mirror existing `SimulationRecord` / `BackendNPC`):
  - [ ] `world` — singleton: `current_round`, `max_rounds`, `phase`, `status`, `policy_text`, `round_deadline`
  - [ ] `agent` — id, name, role, bio/persona, x, y, mood, income_level, political_leaning, `controlled_by: Option<Identity>` ← **the whole game**
  - [ ] `relationship` — src, dst, type, weight
  - [ ] `event` — round, agent_id, event_type, message, data(json)
  - [ ] `indicator` — key, value (price_index, unemployment, social_unrest, gov_approval, interest_rate)
  - [ ] `player` — identity, display_name, last_seen (presence)
  - [ ] `seat_claim` — agent_id, player_identity (claim/release)
  - [ ] `pending_action` — agent_id, player_identity, lever, value, round (human action queue)
  - [ ] `chat_message` — agent_id, author (player|agent), text, round (shared, not ephemeral)
- [ ] **Reducers:**
  - [ ] `register_player(name)` / `heartbeat()` — presence
  - [ ] `claim_seat(agent_id)` / `release_seat(agent_id)` — set/clear `controlled_by` (reject if taken)
  - [ ] `submit_action(agent_id, lever, value)` — validate caller owns seat → insert `pending_action`
  - [ ] `apply_round(json blob)` — **worker-only**: bulk upsert agents/events/indicators, bump round, set new `round_deadline`
  - [ ] `post_chat(agent_id, text)` — append to `chat_message`
  - [ ] `seed_world(policy_text, agents, relationships)` — worker init
  - [ ] `tick()` (scheduled) — close the round window when `round_deadline` passes (optional v2; worker can drive timing instead)
- [ ] `disconnect` handler → auto `release_seat` for that identity.
- [ ] `spacetime generate --lang typescript` → frontend bindings; (optional) python bindings.

## B. BACKEND (Python) — turn the sim into a SpacetimeDB worker

- [ ] Add SpacetimeDB Python client dep to `backend/pyproject.toml`.
- [ ] **New** `backend/services/stdb_worker.py`:
  - [ ] connect to SpacetimeDB, subscribe to `world`, `agent`, `pending_action`, `seat_claim`
  - [ ] on new sim: build NPCs (reuse `generate_npcs`) → `seed_world(...)`
  - [ ] **round loop:** wait for round window → gather `pending_action` rows (human seats) + run LangGraph **only for `controlled_by IS NULL` agents** → merge → call `apply_round(blob)`
- [ ] **Refactor `routers/simulate.py`:**
  - [ ] **Remove** Socket.IO `sio` + per-`sid` emits + the in-memory `simulations` dict as the live channel
  - [ ] `/simulate` POST → kick off the worker for a world instead of holding state in RAM
  - [ ] Keep `generate_economic_report` (read final state from SpacetimeDB instead of `record`)
  - [ ] Move `chat_with_npc` → `post_chat` reducer (shared log)
- [ ] **Modify `graph/nodes/run_round.py`** (and `run_round_swarm.py`): accept a set of
      "skip these agent_ids (human-controlled)" + apply queued human actions as inputs.
- [ ] **`backend/main.py`:** drop the `socketio.ASGIApp` mount; FastAPI keeps only REST
      (`/simulate`, `/context`, `/extract`, `/economic-report`).

## C. FRONTEND (Next.js) — subscribe to SpacetimeDB + role UI

- [ ] Add `@clockworklabs/spacetimedb-sdk` to `frontend/package.json`; drop `socket.io-client`.
- [ ] **New** `frontend/src/services/stdbClient.ts` — connect, register player, expose
      reducer callers (`claimSeat`, `releaseSeat`, `submitAction`, `postChat`).
- [ ] **Rewrite `hooks/useSimulation.ts`** to be subscription-driven:
  - [ ] replace `connectSimulation(...)` + `WSCallbacks` with SpacetimeDB table subscriptions
  - [ ] on `agent`/`event`/`indicator` row insert/update → feed the **existing EventBridge**
        (`emitNPCMove`, `emitNPCMood`, `emitSimEvent`, `emitInitNPCs`) — bridge stays unchanged
  - [ ] derive `graphData`, `metrics`, `setupProgress` from rows instead of WS messages
- [ ] **`services/wsClient.ts`** — delete (or keep mock path only).
- [ ] **New UI components:**
  - [ ] `SeatPicker` — list roles, show claimed/free + who holds them, claim/release buttons
  - [ ] `ActionPanel` — for your claimed seat, the levers (e.g. Central Bank → interest-rate slider; Corp → price/hire; Union → strike) → `submitAction`
  - [ ] `RoundTimer` — countdown to `round_deadline` from `world` row
  - [ ] `PresenceBar` — who's online (from `player` table)
  - [ ] make `NPCChatModal` read/write the shared `chat_message` table
- [ ] **`types/backend.ts`** — replace WS message types with generated SpacetimeDB row types
      (keep `BackendNPC`/`BackendRole` shapes where the bindings differ via a thin adapter in `lib/adapter.ts`).

## D. GAMEPLAY logic (new design surface)

- [ ] **Seat = agent** with `controlled_by`. Define which roster roles are "playable
      seats" (Gov, Central Bank, Corp CEO, Union, Media, a few Households).
- [ ] **Lever schema** per role (what `submit_action` accepts) — small enum + value.
- [ ] **Round cadence:** fixed window (e.g. 30s). Humans submit within window; worker
      fills empty seats with LLM; `apply_round` resolves; repeat.
- [ ] **(Stretch)** per-role win condition / score (Gov approval >30%, Corp max profit, …).

## E. INFRA / SETUP

- [ ] Install SpacetimeDB CLI; `spacetime start` (local) for dev.
- [ ] `stdb/` build + `spacetime publish simulacra` to local instance.
- [ ] Codegen step wired into `run.sh` (`spacetime generate --lang typescript -o frontend/src/module_bindings`).
- [ ] `.env`: `NEXT_PUBLIC_STDB_URL`, `STDB_DB_NAME`; worker needs STDB address + LLM keys (existing).
- [ ] Update `run.sh` / `docker-compose.dev.yml`: 3 processes — spacetimedb, python worker, next dev.

---

## MVP cut line (what must ship to win)

**Day 1 (Fri night):** A. tables + `claim_seat`/`submit_action`/`apply_round` reducers;
  B. minimal worker that seeds a world + runs rounds writing to SpacetimeDB.
**Day 2 (Sat):** C. frontend subscribes & renders city from rows (multiplayer spectating works);
  SeatPicker + ActionPanel so a human can claim a seat and pull one lever that visibly
  changes the city on **all** screens. ← **this is the demo that wins.**
**Day 2 night / Day 3:** RoundTimer, PresenceBar, shared chat, polish, win conditions.

**Non-negotiable core:** claim seat → submit action → shared subscription updates every
client live, with AI filling empty seats. Everything else is stretch.

## Hard risks
- LangGraph + SpacetimeDB Python client interplay (async). Mitigate: worker is a plain
  async loop; SpacetimeDB calls are fire-and-forget reducers.
- Round pacing with humans + LLM latency → fixed timed window, cap seats ~8–12.
- Rust module learning curve → keep reducers dumb (CRUD); all "smarts" stay in Python.

---

## Run it

```bash
./run-city.sh            # starts SpacetimeDB + publishes + worker + Next
# open http://localhost:3000/city  (open in several tabs / phones to play together)
./run-city.sh --fresh    # also wipes existing world data first
```

Pieces individually:
```bash
scripts/stdb-publish.sh [--fresh]                 # build module, publish local, regen TS bindings
cd backend && python3 sim_worker.py               # the sim worker (env: SIM_ROUNDS, SIM_ROUND_SECONDS, SIM_POLICY)
cd frontend && bun dev                            # the web app
cd frontend && bun scripts/stdb-smoketest.ts      # headless multiplayer smoke test (no browser needed)
```

## What was built (all validated)

- **`stdb/spacetimedb/`** — Rust SpacetimeDB module. Tables: `world, config, agent,
  relationship, sim_event, indicator, player, pending_action, chat_message`.
  Reducers: `claim_seat, release_seat, submit_action, post_chat, seed_world,
  open_round, apply_round, post_agent_chat, set_worker, register_player, heartbeat`,
  plus connect/disconnect (auto-releases seats). `agent.controlled_by` is the game:
  set = human drives the seat, null = the LLM/engine does.
- **`backend/services/stdb_client.py`** — stdlib HTTP client (reducer calls + SQL reads,
  decodes SpacetimeDB row encodings).
- **`backend/sim_worker.py`** — headless worker: registers, seeds the roster, runs the
  round loop (open window → read human `pending_action` → resolve → `apply_round`).
  `ScriptedEngine` is a dependency-free economic cascade that honors human levers;
  swap in a `LangGraphEngine` later for LLM resolution.
- **`frontend/src/module_bindings/`** — generated TS bindings (`spacetime generate`).
- **`frontend/src/services/stdbConnection.ts`**, **`lib/stdbAdapt.ts`**,
  **`hooks/useStdbCity.ts`** — connect, adapt rows → existing types, feed the Phaser
  EventBridge + derive metrics/graph/feed.
- **`frontend/src/components/`** — `SeatPicker`, `ActionPanel`, `RoundTimer`, `PresenceBar`.
- **`frontend/src/app/city/page.tsx`** — the multiplayer route (reuses GameCanvas/
  Dashboard/EventFeed/SocialGraph unchanged).

### Validation performed
- Module builds; all reducers exercised via CLI + HTTP.
- Worker drives a full multi-round cascade into SpacetimeDB (agents, events, indicators).
- **Real SDK smoke test**: a client connects, claims a seat (persists while connected),
  submits `interest_rate=9.5` → worker honors it (rate → 9.50%, unemployment rises,
  prices cool) → broadcast back live; on disconnect the seat auto-releases. Two players
  shown in presence.
- `/`, `/city`, `/simulate` all serve 200; full project `tsc --noEmit` clean.

### Note on the original repo
`frontend` was missing platform-native optional deps (`lightningcss-darwin-arm64`,
`@tailwindcss/oxide-darwin-arm64`) — a known bun/Turbopack gap that 500'd every route.
Fixed by a clean `bun install` (removed stale `package-lock.json`).

### LLM engine (DONE)
`sim_worker.py` now has a **`LangGraphEngine`** (K2-Think via `graph.llm.invoke_llm_json`)
that is the default resolution engine (`SIM_ENGINE=llm`, auto-selected when the LLM
stack + `K2_API_KEY` are present; `SIM_ENGINE=scripted` forces the fallback).
- Each round K2 reasons the society's reaction → per-agent mood, a first-person line,
  a one-phrase plan, narrative events, and macro indicator movements.
- The **`ScriptedEngine` is the deterministic backbone**: it always advances the
  economy + movement and honors human levers, so the sim never stalls. K2's output is
  overlaid on top. K2-Think is variable, so the engine retries up to `LLM_ATTEMPTS`
  times per round and falls back to scripted if all fail.
- Human lever values are passed into the prompt; levers that are indicators
  (`interest_rate`) are force-applied so players keep guaranteed agency.
- The key lives in the repo-root `.env` (`K2_API_KEY`); `backend/.env.local` mirrors it
  so `config.py` (which loads `backend/.env*`) sees it. The worker must run under
  `uv run python sim_worker.py` (LangChain deps) — `run-city.sh` does this.
- Validated live: human claims Central Bank + hikes rate to 9.5% → worker honors it →
  K2 reasons the cascade (unemployment ↑, prices cool) → broadcast back to all clients.

### Not yet done (future)
- Crowd-sourced policy proposals + voting; presence cursors; per-role win conditions.
- Richer K2 prompt (memory streams / relationships) and parallel per-agent calls.
- The old `/simulate` (single-player, FastAPI Socket.IO) is left intact and untouched.

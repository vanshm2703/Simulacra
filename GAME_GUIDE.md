# SIMULACRA — The Playable City

> A real-time, multiplayer economic-policy simulation. Humans claim the levers of
> power — the central bank, the government, a megacorp, the union, the press — and
> shape a living pixel-art city, side-by-side with AI citizens powered by a large
> reasoning model. Everyone connected sees the same world evolve, live.

Built for the **SpacetimeDB Launchpad Hackathon** (NYC Tech Week). This is a port of
the single-player "Simulacra" policy sim into a shared, multiplayer world where
**SpacetimeDB is the spine** — the database *is* the server, every browser subscribes
to the same tables, and the city updates on all screens in real time with no custom
websocket code.

---

## Table of Contents

1. [The Big Idea](#1-the-big-idea)
2. [How a Match Works (the loop)](#2-how-a-match-works-the-loop)
3. [How to Play](#3-how-to-play)
4. [The Roles (seats) & Their Levers](#4-the-roles-seats--their-levers)
5. [The Economy: Indicators & Cascades](#5-the-economy-indicators--cascades)
6. [The AI Citizens (K2-Think)](#6-the-ai-citizens-k2-think)
7. [Feature List](#7-feature-list)
8. [The Screen, Explained](#8-the-screen-explained)
9. [How It Works (architecture)](#9-how-it-works-architecture)
10. [Data Model (tables & reducers)](#10-data-model-tables--reducers)
11. [The Sim Worker & the Two Engines](#11-the-sim-worker--the-two-engines)
12. [Running It](#12-running-it)
13. [Playing With Friends (LAN)](#13-playing-with-friends-lan)
14. [Configuration](#14-configuration)
15. [Project Structure](#15-project-structure)
16. [Design Decisions & Why](#16-design-decisions--why)
17. [Troubleshooting](#17-troubleshooting)
18. [Roadmap](#18-roadmap)

---

## 1. The Big Idea

You're given a **real economic policy** — say, *"raise the federal minimum wage to
$20/hr"* — and a city of 12 interconnected actors: the federal government, the central
bank, corporations, small businesses, a labor union, the press, and several households
across income brackets.

Normally an AI drives all of them. But **any human can step in and take a seat.** Claim
the Central Bank and you control interest rates. Claim the union and you can call a
strike. Claim a megacorp and you decide whether to pass costs onto consumers. The rest
of the city keeps being played by the AI — and **everyone's decisions feed the same
shared economy**, which visibly reacts: prices climb, layoffs hit, citizens protest at
city hall, moods shift from hopeful to angry.

It's part **multiplayer strategy game** (asymmetric roles with conflicting incentives),
part **generative-agent simulation** (AI citizens with their own moods, dialogue, and
plans), and part **policy sandbox** (watch second-order effects play out).

**Why it's a SpacetimeDB showcase:** the entire shared world — every agent, position,
mood, event, indicator, and seat claim — lives in SpacetimeDB tables. Clients subscribe
to those tables and render from them; players act by calling reducers. There is no
hand-written realtime server. This is the exact kind of persistent, multiplayer, shared-
state world SpacetimeDB was built for (it powers the BitCraft MMO).

---

## 2. How a Match Works (the loop)

A match runs for a fixed number of **rounds** (each round = one simulated month),
grouped into **3 phases** (Immediate Shock → Market Adjustment → Societal Cascade).

Every round follows the same rhythm:

```
   ┌─────────────────────────────────────────────────────────────┐
   │  1. ROUND OPENS                                               │
   │     A countdown timer starts (e.g. 25–30s). Any human in a    │
   │     seat can set their lever and submit an action.            │
   ├─────────────────────────────────────────────────────────────┤
   │  2. WINDOW CLOSES                                             │
   │     The sim worker collects all human actions for the round.  │
   ├─────────────────────────────────────────────────────────────┤
   │  3. RESOLUTION                                                │
   │     • Human-held seats apply the player's chosen lever.       │
   │     • Empty seats are reasoned by the AI (K2-Think).          │
   │     • The economy advances: indicators move, agents change    │
   │       mood, move around the city, speak, and trigger events.  │
   ├─────────────────────────────────────────────────────────────┤
   │  4. BROADCAST                                                 │
   │     The resolved round is written to SpacetimeDB → every      │
   │     connected browser updates instantly (city, dashboard,     │
   │     event feed, social graph).                                │
   └─────────────────────────────────────────────────────────────┘
                         ↓ repeat until the match ends
```

When the final round resolves, the world status becomes **complete**.

---

## 3. How to Play

### Joining
1. Open the city URL in a browser (e.g. `http://<host>:3001/city`).
2. You join automatically as an anonymous player with a generated name (e.g.
   `guest-9f3a`). You appear in the **In City** presence bar. Your browser keeps a
   stable identity across refreshes (stored locally), so any seat you hold survives a
   reload.

### Claiming a role
- The **Take a Role** panel (left) lists the playable seats and who holds them:
  - **green = you hold it**, **red = taken by someone else**, **tan = free**.
- Click **Claim** on a free seat. Now you drive that agent. Click **Leave** to release
  it (the AI takes back over). If you close the tab or disconnect, your seat is
  **auto-released**.

### Taking an action
- The **Your Levers** panel shows a slider for each seat you hold.
- Drag the slider to your desired value, then click **Submit action** while the round is
  **open** (the timer shows `Ns to act`; when it shows `Resolving…` the window is shut).
- **Your setting is sticky:** once submitted, it stays in effect **every round** until
  you change it or leave the seat — you do *not* need to resubmit each round.

### Reading the outcome
- Watch the **city** (center): citizens walk around, chat bubbles pop, unhappy
  households march toward city hall to protest.
- Watch the **dashboard** (right): price index, unemployment, social unrest, government
  approval, interest rate, business survival — updated every round.
- Watch the **event feed** (bottom): a running log of what each agent says and does.
- Toggle the **social graph** to see relationships and influence between agents.

### Winning / the point
This is a **sandbox**, so there's no hard win screen yet — the goal is emergent:
- As **Government**, can you keep approval above water while the policy bites?
- As **Central Bank**, can you tame inflation without spiking unemployment?
- As the **Union**, can you win wages without collapsing the businesses that employ you?
- As a **Corp**, can you protect margins without igniting a protest?

The fun is the tug-of-war: the rate hike you make as the Central Bank fights the price
hike another player makes as the Corp, while the Union's strike threat and the
households' anger ripple through everything.

---

## 4. The Roles (seats) & Their Levers

There are **12 agents**. Five are **playable seats** (a human can claim them); the rest
are always AI-driven citizens whose reactions give the city life.

### Playable seats

| Seat | Who they are | Lever | Range | Effect |
|------|--------------|-------|-------|--------|
| **Federal Government** | Sets fiscal policy | `policy_stance` | −1 … +1 | Austerity ↔ stimulus. Higher = more support/jobs, costs approval risk. |
| **Central Bank** | Monetary authority | `interest_rate` | 0 … 12 % | Higher rates cool prices but raise unemployment. |
| **NorthAm Manufacturing** (megacorp) | Industrial employer | `price` | −1 … +1 | Price pass-through: raise prices (protect margin, hurt households) or absorb costs. |
| **Workers United** (labor union) | Organized labor | `strike` | 0 … 1 | Strike pressure: 1 = call a strike (cuts output, spikes unrest, hurts corps). |
| **The Daily Pulse** (media) | The press | `spin` | −1 … +1 | Coverage spin: critical ↔ supportive — shifts public sentiment and approval. |

### AI-only citizens (the world reacts through them)
- **RetailGiant** — big-box retailer (also adjusts prices).
- **Corner Shop**, **Main St. Diner** — small businesses, squeezed first; can close.
- **The Nguyens**, **The Petersons** (middle class), **The Washingtons** (low income),
  **The Castellanos** (high net worth) — households across brackets who feel prices,
  jobs, and unrest very differently.

Each agent has a persona, an income level, a political leaning, relationships, a mood,
and a per-round plan. Households in distress walk to city hall and protest.

---

## 5. The Economy: Indicators & Cascades

Six macro indicators summarize the city's health. They start at a "normal" baseline and
move each round based on lever decisions and the AI's reasoning:

| Indicator | Baseline | Meaning |
|-----------|----------|---------|
| **Price index** | 0 % | % above baseline prices (inflation pressure) |
| **Unemployment** | 4.2 % | share of the workforce out of work |
| **Social unrest** | 0.05 | 0 (calm) → 1 (boiling) |
| **Gov approval** | 0.62 | 0 → 1 |
| **Interest rate** | 5.25 % | the central bank's policy rate |
| **Business survival** | 0.95 | 1 → 0; SMEs start closing as it drops |

**Example cascade** (validated in play): a human Central Banker hikes the rate from
5.25% to 9.5%. Over the next rounds the model cools prices (toward −0.3%) but pushes
unemployment up (to 9–11%), which raises social unrest and tanks approval — households
turn angry and march on city hall. That's a textbook hawkish-monetary-policy second-order
effect, reasoned and narrated by the AI.

Levers interact: corp price hikes push the price index up; rate hikes pull it down but
raise unemployment; strikes cut output and spike unrest; supportive media spin lifts
approval. No single player controls the outcome — the city is the sum of everyone's moves.

---

## 6. The AI Citizens (K2-Think)

Empty seats and all background citizens are driven by **K2-Think-v2**, a large reasoning
model. Each round the engine hands K2 the full situation — the policy, current
indicators, the roster (marking which seats are human-held and what those players just
did), and recent events — and asks it to advance the city by one month:

- a **mood** for each agent (angry → excited),
- a **first-person line** ("My grocery receipts feel heavier even though I'm earning the
  same"),
- a one-phrase **plan** ("Lead rent-control protest", "Hold investments"),
- **movement** (protesters head to city hall),
- discrete **events** (a strike, a closure, a price hike),
- and the new **macro indicators**.

The AI **reacts to human players**: it's told who holds which seat and what lever value
they set, so a player's decisions genuinely shape how the AI citizens feel and behave.

> K2 is the *core reasoning engine*, not a side call — it decides the city's psychology
> and narrative every round.

---

## 7. Feature List

**Multiplayer & real-time**
- Many players in one shared, persistent city; everyone sees the same live state.
- Claim/release roles; **seats auto-release on disconnect** so the AI seamlessly resumes.
- **Sticky levers** — your policy stays in force every round until you change it.
- **Presence bar** showing who's currently in the city.
- **Round timer** with an action window synced across all clients.
- All sync is via SpacetimeDB **subscriptions** — no custom realtime server.

**Simulation**
- 12 interconnected agents across government, finance, business, labor, media, households.
- K2-Think reasoning engine driving moods, dialogue, plans, events, and indicators.
- Deterministic scripted backbone guaranteeing the economy always advances + honoring
  human levers (and serving as fallback when the LLM is slow/unavailable).
- 3-phase, multi-round cascade; six live macro indicators.
- Threshold events: strikes, business closures, protests.

**Visualization**
- Pixel-art **city** (Phaser) with walking citizens, chat bubbles, mood indicators, and
  protest clustering.
- **Dashboard** of indicators with history.
- **Event feed** (live log of agent actions/dialogue).
- **Social graph** of relationships and influence between agents.

**Robustness**
- LLM output is variable, so the engine retries and falls back to the scripted model — a
  round never stalls.
- Worker is authenticated as a privileged identity; only it can seed/resolve rounds.

---

## 8. The Screen, Explained

```
┌───────────────────────────────────────────────────────────────────────┐
│ [← Menu]  Phase 2 · Round 7/60 · 18s to act   In City: 3 [you,bob,liz] │  top bar
├──────────────┬──────────────────────────────────────┬─────────────────┤
│ TAKE A ROLE  │                                      │   DASHBOARD     │
│ • Central Bk │            THE PIXEL CITY            │  price  +4.8%   │
│   [Claim]    │   (citizens walk, chat, protest)     │  unemp   9.1%   │
│ • Gov [Leave]│                                      │  unrest  0.62   │
│ • Union[Taken]│                                      │  approval 0.31 │
│              │                                      │  rate    9.50% │
│ YOUR LEVERS  │                                      │ [Show graph]    │
│  Interest %  │                                      │                 │
│  ──●─── 9.50 │                                      │                 │
│  [Submit]    │                                      │                 │
├──────────────┴──────────────────────────────────────┴─────────────────┤
│ EVENT FEED:  Corner Shop: "If I don't get a grant, I'll shut my doors" │  bottom
│              Workers United calls a general strike! ...                 │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 9. How It Works (architecture)

```
   Browsers (N players)            SpacetimeDB module (Rust)         Python sim worker
   ────────────────────            ─────────────────────────         ─────────────────
   • subscribe to tables   ◀─────▶  • tables = the whole world   ◀──▶ • registers as worker
   • call reducers                  • reducers (claim/act/seed/        • seeds the roster
     (claim_seat,                     apply_round/...)                 • runs the round loop
      submit_action)                 • auth: worker-only writes         • K2 reasons empty seats
   • Phaser renders rows             • client_disconnected →            • writes results back
                                       auto-release seats                via apply_round
```

- **SpacetimeDB** is the single source of truth, the transport, and the multiplayer
  layer. State lives in public tables; clients read via subscriptions and write only
  through reducers (transactional, server-authoritative).
- **The browser** connects with the SpacetimeDB TypeScript SDK, subscribes to the tables,
  feeds incoming row changes into the existing Phaser **EventBridge** (so the pixel city,
  dashboard, graph, and feed all render from live rows), and calls reducers when you act.
- **The worker** is a headless Python process that owns the simulation timing and
  resolution. It connects over SpacetimeDB's HTTP API, seeds the world once, then drives
  the open-round → resolve → apply loop. Crucially, it does **not** touch
  `agent.controlled_by` — that field (set when a human claims a seat) is the entire
  human-vs-AI switch.

**The key field:** `agent.controlled_by: Option<Identity>`. `Some(player)` = a human
drives that seat; `None` = the AI does. Everything else follows from that.

---

## 10. Data Model (tables & reducers)

### Tables (all public, in `stdb/spacetimedb/src/lib.rs`)
| Table | Purpose |
|-------|---------|
| `world` | singleton: status, current_round, max_rounds, phase, round_open, round_deadline, policy_text |
| `config` | singleton: the privileged `worker` identity |
| `agent` | a citizen/institution: name, role, position (x,y), mood, plan, `playable`, **`controlled_by`** |
| `relationship` | edges for the social graph (src, dst, type, weight) |
| `sim_event` | the event log (round, agent, type, message) — drives feed + city motion |
| `indicator` | the six macro indicators (key → value) |
| `player` | presence: identity, display name, online, last seen |
| `pending_action` | queued human actions for the current round |
| `chat_message` | shared agent/human chat log |

### Reducers
- **Players:** `register_player`, `heartbeat`, `claim_seat`, `release_seat`,
  `submit_action`, `post_chat`.
- **Worker-only:** `set_worker`, `seed_world`, `open_round`, `apply_round`,
  `post_agent_chat`.
- **Lifecycle:** `init`, `client_connected`, `client_disconnected` (auto-releases seats).

Bulk payloads (the roster, per-round updates) are passed as JSON strings and parsed in
the module, which keeps the worker simple and avoids brittle complex-argument encoding.

---

## 11. The Sim Worker & the Two Engines

`backend/sim_worker.py` resolves each round with a swappable engine:

- **`LangGraphEngine` (default)** — calls K2-Think for the agents' psychology, dialogue,
  plans, events, and indicator movement. K2 is a reasoning model with variable output, so
  the engine **retries** up to a few times per round and, if it still can't get a usable
  batch, **falls back to the scripted engine** for that round.
- **`ScriptedEngine` (backbone + fallback)** — a dependency-free economic model that
  always advances indicators and movement and **honors human levers deterministically**.
  Even when the LLM overlays its narrative, this backbone guarantees the sim never stalls.

**Sticky human levers:** the worker remembers each player's last submitted lever value and
re-applies it every round while they hold the seat (pruned when they leave). Levers that
*are* indicators (the interest rate) are force-applied to the player's value, so a human
always has guaranteed, direct agency; the AI reasons about the consequences.

Select the engine with `SIM_ENGINE=llm` (default when a key is present) or
`SIM_ENGINE=scripted`.

---

## 12. Running It

### Prerequisites
- **SpacetimeDB CLI**, **Rust** (+ `wasm32-unknown-unknown`), **Python 3.12 + uv**,
  **Node + bun**.
- A **K2 API key** in the repo-root `.env` as `K2_API_KEY=...` (see `.env.example`). It's
  also read from `backend/.env.local`.

### One command
```bash
./run-city.sh           # starts SpacetimeDB, publishes the module, runs the worker + web
./run-city.sh --fresh   # also wipes existing world data first
```
Then open **http://localhost:3001/city**.

### Or piece by piece
```bash
scripts/stdb-publish.sh [--fresh]            # build module, publish locally, regen TS bindings
cd backend && uv run python sim_worker.py    # the sim worker (LLM engine by default)
cd frontend && bunx next dev -p 3001         # the web app
```

### Knobs
```bash
SIM_ROUNDS=60 SIM_ROUND_SECONDS=30 SIM_ENGINE=llm \
SIM_POLICY="Impose a 25% tariff on imported steel." \
  uv run python sim_worker.py
```

---

## 13. Playing With Friends (LAN)

Everyone on the **same WiFi** can join your machine:

1. Find your LAN IP (e.g. `192.168.86.35`).
2. Point the browser client at it: in `frontend/.env.local`
   `NEXT_PUBLIC_STDB_URI=ws://<your-ip>:3000`.
3. Allow that origin for the dev server: in `next.config.ts`
   `allowedDevOrigins: ["<your-ip>"]`.
4. Run the web app bound to all interfaces on its own port:
   `bunx next dev -H 0.0.0.0 -p 3001` (the database stays on `:3000`).
5. Everyone — including you — opens **http://<your-ip>:3001/city**.

Notes: your machine is the host (it runs the DB + worker), so keep it awake. If a friend's
page loads but stays "connecting," it's almost always the **macOS firewall** blocking
incoming connections to `node`/`spacetime`. For friends *not* on your WiFi, put a tunnel
(e.g. cloudflared) in front of both ports, or deploy the module to SpacetimeDB Maincloud.

---

## 14. Configuration

| Variable | Where | Default | Purpose |
|----------|-------|---------|---------|
| `K2_API_KEY` | root `.env` / `backend/.env.local` | — | K2-Think API key |
| `SIM_ENGINE` | worker env | `llm` if key present | `llm` or `scripted` |
| `SIM_ROUNDS` | worker env | 9 | number of rounds/months |
| `SIM_ROUND_SECONDS` | worker env | 25 | action window per round |
| `SIM_POLICY` / `SIM_OBJECTIVE` | worker env | min-wage scenario | the scenario text |
| `STDB_URL` / `STDB_DB` | worker env | `http://127.0.0.1:3000` / `simulacra` | DB target |
| `NEXT_PUBLIC_STDB_URI` | `frontend/.env.local` | `ws://127.0.0.1:3000` | DB the browser connects to |
| `NEXT_PUBLIC_STDB_DB` | `frontend/.env.local` | `simulacra` | DB name |

---

## 15. Project Structure

```
simulacra/
├─ stdb/spacetimedb/          # Rust SpacetimeDB module (the shared world)
│  └─ src/lib.rs              #   tables + reducers
├─ backend/
│  ├─ sim_worker.py           # the round-loop worker (LLM + scripted engines)
│  ├─ services/stdb_client.py # stdlib HTTP client (reducer calls + SQL reads)
│  └─ graph/                  # K2 LLM helpers (invoke_llm_json, etc.)
├─ frontend/
│  ├─ src/app/city/page.tsx   # the multiplayer route (SpacetimeDB provider + layout)
│  ├─ src/hooks/useStdbCity.ts# subscription-driven hook → feeds EventBridge + state
│  ├─ src/services/stdbConnection.ts
│  ├─ src/lib/stdbAdapt.ts    # SpacetimeDB rows → existing frontend types
│  ├─ src/components/         # SeatPicker, ActionPanel, RoundTimer, PresenceBar, …
│  ├─ src/game/               # Phaser city + EventBridge
│  └─ src/module_bindings/    # generated SpacetimeDB TS bindings
├─ run-city.sh                # one-command launcher
├─ scripts/stdb-publish.sh    # build + publish + regenerate bindings
├─ SPACETIMEDB_PORT.md        # full design notes / change log
└─ GAME_GUIDE.md              # this file
```

---

## 16. Design Decisions & Why

- **SpacetimeDB as the spine, not a feature.** Replacing the old single-player
  Socket.IO + in-memory state with SpacetimeDB tables/subscriptions/reducers is what makes
  the multiplayer real-time sync free — and it's the whole point of the hackathon.
- **`controlled_by` as the human/AI switch.** One nullable identity column turns any
  agent into a playable seat with no special-casing; auto-releasing it on disconnect makes
  joining/leaving seamless.
- **Worker keeps the LLM/economics; the module stays "dumb."** Rust reducers are state
  writers; the heavy reasoning stays in Python. This minimized the rewrite and let us
  reuse the existing K2 stack.
- **Scripted backbone under the LLM.** Reasoning models are non-deterministic and
  sometimes return unusable output. A deterministic economic core that always advances and
  honors human levers means gameplay is reliable; K2 enriches it when it succeeds.
- **Sticky levers.** Policy is a standing decision, not a per-round chore — so a human's
  setting persists until changed, and the AI can't quietly revert it.

---

## 17. Troubleshooting

- **Page stuck on "CONNECTING TO THE CITY…"** — the client JS didn't load. On LAN, add
  your IP to `allowedDevOrigins` in `next.config.ts` and restart; hard-refresh
  (Cmd+Shift+R).
- **Friend's page loads but city is empty** — macOS firewall blocking `node`/`spacetime`;
  allow them or disable the firewall on your home network.
- **Interest rate "snaps back"** — fixed: levers are sticky and the slider keeps its value
  across rounds.
- **City frozen / no events** — check the worker is running (`/tmp/simulacra-worker.log`),
  the module is published, and `K2_API_KEY` is set (worker falls back to scripted if not).
- **`tsc`/build errors about native modules** — run a clean `bun install` (the repo can
  ship missing platform-native deps like `lightningcss`/`@tailwindcss/oxide`).

---

## 18. Roadmap

- **Crowd-sourced policy** — players propose policies and the room votes on which the
  city enacts.
- **Per-role win conditions / scoring** — give each seat an objective and a scoreboard.
- **Richer K2 prompting** — feed in memory streams + relationship context; parallelize
  per-agent reasoning.
- **Presence cursors** — show where each player is looking on the map.
- **Internet play** — tunnel or Maincloud deployment so friends off your WiFi can join.

---

*Simulacra — humans and AI, running the same economy, live.*

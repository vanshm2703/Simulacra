# SIMULACRA Backend

FastAPI + LangGraph backend that orchestrates 25 LLM-powered NPC agents simulating reactions to economic policy, with opinion dynamics grounded in peer-reviewed social science.

## Setup

```bash
cd backend
uv sync                    # Install dependencies
cp .env .env.local         # Add your API keys
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PROVIDER` | Active provider: `xai`, `k2`, or `gemini` |
| `XAI_API_KEY` | xAI API key (used when `PROVIDER=xai`) |
| `K2_API_KEY` | K2 Think API key (used when `PROVIDER=k2`) |
| `GEMINI_API_KEY` | Gemini API key (used when `PROVIDER=gemini`) |

Provider model mappings are fixed in `config.py`:

- `xai` -> `grok-4.20-non-reasoning` (default), `grok-4-1-fast-non-reasoning` (fast), `grok-4-1-fast-reasoning` (reasoning)
- `k2` -> `MBZUAI-IFM/K2-Think-v2`
- `gemini` -> `gemini-3.0-flash`

## API Endpoints

### `POST /simulate`

Start a new simulation.

**Request:**
```json
{
  "text": "Policy text here (max 3000 chars)...",
  "num_rounds": 5
}
```

**Response:**
```json
{
  "simulation_id": "uuid-string"
}
```

### `WebSocket /simulate/{simulation_id}/ws`

Connect to stream simulation events in real time.

**Message protocol:**

```
1. Server sends: {"type": "init", "npcs": [...], "relationships": [...]}
2. Server sends: {"type": "round", "round": 0, "events": [...]}  (repeated per round)
3. Server sends: {"type": "done"}
```

On error: `{"type": "error", "message": "..."}`

## Graph Pipeline

```
START -> parse_policy -> generate_npcs -> run_round <-> should_continue
                                              |              |
                                              | round < max -+
                                              | round >= max -> END
```

| Node | LLM Tokens | Description |
|------|-----------|-------------|
| `parse_policy` | 4096 | Analyze policy: sectors, stakeholders, economic impacts, controversy |
| `generate_npcs` | 8192 | Create 25 NPCs with personas + 30-40 relationships |
| `run_round` | 2048 x 25 | Perceive-React-Act for each NPC (parallelized with `asyncio.gather`) |

## Opinion Dynamics

Based on [Peralta, Kertesz & Iniguez (2022)](https://arxiv.org/abs/2201.01322), *"Opinion dynamics in social networks: From models to data"* — a review paper surveying how individual opinions shift through social interaction across networks. It covers discrete models (voter model, q-voter model), continuous models (Deffuant bounded confidence, DeGroot weighted averaging, Baumann polarization), and validates them against election data and controlled sociological experiments.

Implementation: `graph/nodes/run_round.py` -> `_apply_opinion_dynamics()`

### 1. Deffuant Bounded Confidence (Eq. 1-2)

Pairwise opinion convergence when agents interact via chat:

```
x_j(t+1) = x_j(t) + mu * I_ij * [x_i(t) - x_j(t)]
```

Only applied when opinions are close enough: `|x_i - x_j| < epsilon` (the confidence bound).

Applied to:
- **Political leaning** `[-1, 1]`: `mu = 0.3`, `epsilon = 0.7`
- **Mood** `[0, 1]` (continuous mapping of angry-to-excited): `mu = 0.4`, `epsilon = 1.1` (no effective bound)

### 2. Baumann Controversy Amplification (Eq. 6)

Polarization driven by policy controversy:

```
drift = 0.02 * tanh(alpha * x_i)
```

Pushes all opinions toward extremes each round. `alpha` scales with policy controversy level:

| Controversy | alpha |
|-------------|-------|
| low | 1.0 |
| medium | 2.0 |
| high | 3.5 |

Only active when `alpha > 1.5`. This means low-controversy policies allow consensus, while high-controversy ones cause polarization even without direct interaction.

### 3. Keep / Compromise / Adopt (Sec. 3.3)

Behavioral classification based on influence factor `I_ij`, from Chacoma & Zanette (2015):

| Behavior | Condition | Effect |
|----------|-----------|--------|
| **Keep** | `I_ij < 0.25` | No opinion change (strangers, weak ties) |
| **Compromise** | `0.25 <= I_ij < 0.85` | Deffuant partial convergence |
| **Adopt** | `I_ij >= 0.85` | Copy speaker's opinion entirely (strong family) |

### Influence Factor I_ij (Fig. 1c)

```
I_ij = min(1.0, relationship_strength * type_weight)
```

| Relationship | Weight |
|-------------|--------|
| family | 1.5 |
| friend | 1.2 |
| employer | 1.0 |
| colleague | 0.8 |
| neighbor | 0.5 |
| stranger | 0.1 (flat) |

### Spatial Constraints

- NPCs communicate only within Chebyshev distance <= 2 (5x5 area)
- Movement clamped to 1 tile per round (server-enforced)
- Prompt includes direction + distance to non-nearby social ties ("social pull")

## Data Models

### NPC
| Field | Type | Description |
|-------|------|-------------|
| `id` | str | `npc_01` through `npc_25` |
| `name` | str | Full name |
| `role` | enum | worker, business_owner, politician, student, retiree, activist, farmer, shopkeeper |
| `income_level` | enum | low, medium, high |
| `political_leaning` | float | -1.0 (far left) to 1.0 (far right) |
| `industry` | str | Specific industry |
| `personality` | str | 1-2 sentence description |
| `x`, `y` | int | Grid position (0-19, 0-14) |
| `mood` | str | angry, anxious, worried, neutral, hopeful, excited |

### Relationship
| Field | Type | Description |
|-------|------|-------------|
| `source_id` | str | NPC ID |
| `target_id` | str | NPC ID |
| `rel_type` | enum | friend, family, employer, neighbor, colleague |
| `strength` | float | 0.0 to 1.0 |

### SimEvent
| Field | Type | Description |
|-------|------|-------------|
| `round` | int | Simulation round |
| `npc_id` | str | Acting NPC |
| `event_type` | enum | chat, move, protest, price_change, mood_shift |
| `message` | str | Human-readable description |
| `data` | dict | Type-specific payload |

## Configuration

| Constant | Value | Location |
|----------|-------|----------|
| `GRID_WIDTH` | 20 | `config.py` |
| `GRID_HEIGHT` | 15 | `config.py` |
| `MAX_NPCS` | 25 | `config.py` |
| `max_rounds` | 5 (default) | `config.py` |
| CORS origin | `localhost:3000` | `main.py` |

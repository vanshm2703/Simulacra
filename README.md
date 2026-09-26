# SIMULACRA

### *Learn not just from the past, but also from the future.*

![Simulation](https://i.imgur.com/jkbhQAB.png)

[![YHack 2026](https://img.shields.io/badge/YHack-2026-blueviolet?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0xMiAyTDIgN2wxMCA1IDEwLTV6TTIgMTdsOCA0IDQtMi00LTItOCA0em0xMC00bC04IDQgNC0yIDQgMnoiLz48L3N2Zz4=)](https://yhack.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-latest-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![LangGraph](https://img.shields.io/badge/LangGraph-multi--agent-FF6B35?style=flat-square)](https://langchain-ai.github.io/langgraph/)
[![Phaser](https://img.shields.io/badge/Phaser-3-8e44ad?style=flat-square)](https://phaser.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

> **Economic policy simulation with 25 AI agents in a pixel-art city.**
> Paste a policy. Watch your city react.

---

## 🗺 What It Does

| Step | What happens |
|------|-------------|
| **1. Input a policy** | Paste ~500 words of economic policy text — e.g. *"Raise minimum wage to $20/hr"* |
| **2. 25 agents spawn** | Workers, business owners, politicians, students, retirees, activists, farmers, shopkeepers, and drivers populate the city |
| **3. 15 simulation rounds** | Each NPC perceives the policy, retrieves memories, reflects, plans, and acts — running across 3 distinct phases |
| **4. Social influence spreads** | NPCs influence neighbors via proximity-based opinion dynamics (Deffuant bounded confidence, Baumann polarization, Keep/Compromise/Adopt) |
| **5. Watch it unfold** | Bankruptcy markers persist on the map, money effects float, emotion indicators pop above NPCs, phase flash overlays sweep the screen |
| **6. Inspect any agent** | Click an NPC or event to see mood, income, political leaning, internal thoughts, and current plan |
| **7. Analyze results** | Live dashboard tracks price index, unemployment, and social unrest; interactive force-layout social graph shows relationships |

---

## ⚡ Quick Start

**Prerequisites:** Python 3.12+ · [uv](https://docs.astral.sh/uv/) · Node.js 22+ · [Bun](https://bun.sh/) · xAI or K2 Think API key

```bash
# 1. Clone
git clone <repo-url> && cd yhack

# 2. Backend
cd backend
cp .env.example .env     # add your API keys (see below)
uv sync
cd ..

# 3. Frontend
cd frontend && bun install && cd ..

# 4. Run (two terminals)
cd backend && uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
cd frontend && bun dev
```

Open **http://localhost:3000**, paste a policy, and hit **Simulate**.

### Environment variables (`backend/.env`)

```env
XAI_API_KEY=xai-...
K2_API_KEY=...
MODEL_NAME=grok-3-think-v2   # or k2-think-v2
```

---

## 🏗 Architecture

```
  ┌──────────────────────────────────────────────────────────┐
  │                        USER                              │
  │              pastes ~500 words of policy                 │
  └─────────────────────────┬────────────────────────────────┘
                            │ POST /simulate
                            ▼
  ┌──────────────── FastAPI + LangGraph ────────────────────┐
  │                                                          │
  │   ┌─────────────┐           ┌──────────────────────┐    │
  │   │ Parse Policy│           │   Generate 25 NPCs   │    │
  │   │   (LLM)     │           │  + Relationships     │    │
  │   └──────┬──────┘           └──────────┬───────────┘    │
  │          └─────────────┬───────────────┘                │
  │                        ▼                                │
  │          ┌─────────────────────────────┐                │
  │    ┌────▶│      Simulation Round       │────┐           │
  │    │     │  Perceive → Retrieve        │    │           │
  │    │     │  Reflect  → Plan → Act      │    │           │
  │    │     │  per NPC via LLM (async)    │    │           │
  │    └─────└─────────────────────────────┘    │           │
  │           loop 15 rounds (3 phases)         │           │
  └─────────────────────────────────────────────┴───────────┘
                            │ WebSocket stream
                            ▼
  ┌──────────────── Next.js + Phaser 3 ─────────────────────┐
  │                                                          │
  │   React ──EventBridge──▶ Phaser canvas (pixel-art)      │
  │   Dashboard · EventFeed · SocialGraph · NPCModal         │
  └──────────────────────────────────────────────────────────┘
```

---

## 🔬 Research Foundations

Two peer-reviewed models underpin the simulation engine.

### Generative Agents (Park et al., 2023)

> Park, J. S. et al. *Generative Agents: Interactive Simulacra of Human Behavior.*
> UIST 2023 — [arXiv:2304.03442](https://arxiv.org/abs/2304.03442)

Each NPC runs a full cognitive loop adapted from this landmark paper:

- **Memory stream** — append-only log of observations, reflections, and plans, scored by importance heuristics
- **Retrieval** — top-K memories scored by `recency × importance × relevance` (Jaccard keyword similarity)
- **Reflection** — when recent importance sum exceeds threshold (25), NPC synthesizes higher-level insights stored back into memory
- **Planning** — single-sentence plans revised each round based on new observations

### Opinion Dynamics (Peralta et al., 2022)

> Peralta, A. F., Kertesz, J., and Iniguez, G.
> *Opinion dynamics in social networks: From models to data.*
> [arXiv:2201.01322](https://arxiv.org/abs/2201.01322)

NPC social influence uses three mechanisms from the literature:

- **Deffuant Bounded Confidence** — opinions converge only when close enough (`|x_i − x_j| < ε`), modelling echo chambers naturally
- **Baumann Controversy Amplification** — high-controversy policies push opinions toward extremes via `drift = 0.02 · tanh(α · x)`
- **Keep / Compromise / Adopt** — behavioral classification by relationship strength: strangers keep their views, friends compromise, family adopts the speaker's opinion outright

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16, Phaser 3 (canvas), Tailwind CSS v4, Bun, Biome |
| **Backend** | FastAPI, LangGraph, langchain-openai, uv (Python 3.12) |
| **LLMs** | xAI Grok 3 Think / K2 Think V2 (configurable via `MODEL_NAME`) |
| **Maps** | Citypack tileset, procedural city generator |
| **Communication** | WebSocket real-time event streaming |

---

## 🗂 Project Structure

```
yhack/
├── frontend/                   # Next.js 16 + Phaser 3
│   ├── src/app/                # Pages and layouts
│   ├── src/components/         # GameCanvas, PolicyInput, EventFeed, Dashboard,
│   │                           # NPCProfileModal, SocialGraph, EconomicReportModal
│   ├── src/game/
│   │   ├── bridge/             # EventBridge (React ↔ Phaser)
│   │   ├── effects/            # ClosureEffect, PriceSpikeEffect, ProtestEffect,
│   │   │                       # EconomicEffects (bankruptcy, money, phase flash)
│   │   ├── entities/           # NPC, Car, WorldChatBubble
│   │   ├── map/                # CityGenerator, CitypackRegistry, CarRegistry
│   │   ├── scenes/             # BootScene, WorldScene
│   │   └── systems/            # MovementSystem, NPCManager, OccupancyGrid, Pathfinder
│   ├── src/hooks/              # useSimulation (WebSocket hook)
│   ├── src/lib/                # adapter, metricsEngine, replayStore
│   ├── src/services/           # wsClient (WebSocket + REST)
│   └── src/types/              # Frontend + backend type definitions
│
└── backend/                    # FastAPI + LangGraph
    ├── main.py                 # App entry point
    ├── config.py               # Grid dims, settings
    ├── models/                 # Pydantic schemas, LangGraph state
    ├── graph/                  # LLM nodes, prompts, memory, orchestrator
    ├── routers/                # HTTP + WebSocket endpoints
    └── tests/                  # pytest
```

---

## 🔄 How It Works

```
  POLICY TEXT IN
       │
       ▼
  ┌──────────┐    ┌────────────────────────────────────────────┐
  │  PARSE   │───▶│ controversy level · affected sectors ·     │
  │  POLICY  │    │ predicted outcomes · summary               │
  └──────────┘    └────────────────────────────────────────────┘
       │
       ▼
  ┌──────────┐    ┌────────────────────────────────────────────┐
  │ GENERATE │───▶│ 25 NPCs with jobs, incomes, political       │
  │   NPCs   │    │ leanings, moods, and social relationships   │
  └──────────┘    └────────────────────────────────────────────┘
       │
       ▼
  ┌────────────────────────────────────────────────────────────┐
  │  PHASE 1: Immediate Shock  (rounds 1–5)                    │
  │  PHASE 2: Adaptation       (rounds 6–10)                   │
  │  PHASE 3: New Equilibrium  (rounds 11–15)                  │
  │                                                            │
  │  Each round, every NPC:                                    │
  │    1. Perceives policy + environment                       │
  │    2. Retrieves relevant memories                          │
  │    3. Reflects if importance threshold crossed             │
  │    4. Updates plan                                         │
  │    5. Acts  →  chat · protest · move · adjust prices       │
  │    6. Influences nearby neighbors (opinion dynamics)       │
  └────────────────────────────────────────────────────────────┘
       │
       ▼
  PIXEL-ART CITY  ·  LIVE DASHBOARD  ·  SOCIAL GRAPH OUT
```

---

*Built at YHack 2026.*

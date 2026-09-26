"""Application configuration."""

import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env then .env.local (later file wins)
_base = Path(__file__).parent
load_dotenv(_base / ".env")
load_dotenv(_base / ".env.local", override=True)

# Grid dimensions
GRID_WIDTH = 20
GRID_HEIGHT = 15
MAX_X = GRID_WIDTH - 1
MAX_Y = GRID_HEIGHT - 1

MAX_NPCS = 25

# Simulation timeline: 3 phases × 5 rounds each = 15 total rounds.
NUM_PHASES = 3
ROUNDS_PER_PHASE = 5
DEFAULT_NUM_ROUNDS = NUM_PHASES * ROUNDS_PER_PHASE

# Memory stream parameters (Park et al. 2023, arXiv:2304.03442).
MEMORY_TOP_K = 8
RECENCY_DECAY = 0.8
REFLECTION_THRESHOLD = 25
REFLECTION_MAX_PER_ROUND = 5

# LLM endpoint (any OpenAI-compatible server).
# Default: local Hugging Face model prism-ml/Ternary-Bonsai-27B-mlx-2bit served by
# `mlx_lm.server` on :8080. Set LLM_BASE_URL/LLM_MODEL/LLM_API_KEY to point elsewhere
# (e.g. the original K2 API: https://api.k2think.ai/v1 + MBZUAI-IFM/K2-Think-v2).
K2_BASE_URL = os.environ.get("LLM_BASE_URL", "http://127.0.0.1:8080/v1")
K2_MODEL = os.environ.get("LLM_MODEL", "prism-ml/Ternary-Bonsai-27B-mlx-2bit")
K2_API_KEY = os.environ.get("LLM_API_KEY") or os.environ.get("K2_API_KEY") or "local"
# Qwen3-family models (incl. Ternary-Bonsai) "think" before answering; that is far
# too slow for live rounds on a laptop, so it is off unless explicitly enabled.
# Seconds before an LLM call is abandoned (the sim worker then falls back to its
# scripted engine instead of freezing the round).
LLM_TIMEOUT = float(os.environ.get("LLM_TIMEOUT", "180"))
LLM_ENABLE_THINKING = os.environ.get("LLM_ENABLE_THINKING", "").lower() in ("true", "1", "yes")

# Swarm mode: two-phase NPC round execution (orchestrator picks initiators first)
SWARM = os.environ.get("SWARM", "").lower() in ("true", "1", "yes")

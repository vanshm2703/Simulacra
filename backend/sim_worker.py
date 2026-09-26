"""Simulacra sim worker (MongoDB).

A headless process that owns the simulation and pushes it into MongoDB so
every connected browser sees the same living city in real time.

Responsibilities
----------------
1. Register as the privileged worker (``set_worker``).
2. Seed the city (``seed_world``) — the roster of agents + relationships.
3. Run the round loop:
     open_round(window)  ->  humans submit actions  ->  read pending_actions
     ->  resolve the round (honoring human levers)  ->  apply_round  ->  repeat.

The resolution logic lives in :class:`ScriptedEngine`, a dependency-free
economic cascade that reacts to the human-controlled seats. It is intentionally
swappable: a future ``LangGraphEngine`` can implement the same ``step`` method
to drive resolution with the existing LLM graph (see backend/graph/). Empty
seats are driven by the engine; human-held seats (``controlled_by`` set) apply
the player's submitted lever instead.

Run it:
    uv run python sim_worker.py
Env:
    MONGODB_URI=mongodb://127.0.0.1:27017   MONGODB_DB=simulacra
    SIM_ROUNDS=9   SIM_ROUND_SECONDS=12
    SIM_POLICY="..."   SIM_OBJECTIVE="..."
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import random
from dataclasses import dataclass, field
from typing import Any

from services.mongo_store import MongoCityStore, StoreError

# LLM reasoning is optional — the worker falls back to the scripted engine if the
# LangChain/K2 stack or the API key is unavailable.
try:
    from graph.llm import invoke_llm_json

    _LLM_AVAILABLE = True
except Exception:  # pragma: no cover - import-time env issues
    invoke_llm_json = None  # type: ignore[assignment]
    _LLM_AVAILABLE = False

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  worker  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("sim_worker")

GRID_W, GRID_H = 20, 15
MOOD_LADDER = ["angry", "anxious", "worried", "neutral", "hopeful", "excited"]


def sentiment_to_mood(s: float) -> str:
    """Map a sentiment in [-1, 1] onto the frontend's 6-step mood ladder."""
    idx = int(round((s + 1.0) / 2.0 * (len(MOOD_LADDER) - 1)))
    return MOOD_LADDER[max(0, min(len(MOOD_LADDER) - 1, idx))]


# ─────────────────────────────────────────────────────────────────────────────
# Roster — playable seats + AI-driven citizens (from design.md)
# ─────────────────────────────────────────────────────────────────────────────

# (id, name, role, category, income, playable, x, y, lever, lever_label)
ROSTER_SPEC: list[tuple] = [
    ("gov_federal", "Federal Government", "politician", "government", "high", True, 10, 2, "policy_stance", "Policy stance (contractionary↔expansionary)"),
    ("gov_central_bank", "Central Bank", "politician", "central_bank", "high", True, 14, 3, "interest_rate", "Interest rate (%)"),
    ("corp_manufacturing", "NorthAm Manufacturing", "business_owner", "large_corp", "high", True, 3, 4, "price", "Price pass-through (lower↔raise)"),
    ("corp_retail", "RetailGiant", "business_owner", "large_corp", "high", False, 5, 5, "price", "Price pass-through"),
    ("labor_union", "Workers United", "activist", "union", "medium", True, 8, 11, "strike", "Strike pressure (0=calm,1=strike)"),
    ("media_outlet", "The Daily Pulse", "activist", "media", "medium", True, 16, 8, "spin", "Coverage spin (critical↔supportive)"),
    ("sme_shop", "Corner Shop", "shopkeeper", "sme", "low", False, 6, 8, "", ""),
    ("sme_restaurant", "Main St. Diner", "shopkeeper", "sme", "low", False, 12, 9, "", ""),
    ("hh_mc_1", "The Nguyens", "worker", "household", "medium", False, 4, 12, "", ""),
    ("hh_mc_2", "The Petersons", "worker", "household", "medium", False, 9, 13, "", ""),
    ("hh_poor_1", "The Washingtons", "worker", "household", "low", False, 14, 12, "", ""),
    ("hh_hnw_1", "The Castellanos", "business_owner", "household", "high", False, 17, 11, "", ""),
]

RELATIONSHIPS_SPEC: list[tuple] = [
    ("gov_federal", "gov_central_bank", "colleague", 0.6),
    ("gov_federal", "media_outlet", "neighbor", 0.1),
    ("corp_manufacturing", "labor_union", "colleague", -0.5),
    ("corp_retail", "labor_union", "colleague", -0.3),
    ("corp_manufacturing", "hh_mc_1", "employer", 0.4),
    ("corp_retail", "hh_poor_1", "employer", 0.3),
    ("sme_shop", "hh_mc_2", "neighbor", 0.5),
    ("sme_restaurant", "hh_poor_1", "neighbor", 0.4),
    ("labor_union", "hh_mc_1", "colleague", 0.6),
    ("labor_union", "hh_poor_1", "colleague", 0.7),
    ("media_outlet", "hh_mc_2", "neighbor", 0.2),
    ("hh_hnw_1", "corp_manufacturing", "colleague", 0.5),
]

# Levers exposed to the frontend ActionPanel (also documented here for the UI).
SEAT_LEVERS: dict[str, dict[str, Any]] = {
    "gov_federal": {"lever": "policy_stance", "min": -1, "max": 1, "step": 0.1, "label": "Policy stance"},
    "gov_central_bank": {"lever": "interest_rate", "min": 0, "max": 12, "step": 0.25, "label": "Interest rate (%)"},
    "corp_manufacturing": {"lever": "price", "min": -1, "max": 1, "step": 0.1, "label": "Price pass-through"},
    "labor_union": {"lever": "strike", "min": 0, "max": 1, "step": 1, "label": "Strike pressure"},
    "media_outlet": {"lever": "spin", "min": -1, "max": 1, "step": 0.1, "label": "Coverage spin"},
}


def build_roster() -> list[dict[str, Any]]:
    agents: list[dict[str, Any]] = []
    for (aid, name, role, category, income, playable, x, y, lever, lever_label) in ROSTER_SPEC:
        profile = {
            "id": aid,
            "name": name,
            "role": role,
            "category": category,
            "gender": "n/a",
            "bio": f"{name} — a {category.replace('_', ' ')} navigating the new policy.",
            "persona": f"{name} acts in the interest of {category.replace('_', ' ')}.",
            "mbti": "XXXX",
            "country": "USA",
            "profession": role,
            "interested_topics": ["economy", "policy"],
            "income_level": income,
            "political_leaning": 0.0,
            "reputation": 0.5,
            "beliefs": [],
            "controversial_ideas": [],
            "x": x,
            "y": y,
            "mood": "neutral",
            "playable": playable,
            "lever": lever,
            "lever_label": lever_label,
        }
        agents.append(
            {
                "id": aid,
                "name": name,
                "role": role,
                "category": category,
                "bio": profile["bio"],
                "persona": profile["persona"],
                "income_level": income,
                "political_leaning": 0.0,
                "reputation": 0.5,
                "x": x,
                "y": y,
                "mood": "neutral",
                "current_plan": "",
                "profile_json": json.dumps(profile),
                "playable": playable,
            }
        )
    return agents


def build_relationships() -> list[dict[str, Any]]:
    return [
        {"src": s, "dst": d, "rel_type": t, "weight": w}
        for (s, d, t, w) in RELATIONSHIPS_SPEC
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Scripted economic engine
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class Indicators:
    price_index: float = 0.0      # % above baseline
    unemployment: float = 4.2     # %
    social_unrest: float = 0.05   # 0..1
    gov_approval: float = 0.62    # 0..1
    interest_rate: float = 5.25   # %
    business_survival: float = 0.95  # 0..1

    def as_rows(self) -> list[dict[str, Any]]:
        return [{"key": k, "value": round(float(v), 4)} for k, v in self.__dict__.items()]


@dataclass
class ScriptedEngine:
    """A small, deterministic-enough economic cascade.

    Each agent carries a hidden ``sentiment`` in [-1, 1]; indicators evolve from
    a policy baseline plus whatever the human-controlled seats push. Empty seats
    drift toward type-appropriate behavior.
    """

    rng: random.Random
    ind: Indicators = field(default_factory=Indicators)
    sentiment: dict[str, float] = field(default_factory=dict)
    pos: dict[str, tuple[int, int]] = field(default_factory=dict)
    policy: str = ""
    objective: str = ""
    max_rounds: int = 0
    # Persistent human lever settings: agent_id -> {lever: value}. A player's
    # choice stays in effect every round until they change it or leave the seat.
    held_levers: dict[str, dict[str, float]] = field(default_factory=dict)
    # One-shot action cards fired this round: agent_id -> [action_key, ...].
    oneshots: dict[str, list[str]] = field(default_factory=dict)

    def _sync_levers(
        self, controlled_ids: set[str], actions: dict[str, dict[str, Any]]
    ) -> dict[str, dict[str, Any]]:
        """Update the sticky lever store and return the EFFECTIVE levers to apply
        this round. `actions` is agent_id -> {lever: value}; a seat may carry several
        levers, and every standing human setting persists (not just fresh ones)."""
        # Drop seats no longer human-held (AI takes back over).
        for aid in list(self.held_levers):
            if aid not in controlled_ids:
                del self.held_levers[aid]
        # Merge this round's fresh submissions. "act:" levers are one-shot action
        # cards (transient, not sticky); everything else is a standing lever.
        self.oneshots = {}
        for aid, levers in actions.items():
            if aid not in controlled_ids:
                continue
            for lever, value in levers.items():
                if lever.startswith("act:"):
                    self.oneshots.setdefault(aid, []).append(lever[4:])
                else:
                    self.held_levers.setdefault(aid, {})[lever] = value
        # Effective = a copy of every standing human lever setting.
        return {aid: dict(levers) for aid, levers in self.held_levers.items()}

    def seed(self, agents: list[dict[str, Any]]) -> None:
        for a in agents:
            self.sentiment[a["id"]] = 0.0
            self.pos[a["id"]] = (a["x"], a["y"])

    async def astep(
        self,
        round_num: int,
        phase: int,
        agents: list[dict[str, Any]],
        actions: dict[str, dict[str, Any]],
        controlled_ids: set[str] | None = None,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Async entry point (the scripted engine is synchronous)."""
        effective = self._sync_levers(controlled_ids or set(), actions)
        return self.step(round_num, phase, agents, effective)

    def step(
        self,
        round_num: int,
        phase: int,
        agents: list[dict[str, Any]],
        actions: dict[str, dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Resolve one round. Returns (agent_updates, events)."""
        events: list[dict[str, Any]] = []

        # ── 1. Read effective levers (standing human settings or AI baselines) ──
        # `actions` maps agent_id -> {lever_name: value}. Each playable seat has TWO
        # levers; unheld seats fall back to neutral-ish AI baselines.
        def lev(aid: str, name: str, default: float) -> float:
            a = actions.get(aid)
            if a and name in a and isinstance(a[name], (int, float)):
                return float(a[name])
            return default

        ind = self.ind
        human_cb = bool(actions.get("gov_central_bank", {}).get("interest_rate") is not None)
        qe = lev("gov_central_bank", "qe", 0.0)                # -1 tighten .. +1 ease
        gov_stance = lev("gov_federal", "policy_stance", 0.10)  # austerity .. stimulus
        tax = lev("gov_federal", "tax", 0.30)                   # 0..1, neutral 0.30
        tax_dev = tax - 0.30
        price_push = lev("corp_manufacturing", "price", 0.05) + lev("corp_retail", "price", 0.05)
        hiring = lev("corp_manufacturing", "hiring", 0.0) + lev("corp_retail", "hiring", 0.0)
        strike = lev("labor_union", "strike", 0.0)
        wage_demand = lev("labor_union", "wage_demand", 0.20)
        spin = lev("media_outlet", "spin", 0.0)
        intensity = lev("media_outlet", "intensity", 0.30)

        # Interest rate: a human sets it directly; otherwise the AI bank leans
        # against inflation (and eases when QE is high).
        if human_cb:
            ind.interest_rate = float(actions["gov_central_bank"]["interest_rate"])
        else:
            rate_target = 5.0 + 0.7 * ind.price_index - 0.1 * (ind.unemployment - 4.5) - 1.0 * qe
            ind.interest_rate += 0.4 * (rate_target - ind.interest_rate)
        ind.interest_rate = max(0.0, min(12.0, ind.interest_rate))
        rate_gap = ind.interest_rate - 5.0

        # ── 2. Indicator dynamics: ease toward lever-driven TARGETS. This mean-
        #      reverts, so the city RECOVERS with good policy instead of only ever
        #      collapsing — and a lever change visibly moves the dials each round. ──
        EASE = 0.45
        price_target = (6.0 * price_push + 2.0 * wage_demand + 1.5 * gov_stance
                        + 1.5 * qe - 1.0 * rate_gap - 1.2 * tax_dev)
        ind.price_index += EASE * (price_target - ind.price_index)
        ind.price_index = max(-3.0, min(40.0, ind.price_index))

        unemp_target = (4.5 + 1.2 * max(0.0, rate_gap) + 4.0 * strike + 2.0 * wage_demand
                        + 1.5 * tax_dev - 2.5 * gov_stance - 2.0 * hiring - 1.0 * qe
                        + 0.4 * max(0.0, ind.price_index))
        ind.unemployment += EASE * (unemp_target - ind.unemployment)
        ind.unemployment = max(2.0, min(30.0, ind.unemployment))

        biz_target = (0.97 - 0.035 * max(0.0, ind.price_index) - 0.20 * strike
                      - 0.10 * wage_demand - 0.02 * max(0.0, rate_gap)
                      + 0.05 * gov_stance + 0.04 * hiring)
        ind.business_survival += EASE * (biz_target - ind.business_survival)
        ind.business_survival = max(0.2, min(1.0, ind.business_survival))

        appr_target = (0.55 + 0.13 * gov_stance + 0.12 * spin * max(0.3, intensity)
                       - 0.03 * (ind.unemployment - 4.5) - 0.02 * max(0.0, ind.price_index)
                       - 0.45 * ind.social_unrest - 0.15 * tax_dev)
        ind.gov_approval += EASE * (appr_target - ind.gov_approval)
        ind.gov_approval = max(0.03, min(0.97, ind.gov_approval))

        unrest_target = (0.05 + 0.04 * max(0.0, ind.price_index)
                         + 0.03 * max(0.0, ind.unemployment - 4.5) + 0.35 * strike
                         + 0.10 * wage_demand - 0.30 * (ind.gov_approval - 0.5)
                         - 0.12 * gov_stance - 0.10 * spin * intensity)
        ind.social_unrest += 0.55 * (unrest_target - ind.social_unrest)
        ind.social_unrest = max(0.0, min(1.0, ind.social_unrest))

        # ── 2b. One-shot action cards: transient effects + a feed headline ──
        for aid, acts in self.oneshots.items():
            for key in acts:
                eff = ONESHOT_EFFECTS.get(key)
                if not eff:
                    continue
                for k, dv in eff["delta"].items():
                    lo, hi = INDICATOR_BOUNDS.get(k, (-1e9, 1e9))
                    setattr(ind, k, max(lo, min(hi, getattr(ind, k) + dv)))
                events.append({
                    "agent_id": aid,
                    "event_type": "policy_response",
                    "message": eff["msg"],
                    "data_json": "{}",
                })
        self.oneshots = {}

        # ── 3. Per-agent sentiment + mood + movement + chatter ──
        hardship = (
            0.15 * max(0.0, self.ind.price_index)
            + 0.10 * (self.ind.unemployment - 4.2)
            + 0.50 * self.ind.social_unrest
        )
        updates: list[dict[str, Any]] = []
        for a in agents:
            aid = a["id"]
            cat = a.get("category", "")
            # Households/SMEs feel hardship; corps/gov are more insulated.
            exposure = {
                "household": 1.0, "sme": 0.9, "union": 0.7, "media": 0.3,
                "large_corp": -0.2, "government": 0.0, "central_bank": 0.0,
            }.get(cat, 0.5)
            target = -exposure * hardship + 0.2 * gov_stance + 0.1 * spin
            target = max(-1.0, min(1.0, target))
            s = self.sentiment.get(aid, 0.0)
            s += 0.5 * (target - s) + self.rng.uniform(-0.05, 0.05)
            s = max(-1.0, min(1.0, s))
            self.sentiment[aid] = s
            new_mood = sentiment_to_mood(s)

            # Movement: unhappy households drift toward the city hall (protest).
            x, y = self.pos[aid]
            if cat in ("household", "union") and s < -0.4:
                tx, ty = 10, 2  # gov_federal location
                x += (1 if tx > x else -1 if tx < x else 0)
                y += (1 if ty > y else -1 if ty < y else 0)
            else:
                x += self.rng.choice([-1, 0, 0, 1])
                y += self.rng.choice([-1, 0, 0, 1])
            x = max(0, min(GRID_W - 1, x))
            y = max(0, min(GRID_H - 1, y))
            self.pos[aid] = (x, y)

            plan = self._plan_for(cat, s, actions.get(aid) is not None)
            updates.append({"id": aid, "x": x, "y": y, "mood": new_mood, "current_plan": plan})
            events.append({"agent_id": aid, "event_type": "move", "message": "",
                           "data_json": json.dumps({"to_x": x, "to_y": y})})
            if new_mood != a.get("mood"):
                events.append({"agent_id": aid, "event_type": "mood_shift", "message": plan,
                               "data_json": json.dumps({"new_mood": new_mood})})
            # A few agents speak each round.
            if self.rng.random() < 0.4:
                events.append({"agent_id": aid, "event_type": "chat",
                               "message": self._line(cat, s, self.ind),
                               "data_json": "{}"})

        # ── 4. Threshold events ──
        if strike >= 1.0:
            events.append({"agent_id": "labor_union", "event_type": "protest",
                           "message": "Workers United calls a general strike!", "data_json": "{}"})
        if self.ind.social_unrest > 0.6:
            events.append({"agent_id": "gov_federal", "event_type": "protest",
                           "message": "Crowds gather outside city hall.", "data_json": "{}"})
        if self.ind.price_index > 6.0:
            events.append({"agent_id": "sme_shop", "event_type": "price_change",
                           "message": "Corner Shop posts new, higher prices.", "data_json": "{}"})

        return updates, events

    @staticmethod
    def _plan_for(cat: str, s: float, human: bool) -> str:
        who = "(you)" if human else ""
        if cat in ("household", "sme"):
            return f"Cut spending and brace for prices {who}".strip()
        if cat == "union":
            return f"Organize members, weigh a strike {who}".strip()
        if cat == "large_corp":
            return f"Protect margins, adjust prices {who}".strip()
        if cat == "government":
            return f"Manage approval and the cascade {who}".strip()
        if cat == "central_bank":
            return f"Balance inflation vs. employment {who}".strip()
        if cat == "media":
            return f"Frame the story for the audience {who}".strip()
        return ""

    def _line(self, cat: str, s: float, ind: Indicators) -> str:
        pools = {
            "household": [
                "Groceries cost more every week.",
                "I'm worried about making rent.",
                "Are we going to be okay?",
            ],
            "sme": [
                "My suppliers just raised prices again.",
                "Foot traffic is down this month.",
            ],
            "union": [
                "Wages have to keep up with prices.",
                "If they won't negotiate, we walk.",
            ],
            "large_corp": [
                "Input costs are up; we'll pass some on.",
                "We're reviewing headcount this quarter.",
            ],
            "government": [
                "We stand by the policy's long-term benefits.",
                "Relief measures are under consideration.",
            ],
            "central_bank": [
                f"Holding rates near {ind.interest_rate:.2f}% for now.",
                "Inflation expectations remain our focus.",
            ],
            "media": [
                "Citizens react as the policy bites.",
                "Markets weigh the government's next move.",
            ],
        }
        return self.rng.choice(pools.get(cat, ["..."]))


# ─────────────────────────────────────────────────────────────────────────────
# LLM (K2-Think) reasoning engine
# ─────────────────────────────────────────────────────────────────────────────

INDICATOR_KEYS = (
    "price_index",
    "unemployment",
    "social_unrest",
    "gov_approval",
    "interest_rate",
    "business_survival",
)
INDICATOR_BOUNDS = {
    "price_index": (-5.0, 40.0),
    "unemployment": (2.0, 30.0),
    "social_unrest": (0.0, 1.0),
    "gov_approval": (0.02, 0.98),
    "interest_rate": (0.0, 20.0),
    "business_survival": (0.2, 1.0),
}
# Levers that ARE indicators get force-applied to the human's submitted value so
# a player has guaranteed, direct agency (the LLM reasons about consequences).
LEVER_TO_INDICATOR = {"interest_rate": "interest_rate"}

# How many times to re-ask K2 for a usable batch before falling back to scripted.
LLM_ATTEMPTS = 3
# Max seconds the LLM may spend on one round before the scripted engine takes over.
LLM_ROUND_TIMEOUT = float(os.environ.get("LLM_ROUND_TIMEOUT", "240"))

# One-shot "action cards": a player fires these as lever "act:<key>". They apply
# a transient effect for that round only (NOT sticky), then emit a feed headline.
ONESHOT_EFFECTS: dict[str, dict[str, Any]] = {
    "stimulus": {"delta": {"gov_approval": 0.08, "unemployment": -1.6, "price_index": 0.8}, "msg": "unveils a major Stimulus Package!"},
    "bailout": {"delta": {"business_survival": 0.12, "gov_approval": -0.03}, "msg": "announces a corporate Bailout."},
    "taxcut": {"delta": {"unemployment": -1.0, "price_index": 0.6, "gov_approval": 0.05}, "msg": "pushes an Emergency Tax Cut."},
    "rate_cut": {"delta": {"interest_rate": -2.0, "unemployment": -0.8, "price_index": 0.5}, "msg": "makes a shock interest-rate cut."},
    "qe_blast": {"delta": {"price_index": 1.5, "unemployment": -1.5}, "msg": "launches a QE blast."},
    "layoff": {"delta": {"business_survival": 0.06, "unemployment": 2.0, "social_unrest": 0.05}, "msg": "orders mass layoffs."},
    "hiring": {"delta": {"unemployment": -2.0, "business_survival": -0.03}, "msg": "announces a hiring spree."},
    "lobby": {"delta": {"business_survival": 0.05, "gov_approval": -0.02}, "msg": "lobbies the government for favors."},
    "strike": {"delta": {"unemployment": 1.3, "business_survival": -0.08, "social_unrest": 0.12}, "msg": "calls a general strike!"},
    "deal": {"delta": {"social_unrest": -0.06, "unemployment": -0.5}, "msg": "strikes a labor deal."},
    "expose": {"delta": {"gov_approval": -0.10, "social_unrest": 0.08}, "msg": "publishes a damning exposé."},
    "endorse": {"delta": {"gov_approval": 0.08, "social_unrest": -0.04}, "msg": "endorses the government."},
}

# Crisis templates: the worker spawns one occasionally; any player resolves it;
# the worker applies the chosen option's effect (or the default if it expires).
CRISIS_TEMPLATES: list[dict[str, Any]] = [
    {"title": "Banking Panic", "desc": "Major banks are on the brink of collapse.", "role": "gov_federal", "default": "b",
     "a": {"label": "Bail them out", "delta": {"business_survival": 0.15, "gov_approval": -0.05}},
     "b": {"label": "Let them fail", "delta": {"business_survival": -0.18, "unemployment": 3.0, "social_unrest": 0.10}}},
    {"title": "Oil Shock", "desc": "Global oil prices spike overnight.", "role": "gov_central_bank", "default": "b",
     "a": {"label": "Release reserves", "delta": {"price_index": -1.5, "gov_approval": -0.03}},
     "b": {"label": "Ride it out", "delta": {"price_index": 3.0, "social_unrest": 0.08}}},
    {"title": "Corruption Scandal", "desc": "Leaked files implicate city officials.", "role": "media_outlet", "default": "a",
     "a": {"label": "Expose it", "delta": {"gov_approval": -0.08, "social_unrest": 0.04}},
     "b": {"label": "Bury the story", "delta": {"gov_approval": 0.04, "social_unrest": 0.10}}},
    {"title": "Mass Protest", "desc": "Thousands march on city hall.", "role": "gov_federal", "default": "b",
     "a": {"label": "Make concessions", "delta": {"social_unrest": -0.20, "gov_approval": 0.03, "price_index": 0.5}},
     "b": {"label": "Crack down", "delta": {"social_unrest": -0.05, "gov_approval": -0.10}}},
    {"title": "Factory Closure Threat", "desc": "A major employer threatens to leave town.", "role": "corp_manufacturing", "default": "b",
     "a": {"label": "Offer subsidies", "delta": {"unemployment": -1.5, "gov_approval": -0.03, "business_survival": 0.08}},
     "b": {"label": "Let it go", "delta": {"unemployment": 2.5, "social_unrest": 0.06}}},
    {"title": "Tech Boom", "desc": "A wave of startups wants to set up shop.", "role": "corp_manufacturing", "default": "a",
     "a": {"label": "Invest big", "delta": {"unemployment": -2.0, "price_index": 0.6, "business_survival": 0.06}},
     "b": {"label": "Tax the gains", "delta": {"gov_approval": 0.05, "business_survival": -0.04}}},
]


def _apply_delta(ind: "Indicators", delta: dict[str, float]) -> None:
    for k, dv in delta.items():
        lo, hi = INDICATOR_BOUNDS.get(k, (-1e9, 1e9))
        setattr(ind, k, max(lo, min(hi, getattr(ind, k) + dv)))


# Effects applied when a player deal is accepted (keyed by deal kind).
DEAL_EFFECTS: dict[str, dict[str, float]] = {
    "subsidy": {"unemployment": -1.5, "business_survival": 0.06, "gov_approval": -0.03},
    "no_strike": {"social_unrest": -0.10, "unemployment": -0.5},
    "cheap_credit": {"business_survival": 0.08, "price_index": 0.4},
    "tax_break": {"business_survival": 0.06, "gov_approval": -0.03},
    "wage_offer": {"social_unrest": -0.06, "business_survival": -0.03},
    "wage_demand": {"unemployment": 0.5, "business_survival": -0.05, "social_unrest": -0.04},
    "endorse_gov": {"gov_approval": 0.05, "social_unrest": -0.03},
    "good_press": {"gov_approval": 0.07, "social_unrest": -0.03},
}


@dataclass
class LangGraphEngine(ScriptedEngine):
    """K2-Think reasoning drives agent reactions and macro indicators each round.

    The LLM is the core engine; the inherited :class:`ScriptedEngine` is the
    deterministic fallback if a call fails or returns nothing usable. Human
    lever values are passed into the prompt (and force-applied where a lever is
    itself an indicator), so players keep real agency.
    """

    recent_lines: list[str] = field(default_factory=list)

    async def astep(
        self,
        round_num: int,
        phase: int,
        agents: list[dict[str, Any]],
        actions: dict[str, dict[str, Any]],
        controlled_ids: set[str] | None = None,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        effective = self._sync_levers(controlled_ids or set(), actions)
        if not _LLM_AVAILABLE or invoke_llm_json is None:
            return self.step(round_num, phase, agents, effective)
        try:
            return await asyncio.wait_for(
                self._llm_step(round_num, phase, agents, effective), timeout=LLM_ROUND_TIMEOUT,
            )
        except Exception as exc:  # robust (incl. timeout): never stall the round on an LLM hiccup
            log.warning("LLM step failed (%s) — falling back to scripted", exc)
            return self.step(round_num, phase, agents, effective)

    def _build_prompt(
        self,
        round_num: int,
        phase: int,
        agents: list[dict[str, Any]],
        actions: dict[str, dict[str, Any]],
    ) -> str:
        roster_lines = []
        for a in agents:
            act = actions.get(a["id"])  # effective levers = human-held seats
            who = "HUMAN" if act else "AI"
            act_str = (
                "  [human set " + ", ".join(f"{k}={v}" for k, v in act.items()) + "]"
                if act
                else ""
            )
            roster_lines.append(
                f"- {a['id']} | {a['name']} | {a.get('category', '')} | {who} | mood={a.get('mood', 'neutral')}{act_str}"
            )
        ind = {k: round(getattr(self.ind, k), 3) for k in INDICATOR_KEYS}
        recent = "\n".join(self.recent_lines[-8:]) or "(none yet)"
        moods = "angry, anxious, worried, neutral, hopeful, excited"
        return (
            "You are the reasoning engine of an economic-policy society simulation set in a "
            "pixel-art city. Advance the simulation by ONE simulated month and report what "
            "happens, reasoning about second-order cascades.\n\n"
            f"POLICY: {self.policy}\n"
            f"OBJECTIVE: {self.objective}\n"
            f"MONTH (round): {round_num + 1} / {self.max_rounds}  (phase {phase} of 3)\n\n"
            f"CURRENT INDICATORS: {json.dumps(ind)}\n"
            "  price_index=% above baseline, unemployment=%, social_unrest=0..1, "
            "gov_approval=0..1, interest_rate=%, business_survival=0..1\n\n"
            "AGENTS (HUMAN seats are played by real people; honor their decisions, react to them):\n"
            + "\n".join(roster_lines)
            + f"\n\nRECENT EVENTS:\n{recent}\n\n"
            "Rules: be realistic — e.g. higher interest rates cool prices but raise unemployment; "
            "strikes cut output and raise unrest; price hikes hurt low-income households first; "
            "media spin shifts sentiment. Update EVERY agent's mood and give each a short, "
            "first-person line and a one-phrase plan. Move households/unions toward city hall "
            "('to_cityhall') when angry/protesting, else 'wander' or 'stay'.\n"
            f"Valid moods: {moods}. Valid move: to_cityhall | wander | stay.\n"
            "Return ONLY this JSON (no prose):\n"
            '{"indicators": {"price_index": 0.0, "unemployment": 0.0, "social_unrest": 0.0, '
            '"gov_approval": 0.0, "interest_rate": 0.0, "business_survival": 0.0}, '
            '"agents": [{"id": "", "mood": "neutral", "say": "", "plan": "", "move": "wander"}], '
            '"events": [{"agent_id": "", "type": "protest", "message": ""}]}'
        )

    async def _llm_step(
        self,
        round_num: int,
        phase: int,
        agents: list[dict[str, Any]],
        actions: dict[str, dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        # Deterministic backbone: advances indicators + movement, honors human
        # levers, and never stalls. K2 then overlays moods/dialogue/narrative.
        base_updates, base_events = self.step(round_num, phase, agents, actions)

        by_id = {a["id"]: a for a in agents}
        prompt = self._build_prompt(round_num, phase, agents, actions)

        # K2-Think is a reasoning model with variable output — retry until we get
        # a usable batch (the key is unlimited). Large max_tokens avoids the
        # <think> block crowding out the JSON answer.
        need = max(1, len(agents) // 2)
        result: dict[str, Any] | None = None
        llm_agents: list[dict[str, Any]] = []
        for attempt in range(1, LLM_ATTEMPTS + 1):
            try:
                r = await invoke_llm_json(prompt, max_tokens=8192)
            except Exception as exc:
                log.warning("round %d: LLM attempt %d failed (%s)", round_num, attempt, exc)
                continue
            cand = [
                e
                for e in (r.get("agents", []) if isinstance(r, dict) else [])
                if isinstance(e, dict) and e.get("id") in by_id
            ]
            if len(cand) >= need:
                result, llm_agents = r, cand
                break
            log.info("round %d: LLM attempt %d gave %d/%d agents — retrying",
                     round_num, attempt, len(cand), len(agents))
        if result is None:
            log.info("round %d: no usable LLM result — scripted only", round_num)
            return base_updates, base_events

        # NB: indicators come from the deterministic scripted model (already run
        # above via self.step), so the economy stays balanced and reacts to human
        # levers. K2 only overlays narrative — moods, dialogue, plans, events.

        # 2. Overlay K2 moods/plans onto the scripted (positioned) updates.
        upd_by_id = {u["id"]: dict(u) for u in base_updates}
        overlay_events: list[dict[str, Any]] = []
        for entry in llm_agents:
            aid = entry["id"]
            u = upd_by_id.get(aid)
            if u is None:
                continue
            mood = entry.get("mood", u["mood"])
            if mood not in MOOD_LADDER:
                mood = u["mood"]
            plan = str(entry.get("plan", "")).strip()[:80]
            prev_mood = by_id[aid].get("mood")
            u["mood"] = mood
            if plan:
                u["current_plan"] = plan
            if mood != prev_mood:
                overlay_events.append({"agent_id": aid, "event_type": "mood_shift",
                                       "message": plan, "data_json": json.dumps({"new_mood": mood})})
            say = str(entry.get("say", "")).strip()
            if say:
                overlay_events.append({"agent_id": aid, "event_type": "chat",
                                       "message": say[:200], "data_json": "{}"})
                self.recent_lines.append(f"{by_id[aid]['name']}: {say[:120]}")

        # 3. Discrete narrative events from K2.
        for ev in result.get("events", []) if isinstance(result, dict) else []:
            if isinstance(ev, dict) and ev.get("agent_id") in by_id and ev.get("message"):
                overlay_events.append({"agent_id": ev["agent_id"],
                                       "event_type": str(ev.get("type", "reaction")),
                                       "message": str(ev["message"])[:160], "data_json": "{}"})
                self.recent_lines.append(str(ev["message"])[:160])

        # Keep scripted MOVE events (authoritative positions); drop scripted
        # chat/mood_shift in favor of K2's. Append K2 overlay events.
        move_events = [e for e in base_events if e["event_type"] == "move"]
        self.recent_lines = self.recent_lines[-20:]
        return list(upd_by_id.values()), move_events + overlay_events


# ─────────────────────────────────────────────────────────────────────────────
# Worker main loop
# ─────────────────────────────────────────────────────────────────────────────


def phase_for(round_num: int, max_rounds: int) -> int:
    if max_rounds <= 0:
        return 1
    third = max(1, max_rounds // 3)
    return min(3, 1 + round_num // third)


def _make_engine() -> ScriptedEngine:
    """Pick the resolution engine. Defaults to the LLM engine when available."""
    choice = os.environ.get("SIM_ENGINE", "").lower()
    use_llm = choice == "llm" or (choice == "" and _LLM_AVAILABLE)
    if use_llm and not _LLM_AVAILABLE:
        log.warning("SIM_ENGINE=llm requested but LLM stack unavailable — using scripted")
        use_llm = False
    rng = random.Random(1234)
    if use_llm:
        log.info("engine: LangGraph/K2 (LLM) with scripted fallback")
        return LangGraphEngine(rng=rng)
    log.info("engine: scripted")
    return ScriptedEngine(rng=rng)


async def run() -> None:
    rounds = int(os.environ.get("SIM_ROUNDS", "9"))
    window = int(os.environ.get("SIM_ROUND_SECONDS", "12"))
    policy = os.environ.get(
        "SIM_POLICY",
        "The government raises the federal minimum wage to $20/hr, effective immediately.",
    )
    objective = os.environ.get("SIM_OBJECTIVE", "Stress-test the policy across society.")
    crisis_start = int(os.environ.get("SIM_CRISIS_START", "2"))

    client = MongoCityStore()
    log.info("connecting to MongoDB db=%s", client.db.name)
    client.set_worker()
    log.info("registered as worker")

    agents = build_roster()
    rels = build_relationships()
    client.seed_world(policy, objective, rounds, agents, rels)
    log.info("seeded world: %d agents, %d rounds", len(agents), rounds)

    engine = _make_engine()
    engine.policy = policy
    engine.objective = objective
    engine.max_rounds = rounds
    engine.seed(agents)
    # Publish the baseline indicators immediately (round 0, no deltas yet).
    client.apply_round(0, 1, [], [], engine.ind.as_rows(), clear_actions=False)

    # Crisis bookkeeping: map live crisis id -> the template that spawned it.
    crisis_map: dict[int, dict[str, Any]] = {}

    def process_crises(round_num: int) -> list[dict[str, Any]]:
        """Apply resolved/expired crises to the indicators; return feed events."""
        evs: list[dict[str, Any]] = []
        try:
            crises = client.get_crises()
        except StoreError as exc:
            log.warning("crisis read failed: %s", exc)
            return evs
        for c in crises:
            cid = int(c["id"])
            tmpl = crisis_map.get(cid)
            if tmpl is None:
                continue
            status = c.get("status")
            if status == "resolved":
                opt = tmpl["a"] if int(c.get("chosen", 0)) == 0 else tmpl["b"]
                _apply_delta(engine.ind, opt["delta"])
                evs.append({"agent_id": tmpl["role"], "event_type": "crisis",
                            "message": f"{tmpl['title']}: “{opt['label']}” chosen.", "data_json": "{}"})
                client.close_crisis(cid)
                crisis_map.pop(cid, None)
                log.info("crisis %d resolved: %s -> %s", cid, tmpl["title"], opt["label"])
            elif status == "open" and round_num > int(c.get("deadline", round_num)):
                opt = tmpl[tmpl["default"]]
                _apply_delta(engine.ind, opt["delta"])
                evs.append({"agent_id": tmpl["role"], "event_type": "crisis",
                            "message": f"{tmpl['title']}: no decision — “{opt['label']}” by default.", "data_json": "{}"})
                client.close_crisis(cid)
                crisis_map.pop(cid, None)
                log.info("crisis %d expired: %s -> default %s", cid, tmpl["title"], opt["label"])
        return evs

    def process_deals() -> list[dict[str, Any]]:
        """Apply accepted player deals to the indicators; return feed events."""
        evs: list[dict[str, Any]] = []
        try:
            deals = client.get_deals()
        except StoreError as exc:
            log.warning("deal read failed: %s", exc)
            return evs
        for d in deals:
            status = d.get("status")
            if status not in ("accepted", "rejected"):
                continue
            did = int(d["id"])
            text = d.get("text", "a deal")
            if status == "accepted":
                eff = DEAL_EFFECTS.get(d.get("kind", ""))
                if eff:
                    _apply_delta(engine.ind, eff)
                evs.append({"agent_id": d.get("from_agent", ""), "event_type": "policy_response",
                            "message": f"Deal struck — {text}", "data_json": "{}"})
                log.info("deal %d accepted: %s", did, d.get("kind"))
            else:
                evs.append({"agent_id": d.get("from_agent", ""), "event_type": "reaction",
                            "message": f"Deal rejected — {text}", "data_json": "{}"})
            client.close_deal(did)
        return evs

    def maybe_spawn_crisis(round_num: int) -> None:
        # Spawn at most one active crisis, every 5 rounds starting at SIM_CRISIS_START
        # (0-based round index; the popup shows up during the following round).
        if (crisis_map or round_num < crisis_start or (round_num - crisis_start) % 5 != 0
                or round_num >= rounds - 1):
            return
        tmpl = engine.rng.choice(CRISIS_TEMPLATES)
        deadline = round_num + 2
        client.spawn_crisis(round_num, tmpl["title"], tmpl["desc"],
                            tmpl["a"]["label"], tmpl["b"]["label"], tmpl["role"], deadline)
        # Find the id of the crisis we just created and remember its template.
        try:
            for c in client.get_crises():
                if (c.get("status") == "open" and c.get("title") == tmpl["title"]
                        and int(c["id"]) not in crisis_map):
                    crisis_map[int(c["id"])] = tmpl
                    log.info("crisis spawned: #%d %s (decide by round %d)", int(c["id"]), tmpl["title"], deadline)
                    break
        except StoreError as exc:
            log.warning("crisis spawn lookup failed: %s", exc)

    for r in range(rounds):
        phase = phase_for(r, rounds)
        client.open_round(r, phase, window)
        log.info("round %d (phase %d) open — %ds window for human actions", r, phase, window)
        await asyncio.sleep(window)

        # Snapshot current agents (to know who is human-controlled) + their actions.
        live_agents = client.get_agents()
        controlled = {a["id"]: a["controlled_by"] for a in live_agents if a.get("controlled_by")}
        raw_actions = client.get_pending_actions(r)
        actions: dict[str, dict[str, Any]] = {}
        for pa in raw_actions:
            lever = pa.get("lever")
            if lever:
                actions.setdefault(pa["agent_id"], {})[lever] = pa.get("value")
        controlled_ids = set(controlled.keys())
        if actions:
            log.info("round %d: human action(s): %s", r, actions)

        updates, events = await engine.astep(r, phase, agents, actions, controlled_ids)
        # Keep our local roster moods/positions in sync for next round's diffing.
        by_id = {a["id"]: a for a in agents}
        for u in updates:
            a = by_id.get(u["id"])
            if a:
                a["mood"] = u["mood"]
                a["x"], a["y"] = u["x"], u["y"]

        # Resolve any decided/expired crises (mutates indicators), then maybe
        # spawn a fresh one for upcoming rounds.
        events = events + process_crises(r) + process_deals()
        maybe_spawn_crisis(r)

        client.apply_round(r, phase, updates, events, engine.ind.as_rows(), clear_actions=True)
        log.info(
            "round %d applied — price=%.1f%% unemp=%.1f%% unrest=%.2f approval=%.2f rate=%.2f%% (%d human-held)",
            r, engine.ind.price_index, engine.ind.unemployment, engine.ind.social_unrest,
            engine.ind.gov_approval, engine.ind.interest_rate, len(controlled),
        )
        await asyncio.sleep(2)

    log.info("simulation complete (%d rounds)", rounds)


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except StoreError as e:
        log.error("MongoDB store error: %s", e)
    except KeyboardInterrupt:
        log.info("worker stopped")

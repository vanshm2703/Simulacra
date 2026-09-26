"""MongoDB store for the multiplayer "playable city".

Replaces the SpacetimeDB module (stdb/spacetimedb/src/lib.rs). Every former
table is a collection and every former reducer is a method with the same name
and semantics, so the sim worker and the FastAPI city router can call it
directly.

Collections (one per former table):
    world, config            singleton docs with ``_id = 0``
    agents                   ``_id`` = agent slug
    relationships, sim_events, pending_actions, chat_messages, crises, deals
                             integer ``_id`` from the ``counters`` collection
    indicators               ``_id`` = indicator key
    players                  ``_id`` = player identity (hex)

Every write bumps ``world.version``; the city WebSocket polls that number to
know when to push fresh state to browsers (works on local mongod and Atlas,
no replica set / change streams required).
"""

from __future__ import annotations

import os
import time
from typing import Any

from pymongo import ASCENDING, MongoClient, ReturnDocument
from pymongo.database import Database

import config  # noqa: F401  (loads backend/.env* so MONGODB_URI is set)


class StoreError(RuntimeError):
    """A reducer rejected the call (same role as SpacetimeDB reducer errors)."""


def _now_ms() -> int:
    return int(time.time() * 1000)


_SEQ_COLLECTIONS = (
    "relationships", "sim_events", "pending_actions", "chat_messages", "crises", "deals",
)


class MongoCityStore:
    def __init__(self, uri: str | None = None, db_name: str | None = None) -> None:
        uri = uri or os.environ.get("MONGODB_URI", "mongodb://127.0.0.1:27017")
        db_name = db_name or os.environ.get("MONGODB_DB", "simulacra")
        self.client: MongoClient = MongoClient(uri, serverSelectionTimeoutMS=5000, tz_aware=False)
        self.db: Database = self.client[db_name]
        self.init()

    # ── setup (former `init` reducer) ───────────────────────────────────
    def init(self) -> None:
        db = self.db
        db.world.update_one(
            {"_id": 0},
            {"$setOnInsert": {
                "status": "idle", "policy_text": "", "objective": "",
                "current_round": 0, "max_rounds": 0, "phase": 0, "round_open": False,
                "round_deadline": _now_ms(), "updated_at": _now_ms(), "version": 0,
            }},
            upsert=True,
        )
        db.config.update_one({"_id": 0}, {"$setOnInsert": {"worker": None}}, upsert=True)
        db.sim_events.create_index([("round", ASCENDING)])
        db.pending_actions.create_index([("round", ASCENDING)])
        db.agents.create_index([("controlled_by", ASCENDING)])
        db.crises.create_index([("status", ASCENDING)])
        db.deals.create_index([("status", ASCENDING)])

    # ── helpers ─────────────────────────────────────────────────────────
    def _next_id(self, name: str) -> int:
        doc = self.db.counters.find_one_and_update(
            {"_id": name}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER,
        )
        return int(doc["seq"])

    def _touch(self, extra: dict[str, Any] | None = None) -> None:
        update: dict[str, Any] = {"$inc": {"version": 1}}
        if extra:
            update["$set"] = extra
        self.db.world.update_one({"_id": 0}, update)

    def _world(self) -> dict[str, Any]:
        w = self.db.world.find_one({"_id": 0})
        if w is None:
            raise StoreError("world not initialized")
        return w

    def _player_label(self, identity: str) -> str:
        p = self.db.players.find_one({"_id": identity})
        return p["display_name"] if p else "anon"

    def version(self) -> int:
        w = self.db.world.find_one({"_id": 0}, {"version": 1})
        return int(w.get("version", 0)) if w else 0

    # ── lifecycle (client_connected / client_disconnected) ──────────────
    def identity_connected(self, identity: str) -> None:
        self.db.players.update_one(
            {"_id": identity},
            {"$set": {"online": True, "last_seen": _now_ms()},
             "$setOnInsert": {"display_name": "anon"}},
            upsert=True,
        )
        self._touch()

    def identity_disconnected(self, identity: str) -> None:
        # Release any seats this identity controlled so the AI takes back over.
        self.db.agents.update_many({"controlled_by": identity}, {"$set": {"controlled_by": None}})
        self.db.players.update_one(
            {"_id": identity}, {"$set": {"online": False, "last_seen": _now_ms()}},
        )
        self._touch()

    # ── presence ────────────────────────────────────────────────────────
    def register_player(self, identity: str, name: str) -> None:
        nm = name if name.strip() else "anon"
        self.db.players.update_one(
            {"_id": identity},
            {"$set": {"display_name": nm, "online": True, "last_seen": _now_ms()}},
            upsert=True,
        )
        self._touch()

    def heartbeat(self, identity: str) -> None:
        self.db.players.update_one(
            {"_id": identity}, {"$set": {"online": True, "last_seen": _now_ms()}},
        )

    # ── worker registration ─────────────────────────────────────────────
    def set_worker(self, worker_id: str = "sim_worker") -> None:
        # The worker talks to MongoDB directly (server-side), so this just
        # records which process owns the simulation.
        self.db.config.update_one({"_id": 0}, {"$set": {"worker": worker_id}}, upsert=True)

    # ── human gameplay reducers ─────────────────────────────────────────
    def claim_seat(self, identity: str, agent_id: str) -> None:
        a = self.db.agents.find_one({"_id": agent_id})
        if a is None:
            raise StoreError("agent not found")
        if not a.get("playable"):
            raise StoreError("seat is not playable")
        owner = a.get("controlled_by")
        if owner is not None:
            if owner != identity:
                raise StoreError("seat already taken")
            return  # already ours — idempotent
        # Atomic claim: only succeeds if still free.
        res = self.db.agents.update_one(
            {"_id": agent_id, "controlled_by": None}, {"$set": {"controlled_by": identity}},
        )
        if res.modified_count == 0:
            raise StoreError("seat already taken")
        self._touch()

    def release_seat(self, identity: str, agent_id: str) -> None:
        if self.db.agents.find_one({"_id": agent_id}) is None:
            raise StoreError("agent not found")
        res = self.db.agents.update_one(
            {"_id": agent_id, "controlled_by": identity}, {"$set": {"controlled_by": None}},
        )
        if res.modified_count:
            self._touch()

    def submit_action(
        self, identity: str, agent_id: str, lever: str, value: float, text_value: str,
    ) -> None:
        a = self.db.agents.find_one({"_id": agent_id})
        if a is None:
            raise StoreError("agent not found")
        if a.get("controlled_by") != identity:
            raise StoreError("you do not control this seat")
        world = self._world()
        self.db.pending_actions.insert_one({
            "_id": self._next_id("pending_actions"),
            "round": world["current_round"], "agent_id": agent_id, "player": identity,
            "lever": lever, "value": float(value), "text_value": text_value,
            "created_at": _now_ms(),
        })
        self._touch()

    def post_chat(self, identity: str, agent_id: str, text: str) -> None:
        if not text.strip():
            raise StoreError("empty message")
        world = self._world()
        self.db.chat_messages.insert_one({
            "_id": self._next_id("chat_messages"),
            "agent_id": agent_id, "from_player": True,
            "author_label": self._player_label(identity), "text": text,
            "round": world["current_round"], "created_at": _now_ms(),
        })
        self._touch()

    # ── worker reducers (bulk world mutation) ───────────────────────────
    def seed_world(
        self,
        policy_text: str,
        objective: str,
        max_rounds: int,
        agents: list[dict[str, Any]],
        relationships: list[dict[str, Any]],
    ) -> None:
        db = self.db
        for name in ("agents", "indicators", *_SEQ_COLLECTIONS):
            db[name].delete_many({})

        if agents:
            db.agents.insert_many([{
                "_id": s["id"],
                "name": s.get("name", ""), "role": s.get("role", ""),
                "category": s.get("category", ""), "bio": s.get("bio", ""),
                "persona": s.get("persona", ""), "income_level": s.get("income_level", ""),
                "political_leaning": float(s.get("political_leaning", 0.0)),
                "reputation": float(s.get("reputation", 0.0)),
                "x": int(s.get("x", 0)), "y": int(s.get("y", 0)),
                "mood": s.get("mood", "neutral"), "current_plan": s.get("current_plan", ""),
                "profile_json": s.get("profile_json", ""), "playable": bool(s.get("playable", False)),
                "controlled_by": None,
            } for s in agents])

        if relationships:
            db.relationships.insert_many([{
                "_id": self._next_id("relationships"),
                "src": r["src"], "dst": r["dst"], "rel_type": r.get("rel_type", ""),
                "weight": float(r.get("weight", 0.0)),
            } for r in relationships])

        now = _now_ms()
        self._touch({
            "status": "running", "policy_text": policy_text, "objective": objective,
            "current_round": 0, "max_rounds": int(max_rounds), "phase": 0,
            "round_open": False, "round_deadline": now, "updated_at": now,
        })

    def open_round(self, round_num: int, phase: int, duration_secs: int) -> None:
        self._world()
        now = _now_ms()
        self._touch({
            "current_round": int(round_num), "phase": int(phase), "round_open": True,
            "round_deadline": now + int(duration_secs) * 1000, "status": "running",
            "updated_at": now,
        })

    def apply_round(
        self,
        round_num: int,
        phase: int,
        agent_updates: list[dict[str, Any]],
        events: list[dict[str, Any]],
        indicators: list[dict[str, Any]],
        clear_actions: bool = True,
    ) -> None:
        db = self.db
        fields = ("x", "y", "mood", "current_plan", "reputation", "profile_json")
        for u in agent_updates:
            # Never touches `controlled_by`.
            patch = {k: u[k] for k in fields if u.get(k) is not None}
            if patch:
                db.agents.update_one({"_id": u["id"]}, {"$set": patch})

        now = _now_ms()
        if events:
            db.sim_events.insert_many([{
                "_id": self._next_id("sim_events"),
                "round": int(round_num), "agent_id": e["agent_id"], "event_type": e["event_type"],
                "message": e.get("message", ""), "data_json": e.get("data_json", ""),
                "created_at": now,
            } for e in events])

        for i in indicators:
            db.indicators.update_one({"_id": i["key"]}, {"$set": {"value": float(i["value"])}}, upsert=True)

        if clear_actions:
            db.pending_actions.delete_many({"round": {"$lte": int(round_num)}})

        world = self._world()
        max_rounds = int(world.get("max_rounds", 0))
        status = "complete" if max_rounds > 0 and round_num + 1 >= max_rounds else "running"
        self._touch({
            "current_round": int(round_num), "phase": int(phase), "round_open": False,
            "status": status, "updated_at": now,
        })

    def post_agent_chat(self, agent_id: str, author_label: str, text: str) -> None:
        world = self._world()
        self.db.chat_messages.insert_one({
            "_id": self._next_id("chat_messages"),
            "agent_id": agent_id, "from_player": False, "author_label": author_label,
            "text": text, "round": world["current_round"], "created_at": _now_ms(),
        })
        self._touch()

    # ── crises ──────────────────────────────────────────────────────────
    def spawn_crisis(
        self, round_num: int, title: str, description: str, option_a: str, option_b: str,
        target_role: str, deadline: int,
    ) -> int:
        cid = self._next_id("crises")
        self.db.crises.insert_one({
            "_id": cid, "round": int(round_num), "title": title, "description": description,
            "option_a": option_a, "option_b": option_b, "target_role": target_role,
            "status": "open", "chosen": -1, "deadline": int(deadline), "created_at": _now_ms(),
        })
        self._touch()
        return cid

    def resolve_crisis(self, identity: str, crisis_id: int, option: int) -> None:
        c = self.db.crises.find_one({"_id": int(crisis_id)})
        if c is None:
            raise StoreError("crisis not found")
        res = self.db.crises.update_one(
            {"_id": int(crisis_id), "status": "open"},
            {"$set": {"status": "resolved", "chosen": 1 if int(option) == 1 else 0}},
        )
        if res.modified_count == 0:
            raise StoreError("crisis already resolved")
        self._touch()

    def close_crisis(self, crisis_id: int) -> None:
        self.db.crises.update_one({"_id": int(crisis_id)}, {"$set": {"status": "done"}})
        self._touch()

    def get_crises(self) -> list[dict[str, Any]]:
        return [_with_id(c) for c in self.db.crises.find().sort("_id", ASCENDING)]

    # ── deals ───────────────────────────────────────────────────────────
    def propose_deal(
        self, identity: str, from_agent: str, to_agent: str, kind: str, text: str,
    ) -> None:
        a = self.db.agents.find_one({"_id": from_agent})
        if a is None:
            raise StoreError("proposer not found")
        if a.get("controlled_by") != identity:
            raise StoreError("you do not control the proposing seat")
        world = self._world()
        self.db.deals.insert_one({
            "_id": self._next_id("deals"),
            "from_agent": from_agent, "to_agent": to_agent,
            "from_label": self._player_label(identity), "kind": kind, "text": text,
            "status": "pending", "round": world["current_round"], "created_at": _now_ms(),
        })
        self._touch()

    def respond_deal(self, identity: str, deal_id: int, accept: bool) -> None:
        if self.db.deals.find_one({"_id": int(deal_id)}) is None:
            raise StoreError("deal not found")
        res = self.db.deals.update_one(
            {"_id": int(deal_id), "status": "pending"},
            {"$set": {"status": "accepted" if accept else "rejected"}},
        )
        if res.modified_count == 0:
            raise StoreError("deal already handled")
        self._touch()

    def close_deal(self, deal_id: int) -> None:
        self.db.deals.update_one({"_id": int(deal_id)}, {"$set": {"status": "done"}})
        self._touch()

    def get_deals(self) -> list[dict[str, Any]]:
        return [_with_id(d) for d in self.db.deals.find().sort("_id", ASCENDING)]

    # ── reads used by the round loop ────────────────────────────────────
    def get_world(self) -> dict[str, Any] | None:
        w = self.db.world.find_one({"_id": 0})
        return _with_id(w) if w else None

    def get_agents(self) -> list[dict[str, Any]]:
        return [_with_id(a) for a in self.db.agents.find()]

    def get_pending_actions(self, round_num: int) -> list[dict[str, Any]]:
        return [_with_id(p) for p in self.db.pending_actions.find({"round": int(round_num)})]

    # ── snapshot for browsers (camelCase, same shape as the old TS bindings) ─
    def snapshot(self, events_after: int = 0) -> dict[str, Any]:
        db = self.db
        w = self._world()
        return {
            "version": int(w.get("version", 0)),
            "world": [{
                "id": 0, "status": w["status"], "policyText": w["policy_text"],
                "objective": w["objective"], "currentRound": w["current_round"],
                "maxRounds": w["max_rounds"], "phase": w["phase"], "roundOpen": w["round_open"],
                "roundDeadline": w["round_deadline"], "updatedAt": w["updated_at"],
            }],
            "agent": [{
                "id": a["_id"], "name": a["name"], "role": a["role"], "category": a["category"],
                "bio": a["bio"], "persona": a["persona"], "incomeLevel": a["income_level"],
                "politicalLeaning": a["political_leaning"], "reputation": a["reputation"],
                "x": a["x"], "y": a["y"], "mood": a["mood"], "currentPlan": a["current_plan"],
                "profileJson": a["profile_json"], "playable": a["playable"],
                "controlledBy": a.get("controlled_by"),
            } for a in db.agents.find()],
            "relationship": [{
                "id": r["_id"], "src": r["src"], "dst": r["dst"],
                "relType": r["rel_type"], "weight": r["weight"],
            } for r in db.relationships.find()],
            "sim_event": [{
                "id": e["_id"], "round": e["round"], "agentId": e["agent_id"],
                "eventType": e["event_type"], "message": e["message"], "dataJson": e["data_json"],
            } for e in db.sim_events.find({"_id": {"$gt": int(events_after)}}).sort("_id", ASCENDING)],
            "indicator": [{"key": i["_id"], "value": i["value"]} for i in db.indicators.find()],
            "player": [{
                "identity": p["_id"], "displayName": p["display_name"], "online": p["online"],
            } for p in db.players.find()],
            "chat_message": [{
                "id": c["_id"], "agentId": c["agent_id"], "fromPlayer": c["from_player"],
                "authorLabel": c["author_label"], "text": c["text"], "round": c["round"],
            } for c in db.chat_messages.find().sort("_id", ASCENDING)],
            "crisis": [{
                "id": c["_id"], "round": c["round"], "title": c["title"],
                "description": c["description"], "optionA": c["option_a"],
                "optionB": c["option_b"], "targetRole": c["target_role"], "status": c["status"],
                "chosen": c["chosen"], "deadline": c["deadline"],
            } for c in db.crises.find().sort("_id", ASCENDING)],
            "deal": [{
                "id": d["_id"], "fromAgent": d["from_agent"], "toAgent": d["to_agent"],
                "fromLabel": d["from_label"], "kind": d["kind"], "text": d["text"],
                "status": d["status"], "round": d["round"],
            } for d in db.deals.find().sort("_id", ASCENDING)],
        }


def _with_id(doc: dict[str, Any]) -> dict[str, Any]:
    out = dict(doc)
    out["id"] = out.pop("_id")
    return out

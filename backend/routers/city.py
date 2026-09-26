"""Multiplayer "playable city" transport (replaces the SpacetimeDB client SDK).

Browsers open ``WS /city/ws?token=<saved token>``. The server:
  * assigns/restores an identity (hash of the token) and sends ``hello``,
  * pushes a ``state`` snapshot whenever MongoDB's ``world.version`` changes
    (writes from humans *and* from the separate sim worker process),
  * executes ``call`` messages against the same reducer names as before
    (claim_seat, submit_action, ...) and answers with ``result``.
On the last socket of an identity closing, its seats are released
(former ``client_disconnected`` reducer).
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import secrets
import subprocess
import sys
from pathlib import Path
from collections import Counter
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services.mongo_store import MongoCityStore, StoreError

logger = logging.getLogger(__name__)

router = APIRouter()

POLL_SECONDS = 0.4

_store: MongoCityStore | None = None
_connections: Counter[str] = Counter()


def get_store() -> MongoCityStore:
    global _store
    if _store is None:
        _store = MongoCityStore()
    return _store


# reducer name -> (store method, positional arg names from the client payload)
_REDUCERS: dict[str, tuple[str, tuple[str, ...]]] = {
    "register_player": ("register_player", ("name",)),
    "heartbeat": ("heartbeat", ()),
    "claim_seat": ("claim_seat", ("agentId",)),
    "release_seat": ("release_seat", ("agentId",)),
    "submit_action": ("submit_action", ("agentId", "lever", "value", "textValue")),
    "post_chat": ("post_chat", ("agentId", "text")),
    "resolve_crisis": ("resolve_crisis", ("crisisId", "option")),
    "propose_deal": ("propose_deal", ("fromAgent", "toAgent", "kind", "text")),
    "respond_deal": ("respond_deal", ("dealId", "accept")),
}


@router.get("/city/health")
async def city_health() -> dict[str, Any]:
    store = get_store()
    await asyncio.to_thread(store.client.admin.command, "ping")
    return {"ok": True, "db": store.db.name, "version": await asyncio.to_thread(store.version)}


_BACKEND_DIR = Path(__file__).resolve().parent.parent
_WORKER_LOG = os.environ.get("SIM_WORKER_LOG", "/tmp/simulacra-worker.log")


@router.post("/city/restart")
async def city_restart() -> dict[str, Any]:
    """Start a fresh match: stop any running sim worker and launch a new one.

    Round count etc. come from this process's env (SIM_ROUNDS, SIM_CRISIS_START,
    SIM_ROUND_SECONDS), defaulting to the short demo match.
    """
    subprocess.run(["pkill", "-f", r"python[0-9.]* sim_worker\.py$"], check=False)
    await asyncio.sleep(1)
    env = {
        **os.environ,
        "SIM_ROUNDS": os.environ.get("SIM_ROUNDS", "3"),
        "SIM_CRISIS_START": os.environ.get("SIM_CRISIS_START", "0"),
        "SIM_ROUND_SECONDS": os.environ.get("SIM_ROUND_SECONDS", "25"),
    }
    with open(_WORKER_LOG, "w") as log:
        subprocess.Popen(
            [sys.executable, "sim_worker.py"], cwd=_BACKEND_DIR, env=env,
            stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
        )
    logger.info("new match started (%s rounds)", env["SIM_ROUNDS"])
    return {"ok": True, "rounds": int(env["SIM_ROUNDS"])}


@router.websocket("/city/ws")
async def city_ws(ws: WebSocket) -> None:
    await ws.accept()
    store = get_store()
    token = ws.query_params.get("token") or secrets.token_hex(32)
    identity = hashlib.sha256(token.encode()).hexdigest()

    _connections[identity] += 1
    await asyncio.to_thread(store.identity_connected, identity)
    await ws.send_json({"type": "hello", "identity": identity, "token": token})

    last_version = -1
    last_event_id = 0

    async def push_loop() -> None:
        nonlocal last_version, last_event_id
        while True:
            version = await asyncio.to_thread(store.version)
            if version != last_version:
                last_version = version
                snap = await asyncio.to_thread(store.snapshot, last_event_id)
                if snap["sim_event"]:
                    last_event_id = int(snap["sim_event"][-1]["id"])
                await ws.send_json({"type": "state", **snap})
            await asyncio.sleep(POLL_SECONDS)

    pusher = asyncio.create_task(push_loop())
    try:
        while True:
            msg = await ws.receive_json()
            if msg.get("type") != "call":
                continue
            req_id = msg.get("reqId")
            name = msg.get("reducer", "")
            args = msg.get("args") or {}
            spec = _REDUCERS.get(name)
            error: str | None = None
            if name == "restart_game":
                await city_restart()
            elif spec is None:
                error = f"unknown reducer: {name}"
            else:
                method, names = spec
                try:
                    await asyncio.to_thread(
                        getattr(store, method), identity, *[args.get(n) for n in names],
                    )
                except StoreError as exc:
                    error = str(exc)
                except Exception as exc:  # pragma: no cover - defensive
                    logger.exception("reducer %s failed", name)
                    error = f"internal error: {exc}"
            await ws.send_json({"type": "result", "reqId": req_id, "error": error})
    except WebSocketDisconnect:
        pass
    finally:
        pusher.cancel()
        _connections[identity] -= 1
        if _connections[identity] <= 0:
            del _connections[identity]
            await asyncio.to_thread(store.identity_disconnected, identity)

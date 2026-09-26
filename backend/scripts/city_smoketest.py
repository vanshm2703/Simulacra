"""Headless multiplayer smoke test for the MongoDB-backed city (replaces stdb-smoketest.ts).

Run with the backend + sim worker up:  uv run python scripts/city_smoketest.py
"""
import asyncio, json, os, sys
import websockets

WS = os.environ.get("CITY_WS", "ws://127.0.0.1:8000/city/ws")


class Client:
    def __init__(self, ws):
        self.ws, self.state, self.seq, self.identity = ws, {}, 0, None
        self.results: dict[int, asyncio.Future] = {}
        self.task = asyncio.create_task(self._reader())

    async def _reader(self):
        async for raw in self.ws:
            m = json.loads(raw)
            if m["type"] == "hello":
                self.identity = m["identity"]
            elif m["type"] == "state":
                self.state = m
            elif m["type"] == "result":
                self.results.pop(m["reqId"]).set_result(m["error"])

    async def call(self, reducer, **args):
        self.seq += 1
        fut = asyncio.get_running_loop().create_future()
        self.results[self.seq] = fut
        await self.ws.send(json.dumps({"type": "call", "reqId": self.seq, "reducer": reducer, "args": args}))
        return await fut

    def agent(self, aid):
        return next(a for a in self.state["agent"] if a["id"] == aid)


def check(cond, label):
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        sys.exit(1)


async def main():
    async with websockets.connect(WS) as w1, websockets.connect(WS) as w2:
        a, b = Client(w1), Client(w2)
        await asyncio.sleep(1)
        check(a.identity and b.identity and a.identity != b.identity, "two distinct identities")
        check(len(a.state.get("agent", [])) > 0, f"snapshot has {len(a.state['agent'])} agents")
        check(await a.call("register_player", name="alice") is None, "register_player")
        await b.call("register_player", name="bob")
        check(await a.call("claim_seat", agentId="gov_central_bank") is None, "alice claims Central Bank")
        err = await b.call("claim_seat", agentId="gov_central_bank")
        check(err == "seat already taken", f"bob rejected: {err}")
        err = await b.call("submit_action", agentId="gov_central_bank", lever="interest_rate", value=9.5, textValue="")
        check(err == "you do not control this seat", "bob cannot act on alice's seat")
        await asyncio.sleep(1)
        check(b.agent("gov_central_bank")["controlledBy"] == a.identity, "claim broadcast to bob")
        names = {p["displayName"] for p in b.state["player"] if p["online"]}
        check({"alice", "bob"} <= names, f"presence: {sorted(names)}")
        # Submit the lever while a round is open.
        for _ in range(40):
            if a.state["world"][0]["roundOpen"]:
                break
            await asyncio.sleep(0.5)
        check(await a.call("submit_action", agentId="gov_central_bank", lever="interest_rate", value=9.5, textValue="") is None, "alice submits interest_rate=9.5")
        check(await a.call("post_chat", agentId="gov_central_bank", text="hello city") is None, "post_chat")
        # Wait for the worker to apply the round.
        for _ in range(40):
            rate = next((i["value"] for i in b.state["indicator"] if i["key"] == "interest_rate"), None)
            if rate is not None and abs(rate - 9.5) < 0.01:
                break
            await asyncio.sleep(0.5)
        check(abs(rate - 9.5) < 0.01, f"worker honored lever, bob sees interest_rate={rate}")
        check(len(b.state["sim_event"]) >= 0 and any(c["text"] == "hello city" for c in b.state["chat_message"]), "chat visible to bob")
    # alice disconnected -> seat released
    async with websockets.connect(WS) as w3:
        c = Client(w3)
        await asyncio.sleep(1)
        check(c.agent("gov_central_bank")["controlledBy"] is None, "seat auto-released on disconnect")
    print("ALL PASS")

asyncio.run(main())

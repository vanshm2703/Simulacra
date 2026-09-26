"use client";

// useStdbCity — the live-city hook (MongoDB via the backend `/city/ws` socket;
// originally SpacetimeDB — the name is kept so callers don't change).
//
// Subscribes to the city's collections and:
//   * feeds the existing Phaser EventBridge (init NPCs, moves, moods, events),
//   * derives Dashboard metrics + history, SocialGraph data, and the event feed,
//   * exposes seats/presence and the reducer callers for the role UI.
//
// Every connected browser runs this hook, so all clients render the same live
// city from the same subscribed rows.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCityConnection, useReducer, useTable } from "@/services/cityConnection";
import { eventBridge } from "@/game/bridge/EventBridge";
import {
  adaptAgentToNpc,
  adaptEvent,
  adaptRelationship,
  type AgentRow,
  indicatorsToMetrics,
  type SimEventRow,
} from "@/lib/stdbAdapt";
import type { SimEvent, SimMetrics } from "@/types";

const MAX_FEED = 200;
const MAX_HISTORY = 30;

export interface Seat {
  id: string;
  name: string;
  role: string;
  category: string;
  playable: boolean;
  controlledByHex: string | null;
  mine: boolean;
}

export interface Crisis {
  id: bigint;
  round: number;
  title: string;
  description: string;
  optionA: string;
  optionB: string;
  targetRole: string;
  status: string;
  chosen: number;
  deadline: number;
}

export interface Deal {
  id: bigint;
  fromAgent: string;
  toAgent: string;
  fromLabel: string;
  kind: string;
  text: string;
  status: string;
  round: number;
}

export function useStdbCity() {
  const stdb = useCityConnection();
  const myHex = stdb.identity?.toHexString() ?? null;

  // ── Reducer callers ────────────────────────────────────────────────
  // Generated callers take a single named-params object; wrap them so callers
  // get friendly positional signatures.
  const _claimSeat = useReducer("claim_seat");
  const _releaseSeat = useReducer("release_seat");
  const _submitAction = useReducer("submit_action");
  const _postChat = useReducer("post_chat");
  const _registerPlayer = useReducer("register_player");
  const _resolveCrisis = useReducer("resolve_crisis");
  const _proposeDeal = useReducer("propose_deal");
  const _respondDeal = useReducer("respond_deal");

  const claimSeat = useCallback((agentId: string) => _claimSeat({ agentId }), [_claimSeat]);
  const releaseSeat = useCallback((agentId: string) => _releaseSeat({ agentId }), [_releaseSeat]);
  const submitAction = useCallback(
    (agentId: string, lever: string, value: number, text: string) =>
      _submitAction({ agentId, lever, value, textValue: text }),
    [_submitAction],
  );
  const postChat = useCallback(
    (agentId: string, text: string) => _postChat({ agentId, text }),
    [_postChat],
  );
  const registerPlayer = useCallback(
    (name: string) => _registerPlayer({ name }),
    [_registerPlayer],
  );
  const resolveCrisis = useCallback(
    (crisisId: bigint, option: number) => _resolveCrisis({ crisisId, option }),
    [_resolveCrisis],
  );
  const proposeDeal = useCallback(
    (fromAgent: string, toAgent: string, kind: string, text: string) =>
      _proposeDeal({ fromAgent, toAgent, kind, text }),
    [_proposeDeal],
  );
  const respondDeal = useCallback(
    (dealId: bigint, accept: boolean) => _respondDeal({ dealId, accept }),
    [_respondDeal],
  );

  // ── World ──────────────────────────────────────────────────────────
  const [worlds] = useTable("world");
  const world = worlds[0] as unknown as
    | {
        status: string;
        currentRound: number;
        maxRounds: number;
        phase: number;
        roundOpen: boolean;
        roundDeadline: { toDate(): Date };
        policyText: string;
      }
    | undefined;
  const maxRounds = world?.maxRounds ?? 1;
  const round = world?.currentRound ?? 0;
  const phase = world?.phase ?? 0;
  const maxRoundsRef = useRef(maxRounds);
  maxRoundsRef.current = maxRounds;

  // ── Agents (seats + NPC roster) ────────────────────────────────────
  const [agentRows, agentsReady] = useTable("agent");
  const agents = agentRows as unknown as AgentRow[];

  // Keep a live id->row map for event enrichment.
  const agentMapRef = useRef<Map<string, AgentRow>>(new Map());
  useEffect(() => {
    const m = new Map<string, AgentRow>();
    for (const a of agents) m.set(a.id, a);
    agentMapRef.current = m;
  }, [agents]);

  // Initialize Phaser NPCs once the roster has loaded.
  const initedRef = useRef(false);
  useEffect(() => {
    if (agentsReady && agents.length > 0 && !initedRef.current) {
      initedRef.current = true;
      eventBridge.emitInitNPCs(agents.map(adaptAgentToNpc));
    }
  }, [agentsReady, agents]);

  // ── Events: drive city motion + the feed ───────────────────────────
  const [events, setEvents] = useState<SimEvent[]>([]);
  // De-dupe: a subscription can replay rows we've already seen.
  const seenEventIds = useRef<Set<string>>(new Set());
  useTable("sim_event", {
    onInsert: (rawRow) => {
      const row = rawRow as unknown as SimEventRow;
      const id = String(row.id);
      if (seenEventIds.current.has(id)) return;
      seenEventIds.current.add(id);
      const a = agentMapRef.current.get(row.agentId);
      const adapted = adaptEvent(row, a?.name ?? row.agentId, a?.category, maxRoundsRef.current);
      const data = adapted.data ?? {};
      if (row.eventType === "move" && data.to_x != null && data.to_y != null) {
        eventBridge.emitNPCMove(row.agentId, Number(data.to_x), Number(data.to_y));
      }
      if (row.eventType === "mood_shift" && typeof data.new_mood === "string") {
        eventBridge.emitNPCMood(row.agentId, data.new_mood);
      }
      eventBridge.emitSimEvent(adapted);
      setEvents((prev) =>
        prev.length >= MAX_FEED ? [...prev.slice(-MAX_FEED + 1), adapted] : [...prev, adapted],
      );
    },
  });

  // Emit a phase-change pulse when the world advances phase.
  const lastPhaseRef = useRef(0);
  useEffect(() => {
    if (phase > lastPhaseRef.current) {
      lastPhaseRef.current = phase;
      eventBridge.emitPhaseChange(phase, round, undefined);
    }
  }, [phase, round]);

  // ── Indicators -> metrics (+ per-round history) ────────────────────
  const [indRows] = useTable("indicator");
  const metrics = useMemo(
    () => indicatorsToMetrics(indRows as unknown as { key: string; value: number }[]),
    [indRows],
  );
  const [metricsHistory, setMetricsHistory] = useState<SimMetrics[]>([metrics]);
  const histRoundRef = useRef(-1);
  useEffect(() => {
    if (round !== histRoundRef.current) {
      histRoundRef.current = round;
      setMetricsHistory((prev) => [...prev, metrics].slice(-MAX_HISTORY));
    }
  }, [round, metrics]);

  // ── Relationships + graph data ─────────────────────────────────────
  const [relRows] = useTable("relationship");
  const graphData = useMemo(() => {
    const rels = (relRows as unknown as {
      src: string;
      dst: string;
      relType: string;
      weight: number;
    }[]).map((r) => adaptRelationship(r.src, r.dst, r.relType, r.weight));
    return {
      relationships: rels,
      npcs: agents.map(adaptAgentToNpc),
      influenceEvents: [],
      version: rels.length + agents.length + round,
    };
  }, [relRows, agents, round]);

  // ── Seats + presence ───────────────────────────────────────────────
  const seats: Seat[] = useMemo(
    () =>
      agents
        .filter((a) => a.playable)
        .map((a) => {
          const hex = a.controlledBy ? a.controlledBy.toHexString() : null;
          return {
            id: a.id,
            name: a.name,
            role: a.role,
            category: a.category,
            playable: a.playable,
            controlledByHex: hex,
            mine: hex != null && hex === myHex,
          };
        }),
    [agents, myHex],
  );

  const [players] = useTable("player");
  const onlinePlayers = useMemo(
    () =>
      (players as unknown as { displayName: string; online: boolean }[]).filter(
        (p) => p.online,
      ),
    [players],
  );

  // ── Crises (breaking events awaiting a decision) ───────────────────────────
  const [crisisRows] = useTable("crisis");
  const openCrises = useMemo(
    () =>
      (crisisRows as unknown as Crisis[]).filter((c) => c.status === "open"),
    [crisisRows],
  );

  // ── Deals (player proposals awaiting a response) ───────────────────────────
  const [dealRows] = useTable("deal");
  const pendingDeals = useMemo(
    () => (dealRows as unknown as Deal[]).filter((d) => d.status === "pending"),
    [dealRows],
  );

  return {
    connected: stdb.isActive,
    myHex,
    world,
    status: world?.status ?? "idle",
    round,
    phase,
    maxRounds,
    roundOpen: world?.roundOpen ?? false,
    roundDeadline: world?.roundDeadline,
    policyText: world?.policyText ?? "",
    agents,
    seats,
    onlinePlayers,
    openCrises,
    resolveCrisis,
    pendingDeals,
    proposeDeal,
    respondDeal,
    events,
    metrics,
    metricsHistory,
    graphData,
    // reducer actions
    claimSeat,
    releaseSeat,
    submitAction,
    postChat,
    registerPlayer,
  };
}

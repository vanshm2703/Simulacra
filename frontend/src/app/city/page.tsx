"use client";

// /city — the multiplayer "playable city".
//
// Wraps the app in a live MongoDB-backed city connection and renders the same Phaser city +
// dashboards as the single-player view, plus the role UI (claim a seat, pull a
// lever). Every browser that opens this page joins the same live world.

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActionPanel } from "@/components/ActionPanel";
import { type AgentMeta, CityFeed } from "@/components/CityFeed";
import { CityStats } from "@/components/CityStats";
import { CrisisModal } from "@/components/CrisisModal";
import { DealPanel } from "@/components/DealPanel";
import { MissionCard } from "@/components/MissionCard";
import { PresenceBar } from "@/components/PresenceBar";
import { RoundTimer } from "@/components/RoundTimer";
import { ScorecardModal } from "@/components/ScorecardModal";
import { SeatPicker } from "@/components/SeatPicker";
import { useStdbCity } from "@/hooks/useStdbCity";
import { CityProvider, restartGame, useCityConnection } from "@/services/cityConnection";

const NAME_KEY = "simulacra_name";

const GameCanvas = dynamic(
  () => import("@/components/GameCanvas").then((m) => ({ default: m.GameCanvas })),
  { ssr: false, loading: () => <CanvasPlaceholder /> },
);
const SocialGraph = dynamic(
  () => import("@/components/SocialGraph").then((m) => ({ default: m.SocialGraph })),
  { ssr: false },
);

function CanvasPlaceholder() {
  return (
    <div className="rpg-panel flex h-full w-full items-center justify-center" style={{ background: "#E8D5A3" }}>
      <span className="animate-pulse text-[8px] font-pixel uppercase tracking-widest" style={{ color: "#A0824A" }}>
        Loading city…
      </span>
    </div>
  );
}

function CityInner() {
  const city = useStdbCity();
  const stdb = useCityConnection();
  const [showGraph, setShowGraph] = useState(false);
  const [scorecardDismissed, setScorecardDismissed] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const newGame = () => {
    if (restarting) return;
    setRestarting(true);
    restartGame(stdb.call).catch((e) => {
      console.error("[restart]", e);
      setRestarting(false);
    });
  };

  // Register a display name once connected.
  const registeredRef = useRef(false);
  useEffect(() => {
    if (stdb.isActive && !registeredRef.current) {
      registeredRef.current = true;
      let name = window.localStorage.getItem(NAME_KEY);
      if (!name) {
        name = `guest-${Math.random().toString(36).slice(2, 6)}`;
        window.localStorage.setItem(NAME_KEY, name);
      }
      city.registerPlayer(name).catch((e) => console.error("[register]", e));
    }
  }, [stdb.isActive, city]);

  // Re-arm the scorecard whenever a new match starts (status leaves "complete").
  useEffect(() => {
    if (city.status !== "complete") setScorecardDismissed(false);
  }, [city.status]);

  const mySeats = city.seats.filter((s) => s.mine);

  // id -> display meta, resolved at render time so the feed never shows raw IDs.
  const agentMeta = useMemo(() => {
    const m = new Map<string, AgentMeta>();
    for (const a of city.agents) {
      m.set(a.id, { name: a.name, role: a.role, category: a.category });
    }
    return m;
  }, [city.agents]);

  return (
    <div className="flex h-screen w-screen flex-col gap-2 p-2" style={{ background: "#1a1208" }}>
      {/* Top bar */}
      <div className="flex items-center gap-2">
        <Link
          href="/"
          className="rpg-panel px-3 py-2 text-[8px] font-pixel uppercase"
          style={{ background: "#E8D5A3", color: "#7A4E1E" }}
        >
          ← Menu
        </Link>
        <RoundTimer
          round={city.round}
          maxRounds={city.maxRounds}
          phase={city.phase}
          roundOpen={city.roundOpen}
          status={city.status}
          roundDeadline={city.roundDeadline}
        />
        <PresenceBar players={city.onlinePlayers} />
        <button
          type="button"
          onClick={newGame}
          disabled={restarting}
          className="rpg-panel px-3 py-2 text-[8px] font-pixel uppercase"
          style={{ background: "#3E7C34", color: "#fff", opacity: restarting ? 0.6 : 1 }}
        >
          {restarting ? "Starting…" : "↻ New game"}
        </button>
        <div
          className="rpg-panel ml-auto flex items-center px-3 py-2 text-[8px] font-pixel uppercase"
          style={{ background: "#E8D5A3", color: city.connected ? "#3E7C34" : "#8B3A3A" }}
        >
          {city.connected ? "● live" : "○ connecting"}
        </div>
      </div>

      {/* Policy line */}
      {city.policyText && (
        <div className="rpg-panel px-3 py-1.5 text-[8px]" style={{ background: "#F2E6C8", color: "#5B3A1E" }}>
          <span className="font-pixel uppercase" style={{ color: "#8B7355" }}>Policy: </span>
          {city.policyText}
        </div>
      )}

      {/* Main grid */}
      <div className="flex min-h-0 flex-1 gap-2">
        {/* Left: roles + levers */}
        <div className="flex w-64 shrink-0 flex-col gap-2 overflow-y-auto">
          <SeatPicker seats={city.seats} onClaim={city.claimSeat} onRelease={city.releaseSeat} />
          {mySeats.length === 0 ? (
            <div
              className="rpg-panel px-3 py-3 text-center text-[10px] leading-relaxed"
              style={{ background: "#F7EFD8", color: "#7A4E1E", fontFamily: "var(--font-geist-mono)" }}
            >
              👆 <span className="font-pixel text-[8px]">Claim a role</span> to start steering
              the city. Each role has its own mission, levers, and powers.
            </div>
          ) : (
            <>
              {mySeats.map((s) => (
                <MissionCard key={`m-${s.id}`} agentId={s.id} seatName={s.name} metrics={city.metrics} />
              ))}
              <ActionPanel seats={mySeats} roundOpen={city.roundOpen} round={city.round} onSubmit={city.submitAction} />
              <DealPanel
                mySeats={mySeats}
                pendingDeals={city.pendingDeals}
                onPropose={city.proposeDeal}
                onRespond={city.respondDeal}
              />
            </>
          )}
        </div>

        {/* Center: the city */}
        <div className="min-w-0 flex-1">
          <GameCanvas />
        </div>

        {/* Right: live stats (always) + optional social graph */}
        <div className="flex shrink-0 flex-col gap-2">
          <CityStats
            metrics={city.metrics}
            history={city.metricsHistory}
            phase={city.phase}
            round={city.round}
            maxRounds={city.maxRounds}
          />
          <button
            type="button"
            onClick={() => setShowGraph((v) => !v)}
            className="rpg-panel px-2 py-1.5 text-[8px] font-pixel uppercase"
            style={{ background: "#E8D5A3", color: "#7A4E1E" }}
          >
            {showGraph ? "Hide social graph" : "Show social graph"}
          </button>
          {showGraph && (
            <div className="rpg-panel min-h-0 flex-1" style={{ width: 256 }}>
              <SocialGraph
                npcs={city.graphData.npcs}
                relationships={city.graphData.relationships}
                influenceEvents={city.graphData.influenceEvents}
                version={city.graphData.version}
              />
            </div>
          )}
        </div>
      </div>

      {/* Bottom: readable city feed */}
      <div className="h-44 shrink-0">
        <CityFeed events={city.events} agentMeta={agentMeta} />
      </div>

      {/* Breaking crisis (newest open one) */}
      {city.openCrises.length > 0 && city.status !== "complete" && (
        <CrisisModal
          crisis={city.openCrises[city.openCrises.length - 1]}
          round={city.round}
          onResolve={city.resolveCrisis}
        />
      )}

      {/* End-of-match scorecard */}
      {city.status === "complete" && !scorecardDismissed && (
        <ScorecardModal
          metrics={city.metrics}
          rounds={city.maxRounds}
          onClose={() => setScorecardDismissed(true)}
          onNewGame={newGame}
        />
      )}
    </div>
  );
}

export default function CityPage() {
  // Avoid building the WS connection during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: "#1a1208" }}>
        <span className="animate-pulse text-[10px] font-pixel uppercase tracking-widest" style={{ color: "#A0824A" }}>
          Connecting to the city…
        </span>
      </div>
    );
  }
  return (
    <CityProvider>
      <CityInner />
    </CityProvider>
  );
}

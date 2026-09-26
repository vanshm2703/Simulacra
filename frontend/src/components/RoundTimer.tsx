"use client";

// RoundTimer — shows the current round/phase and counts down the action window
// from world.roundDeadline (a SpacetimeDB Timestamp).

import { useEffect, useState } from "react";

interface Props {
  round: number;
  maxRounds: number;
  phase: number;
  roundOpen: boolean;
  status: string;
  roundDeadline?: { toDate(): Date };
}

export function RoundTimer({ round, maxRounds, phase, roundOpen, status, roundDeadline }: Props) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!roundOpen || !roundDeadline) {
      setRemaining(0);
      return;
    }
    const target = roundDeadline.toDate().getTime();
    const tick = () => setRemaining(Math.max(0, Math.ceil((target - Date.now()) / 1000)));
    tick();
    const h = setInterval(tick, 250);
    return () => clearInterval(h);
  }, [roundOpen, roundDeadline]);

  const done = status === "complete";

  return (
    <div
      className="rpg-panel flex items-center gap-3 px-3 py-2"
      data-testid="round-timer"
      style={{ background: "#E8D5A3" }}
    >
      <span className="text-[8px] font-pixel uppercase" style={{ color: "#5B3A1E" }}>
        Phase {phase || "-"}
      </span>
      <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "#8B7355" }}>
        Round {round}/{maxRounds}
      </span>
      <span
        className="ml-auto text-[9px] font-pixel uppercase"
        style={{ color: done ? "#8B3A3A" : roundOpen ? "#3E7C34" : "#A0824A" }}
      >
        {done ? "Complete" : roundOpen ? `${remaining}s to act` : "Resolving…"}
      </span>
    </div>
  );
}

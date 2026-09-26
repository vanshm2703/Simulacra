"use client";

// MissionCard — shows a held seat's objective + a live grade/progress bar that
// updates every round, so you always know if you're winning your role.

import { grade, MISSIONS, scoreColor, statusText } from "@/lib/missions";
import type { SimMetrics } from "@/types";

interface Props {
  agentId: string;
  seatName: string;
  metrics: SimMetrics;
}

export function MissionCard({ agentId, seatName, metrics }: Props) {
  const mission = MISSIONS[agentId];
  if (!mission) return null;
  const score = Math.round(mission.score(metrics));
  const col = scoreColor(score);

  return (
    <div
      className="rpg-panel flex flex-col gap-1 px-3 py-2"
      data-testid="mission-card"
      style={{ background: "#F7EFD8", border: "2px solid #C4A46C" }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-pixel uppercase" style={{ color: "#5B3A1E" }}>
          🎯 {mission.title}
        </span>
        <span className="text-[14px] font-pixel" style={{ color: col }}>
          {grade(score)}
        </span>
      </div>
      <span className="text-[8px] leading-snug" style={{ color: "#7A4E1E", fontFamily: "var(--font-geist-mono)" }}>
        {mission.objective}
      </span>
      <div className="mt-0.5 flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded" style={{ background: "#D8C49A" }}>
          <div className="h-full transition-all" style={{ width: `${score}%`, background: col }} />
        </div>
        <span className="text-[8px] font-mono tabular-nums" style={{ color: col }}>
          {score}
        </span>
      </div>
      <span className="text-[7px] font-pixel uppercase" style={{ color: col }}>
        {seatName}: {statusText(score)}
      </span>
    </div>
  );
}

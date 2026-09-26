"use client";

// CityStats — the six macro indicators as readable cards with a live delta vs
// the previous round and good/bad coloring. Replaces the tiny dashboard readout
// in the multiplayer view.

import type { SimMetrics } from "@/types";

interface Props {
  metrics: SimMetrics;
  history: SimMetrics[];
  phase: number;
  round: number;
  maxRounds: number;
}

type Stat = {
  key: keyof SimMetrics;
  label: string;
  fmt: (v: number) => string;
  // is a higher value good? "high" | "low" | "mid" (near a target)
  good: "high" | "low" | "mid";
  target?: number;
};

const STATS: Stat[] = [
  { key: "priceIndex", label: "Prices", fmt: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`, good: "mid", target: 1 },
  { key: "unemploymentRate", label: "Unemployment", fmt: (v) => `${v.toFixed(1)}%`, good: "low" },
  { key: "interestRate", label: "Interest rate", fmt: (v) => `${v.toFixed(2)}%`, good: "mid", target: 5 },
  { key: "govApproval", label: "Gov approval", fmt: (v) => `${Math.round(v * 100)}%`, good: "high" },
  { key: "socialUnrest", label: "Social unrest", fmt: (v) => `${Math.round(v * 100)}%`, good: "low" },
  { key: "businessSurvival", label: "Business", fmt: (v) => `${Math.round(v * 100)}%`, good: "high" },
];

function healthColor(s: Stat, v: number): string {
  let bad: number; // 0 (great) .. 1 (terrible)
  if (s.good === "high") bad = 1 - v / (s.key === "govApproval" || s.key === "businessSurvival" ? 1 : 100);
  else if (s.good === "low")
    bad = s.key === "socialUnrest" ? v : Math.min(1, Math.max(0, (v - 4) / 12));
  else bad = Math.min(1, Math.abs(v - (s.target ?? 0)) / 8);
  bad = Math.min(1, Math.max(0, bad));
  return bad < 0.34 ? "#3E7C34" : bad < 0.67 ? "#B0851F" : "#9E3030";
}

export function CityStats({ metrics, history, phase, round, maxRounds }: Props) {
  const prev = history.length >= 2 ? history[history.length - 2] : undefined;

  return (
    <div className="rpg-panel flex w-64 flex-col" data-testid="city-stats">
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: "#E8D5A3", borderBottom: "2px solid #C4A46C" }}
      >
        <span className="text-[9px] font-pixel uppercase tracking-wide" style={{ color: "#5B3A1E" }}>
          City Health
        </span>
        <span className="text-[8px] font-mono" style={{ color: "#8B7355" }}>
          P{phase || "-"} · R{round}/{maxRounds}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 p-2">
        {STATS.map((s) => {
          const v = metrics[s.key];
          const p = prev?.[s.key];
          const d = p != null ? v - p : 0;
          const col = healthColor(s, v);
          // For "lower is better" / unrest, a rising value is bad (red arrow).
          const risingIsBad = s.good === "low";
          const arrowColor =
            Math.abs(d) < 1e-3 ? "#A0824A" : (d > 0) === risingIsBad ? "#9E3030" : "#3E7C34";
          const arrow = Math.abs(d) < 1e-3 ? "→" : d > 0 ? "▲" : "▼";
          return (
            <div
              key={s.key}
              className="flex flex-col gap-0.5 rounded px-2 py-1.5"
              style={{ background: "#F7EFD8", border: "1px solid #C4A46C" }}
            >
              <span className="text-[7px] font-pixel uppercase" style={{ color: "#8B7355" }}>
                {s.label}
              </span>
              <div className="flex items-baseline gap-1">
                <span className="font-mono text-[15px] tabular-nums" style={{ color: col }}>
                  {s.fmt(v)}
                </span>
                <span className="text-[9px] font-mono" style={{ color: arrowColor }} title={`Δ ${d.toFixed(2)}`}>
                  {arrow}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

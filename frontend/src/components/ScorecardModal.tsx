"use client";

// ScorecardModal — shown when the match completes (world.status === "complete").
// Turns the final indicators into a city verdict + per-role report card.

import type { SimMetrics } from "@/types";

interface Props {
  metrics: SimMetrics;
  rounds: number;
  onClose: () => void;
  onNewGame?: () => void;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const grade = (s: number) =>
  s >= 90 ? "A" : s >= 80 ? "B" : s >= 65 ? "C" : s >= 50 ? "D" : "F";
const gradeColor = (s: number) =>
  s >= 80 ? "#3E7C34" : s >= 65 ? "#A98028" : s >= 50 ? "#C77A2A" : "#9E3030";

export function ScorecardModal({ metrics, rounds, onClose, onNewGame }: Props) {
  const { priceIndex, unemploymentRate, socialUnrest, govApproval, businessSurvival } = metrics;

  // Component scores (0–100).
  const jobs = clamp(100 - (unemploymentRate - 4) * 9);
  const prices = clamp(100 - Math.abs(priceIndex - 1) * 9);
  const stability = clamp((1 - socialUnrest) * 100);
  const approval = clamp(govApproval * 100);
  const business = clamp(businessSurvival * 100);
  const overall = Math.round(
    jobs * 0.25 + prices * 0.2 + stability * 0.2 + approval * 0.2 + business * 0.15,
  );

  // City verdict.
  let verdict = "Muddling Through";
  let blurb = "The city held together, more or less.";
  if (socialUnrest > 0.6) {
    verdict = "Civil Crisis";
    blurb = "The streets boiled over. Order broke down.";
  } else if (unemploymentRate > 9) {
    verdict = "Deep Recession";
    blurb = "Jobs vanished and the city contracted hard.";
  } else if (priceIndex > 7 && unemploymentRate > 7) {
    verdict = "Stagflation";
    blurb = "Prices soared while jobs disappeared — the worst of both.";
  } else if (overall >= 78) {
    verdict = "Golden Age";
    blurb = "Stable prices, full employment, a content city. Masterful.";
  } else if (overall >= 62) {
    verdict = "Soft Landing";
    blurb = "You threaded the needle and kept the city steady.";
  } else if (overall < 45) {
    verdict = "Hard Times";
    blurb = "The policy left scars across the city.";
  }

  const roles: { name: string; score: number; note: string }[] = [
    { name: "Federal Government", score: Math.round(approval * 0.6 + stability * 0.4), note: "approval & order" },
    { name: "Central Bank", score: Math.round(prices * 0.6 + jobs * 0.4), note: "inflation vs. jobs" },
    { name: "Manufacturing (Corp)", score: Math.round(business), note: "business survival" },
    { name: "Workers United (Union)", score: Math.round(jobs * 0.7 + stability * 0.3), note: "jobs & calm" },
    { name: "The Daily Pulse (Media)", score: Math.round(approval * 0.5 + stability * 0.5), note: "public sentiment" },
  ];

  const Bar = ({ label, score }: { label: string; score: number }) => (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-[8px]" style={{ color: "#8B7355" }}>{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded" style={{ background: "#D8C49A" }}>
        <div className="h-full" style={{ width: `${Math.round(score)}%`, background: gradeColor(score) }} />
      </div>
      <span className="w-7 text-right text-[9px] font-mono tabular-nums" style={{ color: gradeColor(score) }}>
        {Math.round(score)}
      </span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" style={{ background: "rgba(10,8,4,0.78)" }}>
      <div
        className="rpg-panel flex w-[460px] max-w-[92vw] flex-col gap-3 p-5"
        style={{ background: "#E8D5A3", border: "4px solid #5B3010" }}
      >
        <div className="text-center">
          <div className="text-[8px] font-pixel uppercase tracking-widest" style={{ color: "#8B7355" }}>
            City Report — {rounds} months
          </div>
          <div className="mt-1 text-[22px] font-pixel" style={{ color: "#5B3010" }}>{verdict}</div>
          <div className="mt-1 text-[9px]" style={{ color: "#7A4E1E" }}>{blurb}</div>
        </div>

        <div className="flex items-center justify-center gap-3 py-1">
          <div className="text-[40px] font-pixel" style={{ color: gradeColor(overall) }}>{grade(overall)}</div>
          <div className="text-left">
            <div className="text-[9px] font-pixel" style={{ color: "#5B3A1E" }}>Overall {overall}/100</div>
            <div className="text-[7px]" style={{ color: "#8B7355" }}>weighted city health</div>
          </div>
        </div>

        <div className="flex flex-col gap-1 rounded px-3 py-2" style={{ background: "#F2E6C8", border: "2px solid #C4A46C" }}>
          <Bar label="Jobs" score={jobs} />
          <Bar label="Prices" score={prices} />
          <Bar label="Stability" score={stability} />
          <Bar label="Gov approval" score={approval} />
          <Bar label="Business" score={business} />
        </div>

        <div className="text-[8px] font-pixel uppercase tracking-wide" style={{ color: "#8B7355" }}>
          Role report card
        </div>
        <div className="flex flex-col gap-1">
          {roles.map((r) => (
            <div key={r.name} className="flex items-center justify-between rounded px-2 py-1" style={{ background: "#F2E6C8", border: "1px solid #C4A46C" }}>
              <div className="min-w-0">
                <div className="truncate text-[9px] font-pixel" style={{ color: "#5B3A1E" }}>{r.name}</div>
                <div className="text-[7px]" style={{ color: "#8B7355" }}>{r.note}</div>
              </div>
              <div className="text-[16px] font-pixel" style={{ color: gradeColor(r.score) }}>{grade(r.score)}</div>
            </div>
          ))}
        </div>

        <div className="mt-1 flex gap-2">
          <button
            type="button"
            onClick={onNewGame ?? (() => window.location.reload())}
            className="flex-1 px-3 py-2 text-[8px] font-pixel uppercase"
            style={{ background: "#3E7C34", color: "#fff", border: "2px solid #2A5523" }}
          >
            New city
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-[8px] font-pixel uppercase"
            style={{ background: "#D4A044", color: "#5B3010", border: "2px solid #A07028" }}
          >
            Close
          </button>
        </div>
        <div className="text-center text-[7px]" style={{ color: "#A0824A" }}>
          (Starts a fresh match for everyone connected.)
        </div>
      </div>
    </div>
  );
}

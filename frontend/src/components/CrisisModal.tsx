"use client";

// CrisisModal — a breaking-news event with two choices. Any player can decide;
// the worker then applies the chosen effect. If no one decides by the deadline,
// the worker applies a (usually worse) default.

import { useState } from "react";
import type { Crisis } from "@/hooks/useStdbCity";

interface Props {
  crisis: Crisis;
  round: number;
  onResolve: (crisisId: bigint, option: number) => Promise<void>;
}

const ROLE_LABEL: Record<string, string> = {
  gov_federal: "Government",
  gov_central_bank: "Central Bank",
  corp_manufacturing: "Corporations",
  labor_union: "Labor",
  media_outlet: "The Press",
};

export function CrisisModal({ crisis, round, onResolve }: Props) {
  const [busy, setBusy] = useState(false);
  const left = Math.max(0, crisis.deadline - round);

  const choose = async (option: number) => {
    setBusy(true);
    try {
      await onResolve(crisis.id, option);
    } catch (e) {
      console.error("[crisis]", e);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center" style={{ background: "rgba(10,8,4,0.7)" }}>
      <div
        className="rpg-panel flex w-[440px] max-w-[92vw] flex-col gap-3 p-5"
        style={{ background: "#E8D5A3", border: "4px solid #8B3A3A" }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-pixel uppercase tracking-widest" style={{ color: "#8B3A3A" }}>
            🚨 Breaking — Crisis
          </span>
          <span className="text-[8px] font-mono" style={{ color: left <= 1 ? "#8B3A3A" : "#8B7355" }}>
            decide in {left} round{left === 1 ? "" : "s"}
          </span>
        </div>

        <div className="text-[18px] font-pixel" style={{ color: "#5B3010" }}>{crisis.title}</div>
        <div className="text-[11px] leading-relaxed" style={{ color: "#5B3A1E", fontFamily: "var(--font-geist-mono)" }}>
          {crisis.description}
        </div>
        <div className="text-[8px] font-pixel uppercase" style={{ color: "#8B7355" }}>
          {ROLE_LABEL[crisis.targetRole] ?? crisis.targetRole}'s call — but anyone can decide
        </div>

        <div className="mt-1 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => choose(0)}
            className="flex-1 px-3 py-3 text-[10px] font-pixel uppercase leading-snug disabled:opacity-50"
            style={{ background: "#3E7C34", color: "#fff", border: "2px solid #2A5523" }}
          >
            {crisis.optionA}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => choose(1)}
            className="flex-1 px-3 py-3 text-[10px] font-pixel uppercase leading-snug disabled:opacity-50"
            style={{ background: "#B5722A", color: "#fff", border: "2px solid #8B5320" }}
          >
            {crisis.optionB}
          </button>
        </div>
        <span className="text-center text-[7px]" style={{ color: "#A0824A" }}>
          No decision by the deadline → the city handles it the hard way.
        </span>
      </div>
    </div>
  );
}

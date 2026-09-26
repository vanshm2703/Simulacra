"use client";

// SeatPicker — claim/release the playable roles in the city.
// A claimed seat means the human drives that agent; the AI fills the rest.

import { useState } from "react";
import type { Seat } from "@/hooks/useStdbCity";

interface Props {
  seats: Seat[];
  onClaim: (agentId: string) => Promise<void>;
  onRelease: (agentId: string) => Promise<void>;
}

const ROLE_BLURB: Record<string, string> = {
  gov_federal: "Set fiscal stance & policy",
  gov_central_bank: "Set interest rates",
  corp_manufacturing: "Set prices & hiring",
  labor_union: "Demand wages, call strikes",
  media_outlet: "Spin the headlines",
};

export function SeatPicker({ seats, onClaim, onRelease }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (id: string, fn: (id: string) => Promise<void>) => {
    setBusy(id);
    try {
      await fn(id);
    } catch (e) {
      console.error("[seat]", e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rpg-panel flex w-60 flex-col" data-testid="seat-picker">
      <div
        className="px-3 py-2 text-[8px] font-pixel uppercase tracking-wide"
        style={{ background: "#E8D5A3", borderBottom: "2px solid #C4A46C", color: "#5B3A1E" }}
      >
        Take a Role
      </div>
      <div className="flex flex-col gap-1.5 p-2">
        {seats.length === 0 && (
          <span className="px-1 py-2 text-[8px] font-pixel" style={{ color: "#A0824A" }}>
            Waiting for the city…
          </span>
        )}
        {seats.map((s) => {
          const taken = s.controlledByHex != null && !s.mine;
          return (
            <div
              key={s.id}
              className="flex items-center justify-between gap-2 rounded px-2 py-1.5"
              style={{
                background: s.mine ? "#CFE8C4" : taken ? "#E8D0D0" : "#F2E6C8",
                border: "2px solid #C4A46C",
              }}
            >
              <div className="min-w-0">
                <div className="truncate text-[9px] font-pixel" style={{ color: "#5B3A1E" }}>
                  {s.name}
                </div>
                <div className="truncate text-[7px]" style={{ color: "#8B7355" }}>
                  {ROLE_BLURB[s.id] ?? s.role}
                </div>
              </div>
              {s.mine ? (
                <button
                  type="button"
                  disabled={busy === s.id}
                  onClick={() => act(s.id, onRelease)}
                  className="shrink-0 px-2 py-1 text-[7px] font-pixel uppercase"
                  style={{ background: "#C77", color: "#fff", border: "1px solid #8B3A3A" }}
                >
                  Leave
                </button>
              ) : (
                <button
                  type="button"
                  disabled={taken || busy === s.id}
                  onClick={() => act(s.id, onClaim)}
                  className="shrink-0 px-2 py-1 text-[7px] font-pixel uppercase disabled:opacity-50"
                  style={{ background: "#3E7C34", color: "#fff", border: "1px solid #2A5523" }}
                >
                  {taken ? "Taken" : "Claim"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

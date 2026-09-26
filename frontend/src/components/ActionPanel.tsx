"use client";

// ActionPanel — for each seat the player controls: standing levers (sliders,
// sticky each round) PLUS one-shot action cards (punchy powers with cooldowns).

import { useEffect, useState } from "react";
import type { Seat } from "@/hooks/useStdbCity";

export interface LeverConfig {
  lever: string;
  min: number;
  max: number;
  step: number;
  label: string;
  default: number;
}

export const SEAT_LEVERS: Record<string, LeverConfig[]> = {
  gov_federal: [
    { lever: "policy_stance", min: -1, max: 1, step: 0.1, label: "Fiscal stance — austerity ↔ stimulus", default: 0.1 },
    { lever: "tax", min: 0, max: 1, step: 0.05, label: "Tax rate (0–100%)", default: 0.3 },
  ],
  gov_central_bank: [
    { lever: "interest_rate", min: 0, max: 12, step: 0.25, label: "Interest rate (%)", default: 5.25 },
    { lever: "qe", min: -1, max: 1, step: 0.1, label: "Quantitative easing — tighten ↔ ease", default: 0 },
  ],
  corp_manufacturing: [
    { lever: "price", min: -1, max: 1, step: 0.1, label: "Price pass-through — absorb ↔ raise", default: 0.05 },
    { lever: "hiring", min: -1, max: 1, step: 0.1, label: "Hiring — layoffs ↔ hire", default: 0 },
  ],
  labor_union: [
    { lever: "wage_demand", min: 0, max: 1, step: 0.05, label: "Wage demand", default: 0.2 },
    { lever: "strike", min: 0, max: 1, step: 1, label: "Strike — calm ↔ walk out", default: 0 },
  ],
  media_outlet: [
    { lever: "spin", min: -1, max: 1, step: 0.1, label: "Spin — critical ↔ supportive", default: 0 },
    { lever: "intensity", min: 0, max: 1, step: 0.05, label: "Coverage intensity", default: 0.3 },
  ],
};

// One-shot action cards per seat. `key` → fired as lever "act:<key>". `cd` = cooldown rounds.
interface ActionCard {
  key: string;
  label: string;
  cd: number;
}
export const SEAT_ACTIONS: Record<string, ActionCard[]> = {
  gov_federal: [
    { key: "stimulus", label: "💸 Stimulus", cd: 4 },
    { key: "bailout", label: "🏦 Bailout", cd: 3 },
    { key: "taxcut", label: "✂️ Tax cut", cd: 3 },
  ],
  gov_central_bank: [
    { key: "rate_cut", label: "📉 Shock cut", cd: 3 },
    { key: "qe_blast", label: "💵 QE blast", cd: 4 },
  ],
  corp_manufacturing: [
    { key: "hiring", label: "📈 Hiring spree", cd: 3 },
    { key: "layoff", label: "📉 Mass layoff", cd: 3 },
    { key: "lobby", label: "🤝 Lobby", cd: 4 },
  ],
  labor_union: [
    { key: "strike", label: "✊ Call strike", cd: 4 },
    { key: "deal", label: "🤝 Cut a deal", cd: 2 },
  ],
  media_outlet: [
    { key: "expose", label: "📰 Exposé", cd: 3 },
    { key: "endorse", label: "⭐ Endorse", cd: 3 },
  ],
};

interface Props {
  seats: Seat[]; // already filtered to seats I control
  roundOpen: boolean;
  round: number;
  onSubmit: (agentId: string, lever: string, value: number, text: string) => Promise<void>;
}

function SeatControls({
  seat,
  roundOpen,
  round,
  onSubmit,
}: {
  seat: Seat;
  roundOpen: boolean;
  round: number;
  onSubmit: Props["onSubmit"];
}) {
  const levers = SEAT_LEVERS[seat.id] ?? [];
  const actions = SEAT_ACTIONS[seat.id] ?? [];
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(levers.map((l) => [l.lever, l.default])),
  );
  const [sent, setSent] = useState(false);
  // round in which each action was last fired (for cooldowns)
  const [firedAt, setFiredAt] = useState<Record<string, number>>({});

  useEffect(() => {
    if (roundOpen) setSent(false);
  }, [roundOpen]);

  if (levers.length === 0) return null;

  const submitAll = async () => {
    try {
      for (const l of levers) await onSubmit(seat.id, l.lever, values[l.lever] ?? l.default, "");
      setSent(true);
    } catch (e) {
      console.error("[action]", e);
    }
  };

  const fire = async (key: string) => {
    try {
      await onSubmit(seat.id, `act:${key}`, 1, "");
      setFiredAt((f) => ({ ...f, [key]: round }));
    } catch (e) {
      console.error("[action-card]", e);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded px-2 py-2" style={{ background: "#F2E6C8", border: "2px solid #C4A46C" }}>
      <span className="text-[9px] font-pixel" style={{ color: "#5B3A1E" }}>{seat.name}</span>

      {/* Standing levers */}
      {levers.map((cfg) => (
        <div key={cfg.lever} className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between">
            <span className="text-[7px]" style={{ color: "#8B7355" }}>{cfg.label}</span>
            <span className="text-[9px] font-mono tabular-nums" style={{ color: "#3E7C34" }}>
              {(values[cfg.lever] ?? cfg.default).toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min={cfg.min}
            max={cfg.max}
            step={cfg.step}
            value={values[cfg.lever] ?? cfg.default}
            onChange={(e) => setValues((v) => ({ ...v, [cfg.lever]: Number(e.target.value) }))}
            className="w-full accent-[#3E7C34]"
          />
        </div>
      ))}
      <button
        type="button"
        disabled={!roundOpen}
        onClick={submitAll}
        className="px-2 py-1 text-[7px] font-pixel uppercase disabled:opacity-40"
        style={{ background: sent ? "#8B7355" : "#3E7C34", color: "#fff", border: "1px solid #2A5523" }}
      >
        {!roundOpen ? "Round closed" : sent ? "Submitted ✓ (resend)" : "Submit levers"}
      </button>

      {/* One-shot action cards */}
      {actions.length > 0 && (
        <>
          <span className="mt-0.5 text-[7px] font-pixel uppercase" style={{ color: "#8B7355" }}>Power moves</span>
          <div className="flex flex-wrap gap-1">
            {actions.map((a) => {
              const last = firedAt[a.key];
              const remaining = last != null ? a.cd - (round - last) : 0;
              const onCd = remaining > 0;
              const disabled = !roundOpen || onCd;
              return (
                <button
                  key={a.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => fire(a.key)}
                  title={onCd ? `Cooldown: ${remaining} round(s)` : `Fire now (cooldown ${a.cd})`}
                  className="px-1.5 py-1 text-[7px] font-pixel uppercase disabled:opacity-35"
                  style={{ background: "#5B3A1E", color: "#F2E6C8", border: "1px solid #3D2510" }}
                >
                  {a.label}
                  {onCd ? ` (${remaining})` : ""}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function ActionPanel({ seats, roundOpen, round, onSubmit }: Props) {
  if (seats.length === 0) return null;
  return (
    <div className="rpg-panel flex w-64 flex-col" data-testid="action-panel">
      <div
        className="flex items-center justify-between px-3 py-2 text-[8px] font-pixel uppercase tracking-wide"
        style={{ background: "#E8D5A3", borderBottom: "2px solid #C4A46C", color: "#5B3A1E" }}
      >
        <span>Your Controls</span>
        <span style={{ color: roundOpen ? "#3E7C34" : "#A0824A" }}>{roundOpen ? "● open" : "○ wait"}</span>
      </div>
      <div className="flex flex-col gap-1.5 p-2">
        {seats.map((s) => (
          <SeatControls key={s.id} seat={s} roundOpen={roundOpen} round={round} onSubmit={onSubmit} />
        ))}
      </div>
    </div>
  );
}

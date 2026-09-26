"use client";

// DealPanel — make the multiplayer matter. Propose deals from a seat you hold to
// another seat, and accept/reject deals others send you. Accepted deals apply a
// thematic economic effect (handled by the worker).

import { useState } from "react";
import type { Deal, Seat } from "@/hooks/useStdbCity";

interface Offer {
  key: string;
  to: string;
  label: string;
  text: string;
}

// Deals a seat can propose. `to` = recipient agent id; `key` = deal kind (must
// match the worker's DEAL_EFFECTS).
export const DEAL_OFFERS: Record<string, Offer[]> = {
  gov_federal: [
    { key: "subsidy", to: "corp_manufacturing", label: "💵 Hiring subsidy → Corp", text: "Govt subsidy if Manufacturing hires." },
    { key: "no_strike", to: "labor_union", label: "🕊️ No-strike pact → Union", text: "Govt concessions for labor peace." },
  ],
  gov_central_bank: [
    { key: "cheap_credit", to: "corp_manufacturing", label: "🏦 Cheap credit → Corp", text: "Central Bank credit line for Manufacturing." },
  ],
  corp_manufacturing: [
    { key: "tax_break", to: "gov_federal", label: "✂️ Ask tax break → Govt", text: "Manufacturing requests a tax break to invest." },
    { key: "wage_offer", to: "labor_union", label: "🤝 Offer raise → Union", text: "Manufacturing offers workers a modest raise." },
  ],
  labor_union: [
    { key: "wage_demand", to: "corp_manufacturing", label: "✊ Demand raise → Corp", text: "Union demands a wage increase — or we strike." },
    { key: "endorse_gov", to: "gov_federal", label: "📣 Offer support → Govt", text: "Union offers political support." },
  ],
  media_outlet: [
    { key: "good_press", to: "gov_federal", label: "⭐ Offer good press → Govt", text: "The Press offers favorable coverage." },
  ],
};

interface Props {
  mySeats: Seat[];
  pendingDeals: Deal[];
  onPropose: (fromAgent: string, toAgent: string, kind: string, text: string) => Promise<void>;
  onRespond: (dealId: bigint, accept: boolean) => Promise<void>;
}

export function DealPanel({ mySeats, pendingDeals, onPropose, onRespond }: Props) {
  const [busy, setBusy] = useState(false);
  if (mySeats.length === 0) return null;

  const mySeatIds = new Set(mySeats.map((s) => s.id));
  // Inbox: pending deals addressed to a seat I hold (and not proposed by me).
  const inbox = pendingDeals.filter((d) => mySeatIds.has(d.toAgent) && !mySeatIds.has(d.fromAgent));
  // Deals I've sent that are still pending.
  const outbox = pendingDeals.filter((d) => mySeatIds.has(d.fromAgent));

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      console.error("[deal]", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rpg-panel flex w-64 flex-col" data-testid="deal-panel">
      <div
        className="px-3 py-2 text-[8px] font-pixel uppercase tracking-wide"
        style={{ background: "#E8D5A3", borderBottom: "2px solid #C4A46C", color: "#5B3A1E" }}
      >
        Deals & Diplomacy
      </div>
      <div className="flex flex-col gap-2 p-2">
        {/* Inbox */}
        {inbox.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[7px] font-pixel uppercase" style={{ color: "#8B3A3A" }}>
              📨 Offers to you
            </span>
            {inbox.map((d) => (
              <div key={String(d.id)} className="rounded px-2 py-1.5" style={{ background: "#F7EFD8", border: "1px solid #C4A46C" }}>
                <div className="text-[9px]" style={{ color: "#5B3A1E", fontFamily: "var(--font-geist-mono)" }}>
                  <b>{d.fromLabel}</b>: {d.text}
                </div>
                <div className="mt-1 flex gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => guard(() => onRespond(d.id, true))}
                    className="flex-1 px-2 py-1 text-[7px] font-pixel uppercase"
                    style={{ background: "#3E7C34", color: "#fff", border: "1px solid #2A5523" }}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => guard(() => onRespond(d.id, false))}
                    className="flex-1 px-2 py-1 text-[7px] font-pixel uppercase"
                    style={{ background: "#9E3030", color: "#fff", border: "1px solid #6E2020" }}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Propose */}
        {mySeats.map((s) => {
          const offers = DEAL_OFFERS[s.id] ?? [];
          if (offers.length === 0) return null;
          return (
            <div key={s.id} className="flex flex-col gap-1">
              <span className="text-[7px] font-pixel uppercase" style={{ color: "#8B7355" }}>
                Propose as {s.name}
              </span>
              {offers.map((o) => {
                const sent = outbox.some((d) => d.fromAgent === s.id && d.kind === o.key);
                return (
                  <button
                    key={o.key}
                    type="button"
                    disabled={busy || sent}
                    onClick={() => guard(() => onPropose(s.id, o.to, o.key, o.text))}
                    title={o.text}
                    className="px-2 py-1 text-left text-[8px] font-pixel uppercase disabled:opacity-40"
                    style={{ background: "#5B3A1E", color: "#F2E6C8", border: "1px solid #3D2510" }}
                  >
                    {sent ? "⏳ sent" : o.label}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

"use client";

// CityFeed — a readable live log for the multiplayer city. Resolves agent names
// at render time (so they're never raw IDs), color-codes by role, and styles by
// event type. Newest first.

import type { SimEvent } from "@/types";

export interface AgentMeta {
  name: string;
  role: string;
  category: string;
}

interface Props {
  events: SimEvent[];
  agentMeta: Map<string, AgentMeta>;
}

// Role/category → accent color + short tag.
const CATEGORY: Record<string, { color: string; tag: string }> = {
  government: { color: "#4F86C6", tag: "GOV" },
  central_bank: { color: "#2BB3A3", tag: "BANK" },
  large_corp: { color: "#8E6FC6", tag: "CORP" },
  sme: { color: "#C68A2B", tag: "SHOP" },
  union: { color: "#C75D5D", tag: "UNION" },
  media: { color: "#C264A6", tag: "MEDIA" },
  household: { color: "#5DA85A", tag: "HOME" },
};
const FALLBACK = { color: "#8B7355", tag: "CITY" };

// Event type → icon + (optional) emphasis color overriding the role color.
const EVENT_STYLE: Record<string, { icon: string; emphasis?: string }> = {
  chat: { icon: "💬" },
  protest: { icon: "✊", emphasis: "#C75D5D" },
  strike: { icon: "🚧", emphasis: "#C75D5D" },
  closure: { icon: "🔒", emphasis: "#9E3030" },
  crisis: { icon: "🚨", emphasis: "#8B3A3A" },
  price_change: { icon: "💲", emphasis: "#C68A2B" },
  layoff: { icon: "📉", emphasis: "#9E3030" },
  mood_shift: { icon: "•" },
  policy_response: { icon: "🏛" },
  reaction: { icon: "•" },
};

export function CityFeed({ events, agentMeta }: Props) {
  // Newest first; skip pure movement/empty rows (not interesting to read).
  const rows = events
    .filter((e) => e.message && e.type !== "move")
    .slice(-40)
    .reverse();

  return (
    <div className="rpg-panel flex h-full flex-col" data-testid="city-feed">
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{ background: "#E8D5A3", borderBottom: "2px solid #C4A46C" }}
      >
        <span className="text-[9px] font-pixel uppercase tracking-wide" style={{ color: "#5B3A1E" }}>
          City Feed
        </span>
        <span className="text-[8px] font-mono" style={{ color: "#A0824A" }}>
          live
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-1.5" style={{ background: "#F7EFD8" }}>
        {rows.length === 0 && (
          <div className="py-4 text-center text-[10px] font-mono" style={{ color: "#A0824A" }}>
            Waiting for the city to wake up…
          </div>
        )}
        {rows.map((e) => {
          const meta = agentMeta.get(e.agentId);
          const cat = meta ? CATEGORY[meta.category] ?? FALLBACK : FALLBACK;
          const ev = EVENT_STYLE[e.type] ?? EVENT_STYLE.reaction;
          const accent = ev.emphasis ?? cat.color;
          const name = meta?.name ?? e.agentName ?? e.agentId;
          return (
            <div
              key={e.id}
              className="mb-1 flex gap-2 rounded px-2 py-1.5"
              style={{ background: "#FFFFFF", borderLeft: `3px solid ${accent}` }}
            >
              <span className="select-none text-[12px] leading-none" aria-hidden>
                {ev.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold" style={{ color: accent }}>
                    {name}
                  </span>
                  <span
                    className="rounded px-1 text-[7px] font-pixel uppercase"
                    style={{ background: cat.color, color: "#fff" }}
                  >
                    {cat.tag}
                  </span>
                  {e.type !== "chat" && (
                    <span className="text-[7px] font-pixel uppercase" style={{ color: "#A0824A" }}>
                      {e.type.replace("_", " ")}
                    </span>
                  )}
                  <span className="ml-auto text-[8px] font-mono" style={{ color: "#C4A46C" }}>
                    R{e.round}
                  </span>
                </div>
                <div className="text-[11px] leading-snug" style={{ color: "#3A2D1A", fontFamily: "var(--font-geist-mono)" }}>
                  {e.message}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

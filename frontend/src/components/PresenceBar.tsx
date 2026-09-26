"use client";

// PresenceBar — who's currently in the city (live from the player table).

interface Props {
  players: { displayName: string }[];
}

export function PresenceBar({ players }: Props) {
  return (
    <div
      className="rpg-panel flex items-center gap-2 px-3 py-1.5"
      data-testid="presence-bar"
      style={{ background: "#E8D5A3" }}
    >
      <span className="text-[8px] font-pixel uppercase" style={{ color: "#5B3A1E" }}>
        In city
      </span>
      <span
        className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-mono"
        style={{ background: "#3E7C34", color: "#fff" }}
      >
        {players.length}
      </span>
      <div className="flex min-w-0 flex-wrap gap-1">
        {players.slice(0, 8).map((p, i) => (
          <span
            key={`${p.displayName}-${i}`}
            className="truncate rounded px-1.5 py-0.5 text-[7px] font-pixel"
            style={{ background: "#F2E6C8", border: "1px solid #C4A46C", color: "#5B3A1E" }}
          >
            {p.displayName}
          </span>
        ))}
      </div>
    </div>
  );
}

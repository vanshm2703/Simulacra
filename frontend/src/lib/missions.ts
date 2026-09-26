// Per-role missions + live scoring. Each playable seat has an objective and a
// 0–100 score derived from the current city metrics, so a player always knows
// whether they're winning their role (updates every round).

import type { SimMetrics } from "@/types";

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

export interface Mission {
  title: string;
  objective: string;
  score: (m: SimMetrics) => number;
}

export const MISSIONS: Record<string, Mission> = {
  gov_federal: {
    title: "Hold Power",
    objective: "Finish with approval above 50% and the city calm.",
    score: (m) => clamp(m.govApproval * 100 * 0.7 + (1 - m.socialUnrest) * 100 * 0.3),
  },
  gov_central_bank: {
    title: "Price Stability",
    objective: "Keep inflation near 2% and unemployment under 6%.",
    score: (m) => {
      const inflation = clamp(100 - Math.abs(m.priceIndex - 2) * 12);
      const jobs = clamp(100 - (m.unemploymentRate - 6) * 12);
      return clamp(inflation * 0.6 + jobs * 0.4);
    },
  },
  corp_manufacturing: {
    title: "Profit & Survival",
    objective: "Keep businesses alive while prices stay sane.",
    score: (m) =>
      clamp(m.businessSurvival * 100 * 0.7 + clamp(100 - Math.abs(m.priceIndex) * 6) * 0.3),
  },
  labor_union: {
    title: "Jobs & Wages",
    objective: "Drive unemployment down and keep workers calm.",
    score: (m) =>
      clamp((100 - (m.unemploymentRate - 4) * 9) * 0.6 + (1 - m.socialUnrest) * 100 * 0.4),
  },
  media_outlet: {
    title: "Shape the Story",
    objective: "Steer public approval and keep unrest low.",
    score: (m) => clamp(m.govApproval * 100 * 0.5 + (1 - m.socialUnrest) * 100 * 0.5),
  },
};

export function grade(s: number): string {
  return s >= 85 ? "A" : s >= 70 ? "B" : s >= 55 ? "C" : s >= 40 ? "D" : "F";
}

export function scoreColor(s: number): string {
  return s >= 70 ? "#3E7C34" : s >= 50 ? "#B0851F" : "#9E3030";
}

export function statusText(s: number): string {
  return s >= 70 ? "On track" : s >= 50 ? "Holding" : s >= 35 ? "Slipping" : "Failing";
}

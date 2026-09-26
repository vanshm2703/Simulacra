// Adapters: SpacetimeDB rows -> the frontend's existing types.
//
// The Phaser city, Dashboard, EventFeed and SocialGraph already speak
// BackendNPC / SimEvent / SimMetrics, so we translate SpacetimeDB rows into
// those shapes and reuse every component unchanged.

import type { SimEvent, SimEventType, SimMetrics } from "@/types";
import type {
  BackendMood,
  BackendNPC,
  BackendRelationship,
  BackendRole,
} from "@/types/backend";

/** Structural view of an `agent` table row (camelCase, as generated). */
export interface AgentRow {
  id: string;
  name: string;
  role: string;
  category: string;
  bio: string;
  persona: string;
  incomeLevel: string;
  politicalLeaning: number;
  reputation: number;
  x: number;
  y: number;
  mood: string;
  currentPlan: string;
  profileJson: string;
  playable: boolean;
  // Option<Identity> -> Identity | undefined (we only read its hex).
  controlledBy?: { toHexString(): string } | null;
}

export interface SimEventRow {
  id: bigint | number;
  round: number;
  agentId: string;
  eventType: string;
  message: string;
  dataJson: string;
}

export interface IndicatorRow {
  key: string;
  value: number;
}

const MOODS: BackendMood[] = [
  "angry",
  "anxious",
  "worried",
  "neutral",
  "hopeful",
  "excited",
];
const ROLES: BackendRole[] = [
  "worker",
  "business_owner",
  "politician",
  "student",
  "retiree",
  "activist",
  "farmer",
  "shopkeeper",
  "driver",
];

function asMood(m: string): BackendMood {
  return (MOODS as string[]).includes(m) ? (m as BackendMood) : "neutral";
}
function asRole(r: string): BackendRole {
  return (ROLES as string[]).includes(r) ? (r as BackendRole) : "worker";
}
function asIncome(i: string): "low" | "medium" | "high" {
  return i === "low" || i === "high" ? i : "medium";
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Build a BackendNPC from an agent row, merging the rich profile blob with the
 * authoritative live columns (x/y/mood/plan are freshest on the row). */
export function adaptAgentToNpc(a: AgentRow): BackendNPC {
  const p = safeParse(a.profileJson);
  const arr = (k: string, fallback: string[]): string[] =>
    Array.isArray(p[k]) ? (p[k] as string[]) : fallback;
  return {
    id: a.id,
    name: a.name,
    category: a.category || (typeof p.category === "string" ? p.category : ""),
    gender: typeof p.gender === "string" ? p.gender : "n/a",
    bio: a.bio || (typeof p.bio === "string" ? p.bio : ""),
    persona: a.persona || (typeof p.persona === "string" ? p.persona : ""),
    mbti: typeof p.mbti === "string" ? p.mbti : "XXXX",
    country: typeof p.country === "string" ? p.country : "USA",
    profession:
      typeof p.profession === "string" ? p.profession : a.role || "citizen",
    role: asRole(a.role),
    interested_topics: arr("interested_topics", ["economy"]),
    income_level: asIncome(a.incomeLevel),
    political_leaning: a.politicalLeaning ?? 0,
    reputation: a.reputation ?? 0.5,
    beliefs: arr("beliefs", []),
    controversial_ideas: arr("controversial_ideas", []),
    x: a.x,
    y: a.y,
    mood: asMood(a.mood),
    current_plan: a.currentPlan || undefined,
  };
}

export function adaptRelationship(
  src: string,
  dst: string,
  relType: string,
  weight: number,
): BackendRelationship {
  return {
    source_id: src,
    target_id: dst,
    rel_type: relType as BackendRelationship["rel_type"],
    strength: Math.abs(weight),
    affinity: Math.max(-1, Math.min(1, weight)),
    trust: Math.max(0, Math.min(1, weight)),
  };
}

const EVENT_TYPES: SimEventType[] = [
  "chat",
  "move",
  "reaction",
  "price_change",
  "layoff",
  "protest",
  "closure",
  "strike",
  "policy_response",
  "phase_change",
  "mood_shift",
  "crisis",
];

function asEventType(t: string): SimEventType {
  return (EVENT_TYPES as string[]).includes(t) ? (t as SimEventType) : "reaction";
}

export function phaseForRound(round: number, maxRounds: number): number {
  if (maxRounds <= 0) return 1;
  const third = Math.max(1, Math.floor(maxRounds / 3));
  return Math.min(3, 1 + Math.floor(round / third));
}

export function adaptEvent(
  row: SimEventRow,
  agentName: string,
  agentCategory: string | undefined,
  maxRounds: number,
): SimEvent {
  return {
    id: String(row.id),
    type: asEventType(row.eventType),
    agentId: row.agentId,
    agentName,
    agentCategory,
    message: row.message,
    phase: phaseForRound(row.round, maxRounds),
    round: row.round,
    maxRounds,
    timestamp: Date.now(),
    data: safeParse(row.dataJson),
  };
}

const DEFAULT_METRICS: SimMetrics = {
  eggIndex: 1.0,
  priceIndex: 0,
  unemploymentRate: 4.2,
  socialUnrest: 0.05,
  businessSurvival: 0.95,
  govApproval: 0.62,
  interestRate: 5.25,
};

/** Map the indicator table into the Dashboard's SimMetrics shape. */
export function indicatorsToMetrics(rows: readonly IndicatorRow[]): SimMetrics {
  const m: Record<string, number> = {};
  for (const r of rows) m[r.key] = r.value;
  const priceIndex = m.price_index ?? DEFAULT_METRICS.priceIndex;
  return {
    eggIndex: 1.0 + Math.max(0, priceIndex) / 100,
    priceIndex,
    unemploymentRate: m.unemployment ?? DEFAULT_METRICS.unemploymentRate,
    socialUnrest: m.social_unrest ?? DEFAULT_METRICS.socialUnrest,
    businessSurvival: m.business_survival ?? DEFAULT_METRICS.businessSurvival,
    govApproval: m.gov_approval ?? DEFAULT_METRICS.govApproval,
    interestRate: m.interest_rate ?? DEFAULT_METRICS.interestRate,
  };
}

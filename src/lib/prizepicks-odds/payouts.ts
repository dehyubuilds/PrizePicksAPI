/**
 * PrizePicks payout math.
 * Live EV stays unavailable until a verified table is passed in.
 * The fixture in tests is not a live rule.
 */

export type PayoutTier = {
  hits: number;
  /** Profit multiple of stake returned on this many hits. 0 means the stake is lost. */
  multiplier: number;
};

export type PayoutRule = {
  id: string;
  effectiveFrom: string;
  provenance: string;
  verified: boolean;
  legs: number;
  tiers: PayoutTier[];
  allowsDemon: boolean;
  allowsGoblin: boolean;
};

export type PayoutBook = {
  verified: boolean;
  provenance: string;
  rules: PayoutRule[];
};

export const UNVERIFIED_PAYOUTS: PayoutBook = {
  verified: false,
  provenance:
    "Inspected https://www.prizepicks.com/help-center/payouts on 2026-10-09. The page lists flex multipliers but does not state an effective date, jurisdiction, or demon/goblin adjustment, and PrizePicks says multipliers can change. EV stays unavailable.",
  rules: [],
};

/** Operator-supplied book. A missing or incomplete file stays unverified. This function does not invent multipliers. */
export function payoutBookFromJson(raw: unknown): PayoutBook {
  if (!raw || typeof raw !== "object") return UNVERIFIED_PAYOUTS;
  const row = raw as PayoutBook;
  if (row.verified !== true || typeof row.provenance !== "string" || !/^https?:\/\//.test(row.provenance)) {
    return UNVERIFIED_PAYOUTS;
  }
  if (!Array.isArray(row.rules) || !row.rules.length) return UNVERIFIED_PAYOUTS;
  const rules = row.rules.filter(
    (rule) =>
      rule.verified === true &&
      typeof rule.effectiveFrom === "string" &&
      Number.isFinite(Date.parse(rule.effectiveFrom)) &&
      typeof rule.provenance === "string" &&
      /^https?:\/\//.test(rule.provenance) &&
      Array.isArray(rule.tiers) &&
      rule.tiers.length > 0
  );
  if (!rules.length) return UNVERIFIED_PAYOUTS;
  return { verified: true, provenance: row.provenance, rules };
}

export type EvResult = {
  expectedReturn: number | null;
  expectedNetPerUnit: number | null;
  lossProbability: number | null;
  status: "ok" | "unavailable";
  reason: string | null;
};

export function expectedValue(params: {
  book: PayoutBook;
  ruleId: string;
  /** Hit count → probability. Must sum to 1. Null when the joint distribution is unknown. */
  outcomeProbabilities: Record<number, number> | null;
  oddsTypes?: string[];
}): EvResult {
  const unavailable = (reason: string): EvResult => ({
    expectedReturn: null,
    expectedNetPerUnit: null,
    lossProbability: null,
    status: "unavailable",
    reason,
  });
  if (!params.book.verified) return unavailable("payout_unverified");
  const rule = params.book.rules.find((row) => row.id === params.ruleId && row.verified);
  if (!rule) return unavailable("payout_rule_missing");
  if (!params.outcomeProbabilities) return unavailable("joint_distribution_unknown");
  const types = params.oddsTypes ?? [];
  if (types.some((type) => type.toLowerCase() === "demon") && !rule.allowsDemon) {
    return unavailable("demon_not_eligible");
  }
  if (types.some((type) => type.toLowerCase() === "goblin") && !rule.allowsGoblin) {
    return unavailable("goblin_not_eligible");
  }
  const mass = Object.values(params.outcomeProbabilities).reduce((sum, value) => sum + value, 0);
  if (Math.abs(mass - 1) > 0.001) return unavailable("probabilities_do_not_sum_to_one");
  let expectedReturn = 0;
  let lossProbability = 0;
  for (const [hits, probability] of Object.entries(params.outcomeProbabilities)) {
    const tier = rule.tiers.find((row) => row.hits === Number(hits));
    if (!tier) return unavailable("missing_payout_tier");
    expectedReturn += probability * tier.multiplier;
    if (tier.multiplier === 0) lossProbability += probability;
  }
  return {
    expectedReturn: round3(expectedReturn),
    expectedNetPerUnit: round3(expectedReturn - 1),
    lossProbability: round3(lossProbability),
    status: "ok",
    reason: null,
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

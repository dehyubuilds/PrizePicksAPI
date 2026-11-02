import type { InefficiencyObservation } from "./types";

const VALID = new Set(["VERIFIED_MARKET_DISCREPANCY", "POSSIBLE_PRICING_INEFFICIENCY", "MARKET_ALREADY_ADJUSTED"]);

export type LongitudinalSummary = {
  observationDays: number;
  independentEvents: number;
  validComparisons: number;
  repeatableKeys: number;
  eventDiscrepancyRate: number | "UNKNOWN";
  note: string;
};

export function summarizeObservations(observations: InefficiencyObservation[]): LongitudinalSummary {
  const unique = new Map<string, InefficiencyObservation>();
  for (const row of observations) {
    const key = `${row.observedAt.slice(0, 10)}|${row.categoryId}|${row.independentEventKey}|${row.player}|${row.propFamily}|${row.prizePicksLine}`;
    unique.set(key, row);
  }
  observations = Array.from(unique.values());
  const days = new Set(observations.map((row) => row.observedAt.slice(0, 10)));
  const valid = observations.filter((row) => VALID.has(row.comparison));
  const events = new Set(valid.map((row) => row.independentEventKey));
  const discrepantEvents = new Set(
    valid.filter((row) => row.comparison === "VERIFIED_MARKET_DISCREPANCY").map((row) => row.independentEventKey)
  );
  const byKey = new Map<string, Set<string>>();
  for (const row of observations) {
    if (row.comparison !== "VERIFIED_MARKET_DISCREPANCY" || !row.direction) continue;
    const key = `${row.categoryId}|${row.propFamily}|${row.player}|${row.direction}`;
    const seen = byKey.get(key) ?? new Set<string>();
    seen.add(row.observedAt.slice(0, 10));
    byKey.set(key, seen);
  }
  const repeatableKeys = Array.from(byKey.values()).filter((seen) => seen.size >= 2).length;
  const enough = days.size >= 2 && events.size >= 5;
  return {
    observationDays: days.size,
    independentEvents: events.size,
    validComparisons: valid.length,
    repeatableKeys,
    eventDiscrepancyRate: enough ? discrepantEvents.size / events.size : "UNKNOWN",
    note: enough
      ? "Rates use one count per event, not one count per correlated prop."
      : "One slate, or fewer than five independent events, cannot show that a discrepancy repeats.",
  };
}

export type SettlementResult = { availableAt: string; actual: number };

/** Refuse results that were not knowable at the observation, and refuse a missing history. */
export function settleWithoutHindsight(
  observation: InefficiencyObservation,
  result: SettlementResult | null
): { status: "missing" } | { status: "hindsight" } | { status: "settled"; overHit: boolean; push: boolean } {
  if (!result) return { status: "missing" };
  if (Date.parse(result.availableAt) <= Date.parse(observation.observedAt)) return { status: "hindsight" };
  if (result.actual === observation.prizePicksLine) return { status: "settled", overHit: false, push: true };
  return { status: "settled", overHit: result.actual > observation.prizePicksLine, push: false };
}

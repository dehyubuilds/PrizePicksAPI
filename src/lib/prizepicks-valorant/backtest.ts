export type BacktestRow = {
  id: string;
  observedAt: string;
  featuresAvailableAt: string;
  line: number;
  actualMaps12Kills: number | null;
  modelA: number | null;
  modelB: number | null;
  baselineAverage: number | null;
  probabilityMore: number | null;
};

export function leaks(row: BacktestRow): boolean {
  return Date.parse(row.featuresAvailableAt) > Date.parse(row.observedAt);
}

export function timeSplit<T extends { observedAt: string }>(rows: T[], trainFraction = 0.7): { train: T[]; test: T[] } {
  const sorted = [...rows].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const cut = Math.floor(sorted.length * trainFraction);
  return { train: sorted.slice(0, cut), test: sorted.slice(cut) };
}

export function meanAbsoluteError(pairs: Array<{ predicted: number; actual: number }>): number | null {
  if (!pairs.length) return null;
  return pairs.reduce((sum, pair) => sum + Math.abs(pair.predicted - pair.actual), 0) / pairs.length;
}

export function brierScore(pairs: Array<{ probability: number; outcome: 0 | 1 }>): number | null {
  if (!pairs.length) return null;
  return pairs.reduce((sum, pair) => sum + (pair.probability - pair.outcome) ** 2, 0) / pairs.length;
}

export function directionalAccuracy(pairs: Array<{ predicted: number; line: number; actual: number }>): number | null {
  const decided = pairs.filter((pair) => pair.actual !== pair.line && pair.predicted !== pair.line);
  if (!decided.length) return null;
  const hits = decided.filter((pair) => (pair.predicted > pair.line) === (pair.actual > pair.line));
  return hits.length / decided.length;
}

export function evaluateBacktest(rows: BacktestRow[]): {
  status: "insufficient_history" | "evaluated";
  heldOut: number;
  modelAMae: number | null;
  modelBMae: number | null;
  baselineMae: number | null;
  brier: number | null;
  modelBImproved: false | true;
  note: string;
} {
  const clean = rows.filter((row) => !leaks(row) && row.actualMaps12Kills != null);
  const { test } = timeSplit(clean);
  const usable = test.filter((row) => row.modelA != null && row.actualMaps12Kills != null);
  if (usable.length < 20) {
    return {
      status: "insufficient_history",
      heldOut: usable.length,
      modelAMae: null,
      modelBMae: null,
      baselineMae: null,
      brier: null,
      modelBImproved: false,
      note: "Held-out Maps 1–2 results are below 20, so no edge and no calibration claim is made.",
    };
  }
  const modelAMae = meanAbsoluteError(usable.map((row) => ({ predicted: row.modelA!, actual: row.actualMaps12Kills! })));
  const modelBRows = usable.filter((row) => row.modelB != null);
  const modelBMae = meanAbsoluteError(modelBRows.map((row) => ({ predicted: row.modelB!, actual: row.actualMaps12Kills! })));
  const baselineRows = usable.filter((row) => row.baselineAverage != null);
  const baselineMae = meanAbsoluteError(baselineRows.map((row) => ({ predicted: row.baselineAverage!, actual: row.actualMaps12Kills! })));
  const improved = modelAMae != null && modelBMae != null && modelBMae < modelAMae;
  return {
    status: "evaluated",
    heldOut: usable.length,
    modelAMae,
    modelBMae,
    baselineMae,
    brier: null,
    modelBImproved: improved,
    note: improved
      ? "Model B reduced held-out absolute error. That is not a payout-verified edge."
      : "Model B did not beat historical statistics on held-out matches.",
  };
}

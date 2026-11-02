import { americanToImplied, devigTwoWay } from "@/lib/edge-combos/estimators/devig";
import type { BookQuote } from "./consensus";
import { MODEL_VERSION } from "./features";

export const MAX_BOOK_RANGE_POINTS = 10;

export type MarketEstimate = {
  /** Median no-vig probability of the chosen side, 0–100. */
  marketProbability: number;
  side: "over" | "under";
  books: number;
  bookRange: { low: number; high: number };
  modelVersion: typeof MODEL_VERSION;
  pushProbability: 0;
};

export function isHalfPointLine(line: number): boolean {
  if (!Number.isFinite(line)) return false;
  const doubled = line * 2;
  return Math.abs(doubled - Math.round(doubled)) < 1e-6 && !Number.isInteger(line);
}

/** Fair over probabilities, one per book that priced both sides. */
export function fairOverSamples(quotes: BookQuote[]): number[] {
  const samples: number[] = [];
  for (const quote of quotes) {
    const over = americanToImplied(quote.overPrice);
    const under = americanToImplied(quote.underPrice);
    if (over == null || under == null) continue;
    const fair = devigTwoWay(over, under);
    if (!fair) continue;
    samples.push(fair.a);
  }
  return samples;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

/**
 * Hit probability at this exact line from the books.
 * Integer lines are refused: a two-way price does not identify the push.
 * The higher side is the selection. This is not a player model.
 */
export function estimateAtLine(quotes: BookQuote[], line: number): MarketEstimate | null {
  if (!isHalfPointLine(line)) return null;
  const overs = fairOverSamples(quotes);
  if (overs.length < 2) return null;
  const mid = median(overs);
  const low = Math.min(...overs);
  const high = Math.max(...overs);
  const overPct = Math.round(mid * 1000) / 10;
  const underPct = Math.round((1 - mid) * 1000) / 10;
  const side = overPct >= underPct ? "over" : "under";
  const chosen = side === "over" ? overs : overs.map((value) => 1 - value);
  const marketProbability = side === "over" ? overPct : underPct;
  return {
    marketProbability,
    side,
    books: overs.length,
    bookRange: {
      low: Math.round(Math.min(...chosen) * 1000) / 10,
      high: Math.round(Math.max(...chosen) * 1000) / 10,
    },
    modelVersion: MODEL_VERSION,
    pushProbability: 0,
  };
}

export function bookRangeTooWide(estimate: MarketEstimate): boolean {
  return estimate.bookRange.high - estimate.bookRange.low > MAX_BOOK_RANGE_POINTS;
}

import { fairFromBooks, type BookQuote } from "@/lib/prizepicks-odds/consensus";
import { isHalfPointLine } from "@/lib/prizepicks-odds/probability";

export type ThresholdType = "half_point" | "integer";

export type ThreeWayPrice = {
  pLessWin: number;
  pPush: number;
  pMoreWin: number;
  books: number;
  method: "adjacent_half_points";
  pushKnown: true;
};

export type ConditionalPrice = {
  conditionalMore: number;
  conditionalLess: number;
  books: number;
  method: "conditional_two_way";
  pushKnown: false;
};

export function thresholdType(line: number): ThresholdType {
  return isHalfPointLine(line) ? "half_point" : "integer";
}

/**
 * Integer N from the half-point brackets N-0.5 and N+0.5.
 * P(X <= N-1) = no-vig under at N-0.5.
 * P(X <= N) = no-vig under at N+0.5.
 * The push is the difference. A negative gap is rejected, not clipped to zero.
 */
export function priceIntegerFromAdjacent(line: number, low: BookQuote[], high: BookQuote[]): ThreeWayPrice | { code: "NO_COMPATIBLE_ALT_LINES" | "INCONSISTENT_ALT_LINES" } {
  if (!Number.isInteger(line)) return { code: "NO_COMPATIBLE_ALT_LINES" };
  const underLow = fairFromBooks(low);
  const underHigh = fairFromBooks(high);
  if (!underLow || !underHigh) return { code: "NO_COMPATIBLE_ALT_LINES" };
  const pLessWin = underLow.fairUnder;
  const pAtMost = underHigh.fairUnder;
  const pPush = pAtMost - pLessWin;
  const pMoreWin = 1 - pAtMost;
  if (pLessWin < -0.01 || pPush < -0.01 || pMoreWin < -0.01) return { code: "INCONSISTENT_ALT_LINES" };
  const sum = pLessWin + pPush + pMoreWin;
  if (Math.abs(sum - 1) > 0.02) return { code: "INCONSISTENT_ALT_LINES" };
  return {
    pLessWin: round3(pLessWin),
    pPush: round3(pPush),
    pMoreWin: round3(pMoreWin),
    books: Math.min(underLow.books, underHigh.books),
    method: "adjacent_half_points",
    pushKnown: true,
  };
}

/** Two-way price at the integer itself. This is conditional on no push. */
export function conditionalIntegerPrice(quotes: BookQuote[]): ConditionalPrice | null {
  const fair = fairFromBooks(quotes);
  if (!fair) return null;
  return {
    conditionalMore: round3(fair.fairOver),
    conditionalLess: round3(fair.fairUnder),
    books: fair.books,
    method: "conditional_two_way",
    pushKnown: false,
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

import type { ComparisonClass } from "./types";

export type ComparisonInput = {
  promotional: boolean;
  scopesMatch: boolean;
  line: number;
  bookLine: number | null;
  books: number | null;
  bookRangePoints: number | null;
  quotesFound: boolean;
  integerLine: boolean;
  integerPushKnown: boolean;
};

export type ComparisonResult = {
  comparison: ComparisonClass;
  discrepancyPoints: number | null;
  direction: "higher_line" | "lower_line" | "same_line" | null;
  reason: string;
};

/** A line gap is a pricing signal. It is not a verified expected-value edge. */
export function classifyComparison(input: ComparisonInput): ComparisonResult {
  if (input.promotional) {
    return { comparison: "INVALID_COMPARISON", discrepancyPoints: null, direction: null, reason: "Demon, goblin, and other promotional selections are not standard markets." };
  }
  if (!input.scopesMatch) {
    return { comparison: "INVALID_COMPARISON", discrepancyPoints: null, direction: null, reason: "The sportsbook market uses a different map, period, or match scope." };
  }
  if (!input.quotesFound || input.bookLine == null || input.books == null || input.books < 2) {
    return { comparison: "INSUFFICIENT_COMPARABLE_DATA", discrepancyPoints: null, direction: null, reason: "Fewer than two books priced this exact comparison." };
  }
  if (input.integerLine && !input.integerPushKnown) {
    return { comparison: "INSUFFICIENT_COMPARABLE_DATA", discrepancyPoints: null, direction: null, reason: "Integer line — push probability was not estimated from both adjacent half-point lines." };
  }
  const gap = Math.round((input.line - input.bookLine) * 10) / 10;
  const direction = gap === 0 ? "same_line" : gap > 0 ? "higher_line" : "lower_line";
  if (gap === 0) {
    return { comparison: "MARKET_ALREADY_ADJUSTED", discrepancyPoints: 0, direction, reason: "The PrizePicks threshold matches the compared sportsbook line. That is not an inefficiency." };
  }
  const tight = input.books >= 3 && input.bookRangePoints != null && input.bookRangePoints <= 10 && Math.abs(gap) >= 0.5;
  if (tight) {
    return {
      comparison: "VERIFIED_MARKET_DISCREPANCY",
      discrepancyPoints: gap,
      direction,
      reason: "Same scope and stat, with the PrizePicks threshold off the compared sportsbook line. This is not a claim of positive expected value.",
    };
  }
  return {
    comparison: "POSSIBLE_PRICING_INEFFICIENCY",
    discrepancyPoints: gap,
    direction,
    reason: "The thresholds differ, and book depth or agreement is too thin to treat the gap as verified.",
  };
}

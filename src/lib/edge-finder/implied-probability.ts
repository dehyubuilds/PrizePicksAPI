import type { EdgePickSide } from "./types";

/** PrizePicks pick'em baseline — demons/goblins shift the implied difficulty. */
export function prizepicksImpliedProbability(params: {
  oddsType: string;
  side: EdgePickSide;
}): number {
  const type = params.oddsType.trim().toLowerCase();
  if (type === "demon") {
    return params.side === "over" ? 38 : 62;
  }
  if (type === "goblin") {
    return params.side === "over" ? 58 : 42;
  }
  return 50;
}

export function kalshiSideImpliedProbability(params: {
  yesBidDollars: string;
  pickedSide: "yes" | "no";
}): number | null {
  const yesBid = Number.parseFloat(params.yesBidDollars);
  if (!Number.isFinite(yesBid)) return null;
  const yesPct = Math.max(0, Math.min(100, Math.round(yesBid * 100)));
  return params.pickedSide === "yes" ? yesPct : 100 - yesPct;
}

/** Polymarket prices are 0–1 decimals on Gamma/CLOB. */
export function polymarketSideImpliedProbability(params: {
  yesPrice: string;
  noPrice: string;
  pickedSide: "yes" | "no";
}): number | null {
  const yes = Number.parseFloat(params.yesPrice);
  const no = Number.parseFloat(params.noPrice);
  const yesPct = Number.isFinite(yes)
    ? Math.max(0, Math.min(100, Math.round(yes * 100)))
    : Number.isFinite(no)
      ? Math.max(0, Math.min(100, Math.round((1 - no) * 100)))
      : null;
  if (yesPct === null) return null;
  return params.pickedSide === "yes" ? yesPct : 100 - yesPct;
}

/** Blend Kalshi price with a small shrink toward 50 when match quality is weak. */
export function adjustedProbability(params: {
  kalshiImpliedProb: number;
  matchScore: number;
}): number {
  const weight = Math.max(0.35, Math.min(1, params.matchScore / 100));
  const blended = params.kalshiImpliedProb * weight + 50 * (1 - weight);
  return Math.round(Math.max(0, Math.min(100, blended)));
}

export function edgePercent(params: {
  adjustedProb: number;
  prizepicksImpliedProb: number;
}): number {
  return Math.round((params.adjustedProb - params.prizepicksImpliedProb) * 10) / 10;
}

export function confidenceLabelFromScore(score: number): "low" | "medium" | "high" {
  if (score >= 72) return "high";
  if (score >= 48) return "medium";
  return "low";
}

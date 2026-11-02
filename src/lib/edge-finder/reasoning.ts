import type { EdgePickSide, EdgeScanPick } from "./types";
import { prizePicksBoardUrlForPick } from "@/lib/prizepicks/board-url";

function sideLabel(side: EdgePickSide): string {
  return side === "over" ? "Over" : "Under";
}

function confidencePhrase(label: EdgeScanPick["confidenceLabel"]): string {
  if (label === "high") return "High confidence";
  if (label === "medium") return "Medium confidence";
  return "Low confidence";
}

export function buildEdgeReasoning(pick: {
  playerName: string;
  sport: string;
  statDisplayName: string;
  lineScore: number;
  side: EdgePickSide;
  oddsType: string;
  prizepicksImpliedProb: number;
  kalshiImpliedProb: number | null;
  polymarketImpliedProb?: number | null;
  adjustedProb: number | null;
  edgePercent: number | null;
  confidenceLabel: EdgeScanPick["confidenceLabel"];
  primaryVenue?: EdgeScanPick["primaryVenue"];
  kalshi: EdgeScanPick["kalshi"];
  polymarket?: EdgeScanPick["polymarket"];
}): string {
  const line = `${pick.playerName} ${sideLabel(pick.side)} ${pick.lineScore} ${pick.statDisplayName}`;
  const oddsNote =
    pick.oddsType !== "standard"
      ? ` This is a ${pick.oddsType} line on PrizePicks, which shifts the baseline probability.`
      : "";

  const venueImplied =
    pick.primaryVenue === "polymarket"
      ? pick.polymarketImpliedProb
      : pick.kalshiImpliedProb;
  const venueMatch =
    pick.primaryVenue === "polymarket" ? pick.polymarket : pick.kalshi;
  const venueLabel = pick.primaryVenue === "polymarket" ? "Polymarket" : "Kalshi";

  if (venueMatch && venueImplied !== null && venueImplied !== undefined && pick.edgePercent !== null) {
    const direction =
      pick.edgePercent >= 5
        ? "looks softer than Kalshi pricing suggests"
        : pick.edgePercent >= 1.5
          ? "may offer a small pricing gap versus Kalshi"
          : pick.edgePercent <= -3
            ? "looks harder than Kalshi pricing supports"
            : "is roughly in line with Kalshi";

    const directionFixed =
      pick.primaryVenue === "polymarket"
        ? direction.replace(/Kalshi/g, venueLabel)
        : direction;

    const fakeDemonNote =
      pick.oddsType === "demon" && pick.edgePercent >= 4
        ? ` This may be a fake demon — the scary line still looks achievable versus ${venueLabel}.`
        : "";

    return `${line} in ${pick.sport}.${oddsNote} Matched ${venueLabel} market "${venueMatch.marketTitle}" at ~${venueImplied}% for this side versus ~${pick.prizepicksImpliedProb}% on PrizePicks. The prop ${directionFixed} (edge ~${pick.edgePercent >= 0 ? "+" : ""}${pick.edgePercent}%). ${confidencePhrase(pick.confidenceLabel)}.${fakeDemonNote}`;
  }

  return `${line} in ${pick.sport}.${oddsNote} No strong pricing-venue match was found, so treat this as unverified and lower confidence. ${confidencePhrase(pick.confidenceLabel)}.`;
}

export function demonPickXText(pick: EdgeScanPick): string {
  const venue =
    pick.primaryVenue === "polymarket"
      ? "Polymarket"
      : pick.polymarket && !pick.kalshi
        ? "Polymarket"
        : "Kalshi";
  const edge = pick.edgePercent ?? 0;
  const confidence =
    pick.confidenceLabel === "high"
      ? "High"
      : pick.confidenceLabel === "medium"
        ? "Medium"
        : "Low";
  return `Demon alert: ${pick.pickLine}. ${venue} pricing suggests this scary line may still be reachable (fake demon, edge ${edge >= 0 ? "+" : ""}${edge}%). Confidence: ${confidence}. Play responsibly — entertainment only, not gambling advice, no guarantees.`;
}

/** Actionable tweet for automation — exact PrizePicks line you can enter right now. */
export function edgePickActionableXText(
  pick: EdgeScanPick,
  prizepicksUrl = prizePicksBoardUrlForPick({
    prizepicksProjectionId: pick.prizepicksProjectionId,
    side: pick.side,
    lineScore: pick.lineScore,
  })
): string {
  const venue =
    pick.primaryVenue === "polymarket"
      ? "Polymarket"
      : pick.polymarket && !pick.kalshi
        ? "Polymarket"
        : "Kalshi";
  const edge = pick.edgePercent ?? 0;
  const side = pick.side === "over" ? "Over" : "Under";
  const odds =
    pick.oddsType && pick.oddsType.trim().toLowerCase() !== "standard"
      ? ` (${pick.oddsType})`
      : "";
  return (
    `PrizePicks edge play (live now): ${pick.playerName} ${side} ${pick.lineScore} ${pick.statDisplayName}${odds}. ` +
    `Enter this exact line in the app — ${venue} edge ${edge >= 0 ? "+" : ""}${edge}%. ` +
    `${prizepicksUrl} ` +
    `Entertainment only, not gambling advice.`
  );
}

/** @deprecated Use edgePickActionableXText */
export const demonPickActionableXText = edgePickActionableXText;

export function freePickXText(pick: EdgeScanPick): string {
  const hook =
    pick.edgePercent !== null && pick.edgePercent >= 4
      ? "Market data suggests this line may be soft."
      : "Market data flagged this as today's best available edge.";
  const confidence =
    pick.confidenceLabel === "high"
      ? "High"
      : pick.confidenceLabel === "medium"
        ? "Medium"
        : "Low";
  return `Today's free edge: ${pick.pickLine}. ${hook} Confidence: ${confidence}. Play responsibly — entertainment only, not gambling advice, no guarantees.`;
}

export const EDGE_FINDER_DISCLAIMER =
  "For entertainment only — not gambling advice. Past performance does not guarantee future results.";

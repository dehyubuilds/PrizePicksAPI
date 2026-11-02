import { pickLineForProjection } from "@/lib/edge-finder/match-markets";
import { prizepicksImpliedProbability } from "@/lib/edge-finder/implied-probability";
import type { EdgeScanPick } from "@/lib/edge-finder/types";
import type { DailyModelPickMeta } from "./types";
import type { VenueAlignmentResult } from "./venue-alignment";
import { confidenceLabelForScore } from "./score-pick";

export function dailyPickToEdgeScanPick(params: {
  projection: EdgeScanPick["projection"];
  side: EdgeScanPick["side"];
  meta: DailyModelPickMeta;
  venue: VenueAlignmentResult;
}): EdgeScanPick {
  const { projection, side, meta, venue } = params;
  const venueLabel =
    meta.venueAlignment === "aligned" && meta.venueEdgePercent !== null
      ? ` ${venue.primaryVenue === "polymarket" ? "Polymarket" : "Kalshi"} confirms ~+${Math.round(meta.venueEdgePercent)}% on this side.`
      : "";

  return {
    id: `${projection.id}:${side}`,
    prizepicksProjectionId: projection.id,
    playerName: projection.playerName,
    sport: projection.leagueName,
    team: projection.team,
    opponent: projection.opponent,
    statDisplayName: projection.statDisplayName,
    statType: projection.statType,
    lineScore: projection.lineScore,
    side,
    oddsType: projection.oddsType,
    startTime: projection.startTime,
    pickLine: pickLineForProjection(projection, side),
    prizepicksImpliedProb: prizepicksImpliedProbability({
      oddsType: projection.oddsType,
      side,
    }),
    kalshiImpliedProb: null,
    polymarketImpliedProb: null,
    adjustedProb: null,
    edgePercent: meta.finalEdgePercent,
    confidenceScore: meta.finalConfidenceScore,
    confidenceLabel: confidenceLabelForScore(meta.finalConfidenceScore),
    category: "free",
    primaryVenue: venue.primaryVenue,
    reasoning: `Daily model ${side} edge ~${meta.modelEdgePercent >= 0 ? "+" : ""}${meta.modelEdgePercent}% (v${meta.modelVersion}).${venueLabel}`,
    kalshi: venue.kalshi,
    polymarket: venue.polymarket,
    projection,
  };
}

export function sortDailyPicks(picks: EdgeScanPick[], metas: Map<string, DailyModelPickMeta>): EdgeScanPick[] {
  return [...picks].sort((a, b) => {
    const metaA = metas.get(a.id);
    const metaB = metas.get(b.id);
    const alignA = metaA?.venueAlignment === "aligned" ? 1 : 0;
    const alignB = metaB?.venueAlignment === "aligned" ? 1 : 0;
    if (alignA !== alignB) return alignB - alignA;
    const confDiff = (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0);
    if (confDiff !== 0) return confDiff;
    return (b.edgePercent ?? -999) - (a.edgePercent ?? -999);
  });
}

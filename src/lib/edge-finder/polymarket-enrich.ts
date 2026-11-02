import { fetchPolymarketMarketsForEdgeScan } from "@/lib/polymarket/markets";
import { confidenceLabelFromScore } from "./implied-probability";
import { buildPolymarketPickCandidate } from "./match-polymarket";
import { buildEdgeReasoning } from "./reasoning";
import type { EdgeScanPick, EdgeScanResult, EdgeVenueSource } from "./types";

function pickVenueSource(params: {
  kalshiScore: number;
  polymarketScore: number;
  kalshiEdge: number | null;
  polymarketEdge: number | null;
}): EdgeVenueSource {
  if (params.polymarketScore > params.kalshiScore) return "polymarket";
  if (params.kalshiScore > params.polymarketScore) return "kalshi";
  const kalshi = params.kalshiEdge ?? Number.NEGATIVE_INFINITY;
  const poly = params.polymarketEdge ?? Number.NEGATIVE_INFINITY;
  return poly > kalshi ? "polymarket" : "kalshi";
}

function enrichPick(
  pick: EdgeScanPick,
  markets: Awaited<ReturnType<typeof fetchPolymarketMarketsForEdgeScan>>
): EdgeScanPick {
  const polyCandidate = buildPolymarketPickCandidate({
    projection: pick.projection,
    side: pick.side,
    markets,
  });

  const kalshiScore = pick.kalshi?.matchScore ?? 0;
  const polymarketScore = polyCandidate.polymarket?.matchScore ?? 0;
  const primaryVenue = pickVenueSource({
    kalshiScore,
    polymarketScore,
    kalshiEdge: pick.edgePercent,
    polymarketEdge: polyCandidate.edgePercent,
  });

  const usePolymarket =
    primaryVenue === "polymarket" &&
    polyCandidate.polymarket &&
    polyCandidate.edgePercent !== null &&
    polyCandidate.adjustedProb !== null;

  const edgePercent = usePolymarket
    ? polyCandidate.edgePercent
    : pick.edgePercent ?? polyCandidate.edgePercent;
  const adjustedProb = usePolymarket
    ? polyCandidate.adjustedProb
    : pick.adjustedProb ?? polyCandidate.adjustedProb;
  const confidenceScore = Math.max(
    pick.confidenceScore,
    polyCandidate.confidenceScore,
    usePolymarket ? polyCandidate.confidenceScore : 0
  );

  const enriched: EdgeScanPick = {
    ...pick,
    polymarket: polyCandidate.polymarket,
    polymarketImpliedProb: polyCandidate.polymarketImpliedProb,
    polymarketEdgePercent: polyCandidate.edgePercent,
    primaryVenue,
    edgePercent,
    adjustedProb,
    confidenceScore,
    confidenceLabel: confidenceLabelFromScore(confidenceScore),
  };

  return {
    ...enriched,
    reasoning: buildEdgeReasoning(enriched),
  };
}

export async function enrichScanResultWithPolymarket(
  result: EdgeScanResult
): Promise<EdgeScanResult> {
  const sports = result.summary.sports;
  const markets = await fetchPolymarketMarketsForEdgeScan(sports);
  if (!markets.length) return result;

  const enrich = (pick: EdgeScanPick) => enrichPick(pick, markets);

  const demonWatchlist = result.demonWatchlist
    .map(enrich)
    .sort((a, b) => (b.edgePercent ?? 0) - (a.edgePercent ?? 0));

  return {
    ...result,
    picks: result.picks.map(enrich),
    freePick: result.freePick ? enrich(result.freePick) : null,
    premiumPicks: result.premiumPicks.map(enrich),
    demonWatchlist,
    avoidList: result.avoidList.map(enrich),
    summary: {
      ...result.summary,
      polymarketMarketCount: markets.length,
    },
  };
}

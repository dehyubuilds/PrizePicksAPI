import { confidenceLabelFromScore } from "@/lib/edge-finder/implied-probability";
import { buildPickCandidate } from "@/lib/edge-finder/match-markets";
import { buildPolymarketPickCandidate } from "@/lib/edge-finder/match-polymarket";
import { buildEdgeReasoning } from "@/lib/edge-finder/reasoning";
import type { EdgeScanPick } from "@/lib/edge-finder/types";
import { fetchKalshiMarketsForEdgeScan } from "@/lib/edge-finder/kalshi-markets";
import { fetchPolymarketMarketsForEdgeScan } from "@/lib/polymarket/markets";
import { fetchPolymarketClobMidpoint } from "@/lib/polymarket/client";
import {
  isPostableEdgePick,
  postableRejectionReason,
} from "./select-postable-pick";

export type EdgePickRevalidationResult = {
  pick: EdgeScanPick | null;
  reason?: string;
};

async function refreshPolymarketPrices(
  pick: EdgeScanPick
): Promise<EdgeScanPick | null> {
  if (!pick.polymarket?.market.yesTokenId) return pick;

  const mid = await fetchPolymarketClobMidpoint(pick.polymarket.market.yesTokenId);
  if (!mid) return pick;

  const yes = Number.parseFloat(mid);
  if (!Number.isFinite(yes)) return pick;

  const market = {
    ...pick.polymarket.market,
    yesPrice: mid,
    noPrice: String(Math.max(0, 1 - yes)),
  };

  const polyCandidate = buildPolymarketPickCandidate({
    projection: pick.projection,
    side: pick.side,
    markets: [market],
  });

  if (!polyCandidate.polymarket) return pick;

  const usePolymarket =
    pick.primaryVenue === "polymarket" &&
    polyCandidate.edgePercent !== null &&
    polyCandidate.adjustedProb !== null;

  if (!usePolymarket) return pick;

  const enriched: EdgeScanPick = {
    ...pick,
    polymarket: polyCandidate.polymarket,
    polymarketImpliedProb: polyCandidate.polymarketImpliedProb,
    polymarketEdgePercent: polyCandidate.edgePercent,
    edgePercent: polyCandidate.edgePercent,
    adjustedProb: polyCandidate.adjustedProb,
    confidenceScore: Math.max(pick.confidenceScore, polyCandidate.confidenceScore),
    confidenceLabel: confidenceLabelFromScore(
      Math.max(pick.confidenceScore, polyCandidate.confidenceScore)
    ),
  };

  return {
    ...enriched,
    reasoning: buildEdgeReasoning(enriched),
  };
}

export async function revalidateEdgePickAtPostTime(
  pick: EdgeScanPick
): Promise<EdgePickRevalidationResult> {
  const markets = await fetchKalshiMarketsForEdgeScan([pick.sport]);
  const kalshiCandidate = buildPickCandidate({
    projection: pick.projection,
    side: pick.side,
    markets,
  });

  const matchedTicker = pick.kalshi?.ticker ?? null;
  const freshKalshi =
    matchedTicker && kalshiCandidate.kalshi?.ticker === matchedTicker
      ? kalshiCandidate.kalshi
      : kalshiCandidate.kalshi;

  let updated: EdgeScanPick = {
    ...pick,
    kalshi: freshKalshi ?? pick.kalshi,
    kalshiImpliedProb: kalshiCandidate.kalshiImpliedProb ?? pick.kalshiImpliedProb,
    adjustedProb: kalshiCandidate.adjustedProb ?? pick.adjustedProb,
    edgePercent: kalshiCandidate.edgePercent ?? pick.edgePercent,
    confidenceScore: Math.max(pick.confidenceScore, kalshiCandidate.confidenceScore),
    confidenceLabel: confidenceLabelFromScore(
      Math.max(pick.confidenceScore, kalshiCandidate.confidenceScore)
    ),
  };

  if (pick.primaryVenue === "polymarket" && pick.polymarket) {
    const polyMarkets = await fetchPolymarketMarketsForEdgeScan([pick.sport]);
    const known = polyMarkets.find((row) => row.conditionId === pick.polymarket!.conditionId);
    if (known) {
      const polyCandidate = buildPolymarketPickCandidate({
        projection: pick.projection,
        side: pick.side,
        markets: [known],
      });
      if (polyCandidate.polymarket && polyCandidate.edgePercent !== null) {
        updated = {
          ...updated,
          polymarket: polyCandidate.polymarket,
          polymarketImpliedProb: polyCandidate.polymarketImpliedProb,
          polymarketEdgePercent: polyCandidate.edgePercent,
          edgePercent: polyCandidate.edgePercent,
          adjustedProb: polyCandidate.adjustedProb,
          confidenceScore: Math.max(updated.confidenceScore, polyCandidate.confidenceScore),
          confidenceLabel: confidenceLabelFromScore(
            Math.max(updated.confidenceScore, polyCandidate.confidenceScore)
          ),
        };
      }
    }
    const withPrices = await refreshPolymarketPrices(updated);
    if (withPrices) updated = withPrices;
  } else if (!freshKalshi && matchedTicker) {
    return { pick: null, reason: "venue_match_lost" };
  }

  updated = {
    ...updated,
    reasoning: buildEdgeReasoning(updated),
  };

  if (!isPostableEdgePick(updated)) {
    return { pick: null, reason: postableRejectionReason(updated) ?? "edge_below_threshold" };
  }

  return { pick: updated };
}

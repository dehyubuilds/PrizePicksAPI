import { buildPickCandidate } from "@/lib/edge-finder/match-markets";
import { buildPolymarketPickCandidate } from "@/lib/edge-finder/match-polymarket";
import { bestVenueMatchScore } from "@/lib/edge-finder/match-quality";
import type { EdgeKalshiMatch, EdgePickSide, EdgePolymarketMatch, EdgeVenueSource } from "@/lib/edge-finder/types";
import type { KalshiMarketSummary } from "@/lib/kalshi/types";
import type { PolymarketMarketSummary } from "@/lib/polymarket/types";
import type { PrizePicksProjection } from "@/lib/prizepicks/types";
import type { VenueAlignmentStatus } from "./types";

const MIN_VENUE_EDGE = 3;
const MIN_VENUE_MATCH = 65;

export type VenueAlignmentResult = {
  alignment: VenueAlignmentStatus;
  venueEdgePercent: number | null;
  venueBoost: number;
  confidenceBoost: number;
  primaryVenue?: EdgeVenueSource;
  kalshi: EdgeKalshiMatch | null;
  polymarket: EdgePolymarketMatch | null;
};

function venueCandidateForSide(params: {
  projection: PrizePicksProjection;
  side: EdgePickSide;
  kalshiMarkets: KalshiMarketSummary[];
  polyMarkets: PolymarketMarketSummary[];
}): {
  edge: number | null;
  matchScore: number;
  primaryVenue?: EdgeVenueSource;
  kalshi: EdgeKalshiMatch | null;
  polymarket: EdgePolymarketMatch | null;
} {
  const kalshiOver = buildPickCandidate({
    projection: params.projection,
    side: "over",
    markets: params.kalshiMarkets,
  });
  const kalshiUnder = buildPickCandidate({
    projection: params.projection,
    side: "under",
    markets: params.kalshiMarkets,
  });
  const polyOver = buildPolymarketPickCandidate({
    projection: params.projection,
    side: "over",
    markets: params.polyMarkets,
  });
  const polyUnder = buildPolymarketPickCandidate({
    projection: params.projection,
    side: "under",
    markets: params.polyMarkets,
  });

  const candidates = [
    { side: "over" as const, kalshi: kalshiOver, poly: polyOver },
    { side: "under" as const, kalshi: kalshiUnder, poly: polyUnder },
  ];

  let best: {
    edge: number | null;
    matchScore: number;
    primaryVenue?: EdgeVenueSource;
    kalshi: EdgeKalshiMatch | null;
    polymarket: EdgePolymarketMatch | null;
  } = {
    edge: null,
    matchScore: 0,
    kalshi: null,
    polymarket: null,
  };

  for (const row of candidates) {
    if (row.side !== params.side) continue;
    const kalshiEdge = row.kalshi.edgePercent;
    const kalshiScore = row.kalshi.kalshi?.matchScore ?? 0;
    if (kalshiEdge !== null && kalshiScore >= best.matchScore) {
      best = {
        edge: kalshiEdge,
        matchScore: kalshiScore,
        primaryVenue: "kalshi",
        kalshi: row.kalshi.kalshi,
        polymarket: null,
      };
    }
    const polyEdge = row.poly.edgePercent;
    const polyScore = row.poly.polymarket?.matchScore ?? 0;
    if (polyEdge !== null && polyScore > best.matchScore) {
      best = {
        edge: polyEdge,
        matchScore: polyScore,
        primaryVenue: "polymarket",
        kalshi: null,
        polymarket: row.poly.polymarket,
      };
    }
  }

  return best;
}

export function computeVenueAlignment(params: {
  projection: PrizePicksProjection;
  modelSide: EdgePickSide;
  modelEdgePercent: number;
  kalshiMarkets: KalshiMarketSummary[];
  polyMarkets: PolymarketMarketSummary[];
}): VenueAlignmentResult {
  const chosen = venueCandidateForSide({
    projection: params.projection,
    side: params.modelSide,
    kalshiMarkets: params.kalshiMarkets,
    polyMarkets: params.polyMarkets,
  });

  const oppositeSide: EdgePickSide = params.modelSide === "over" ? "under" : "over";
  const opposite = venueCandidateForSide({
    projection: params.projection,
    side: oppositeSide,
    kalshiMarkets: params.kalshiMarkets,
    polyMarkets: params.polyMarkets,
  });

  let alignment: VenueAlignmentStatus = "neutral";
  let venueBoost = 0;
  let confidenceBoost = 0;

  if (
    chosen.edge !== null &&
    chosen.edge >= MIN_VENUE_EDGE &&
    chosen.matchScore >= MIN_VENUE_MATCH
  ) {
    alignment = "aligned";
    venueBoost = Math.min(5, chosen.edge * 0.25);
    confidenceBoost = chosen.matchScore >= 70 ? 8 : 4;
  } else if (
    opposite.edge !== null &&
    opposite.edge >= MIN_VENUE_EDGE &&
    opposite.matchScore >= MIN_VENUE_MATCH
  ) {
    alignment = "conflict";
  }

  return {
    alignment,
    venueEdgePercent: chosen.edge,
    venueBoost,
    confidenceBoost,
    primaryVenue: chosen.primaryVenue,
    kalshi: chosen.kalshi,
    polymarket: chosen.polymarket,
  };
}

export function alignmentRankBoost(alignment: VenueAlignmentStatus): number {
  if (alignment === "aligned") return 2;
  if (alignment === "neutral") return 1;
  return 0;
}

export function venueMatchScoreFromPick(params: {
  kalshi: EdgeKalshiMatch | null;
  polymarket: EdgePolymarketMatch | null;
}): number {
  return bestVenueMatchScore({
    id: "",
    prizepicksProjectionId: "",
    playerName: "",
    sport: "",
    team: "",
    opponent: "",
    statDisplayName: "",
    statType: "",
    lineScore: 0,
    side: "over",
    oddsType: "standard",
    startTime: "",
    pickLine: "",
    prizepicksImpliedProb: 50,
    kalshiImpliedProb: null,
    adjustedProb: null,
    edgePercent: null,
    confidenceScore: 0,
    confidenceLabel: "low",
    category: "free",
    reasoning: "",
    kalshi: params.kalshi,
    polymarket: params.polymarket,
    projection: {
      id: "",
      playerName: "",
      team: "",
      opponent: "",
      leagueId: "",
      leagueName: "",
      statDisplayName: "",
      statType: "",
      lineScore: 0,
      oddsType: "standard",
      startTime: "",
      gameId: "",
      status: "",
    },
  });
}

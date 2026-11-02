import type { EdgeScanPick, EdgeScanResult } from "./types";
import { confidenceLabelFromScore } from "./implied-probability";
import { bestVenueMatchScore, isSuspiciousEdgePick } from "./match-quality";
import { buildPickCandidate, pickLineForProjection } from "./match-markets";
import { buildEdgeReasoning } from "./reasoning";

const PREMIUM_COUNT = 5;

function isDemonType(oddsType: string): boolean {
  const value = oddsType.trim().toLowerCase();
  return value === "demon" || value === "goblin";
}

function pickId(projectionId: string, side: string): string {
  return `${projectionId}:${side}`;
}

function buildScanPick(params: {
  projection: import("@/lib/prizepicks/types").PrizePicksProjection;
  side: import("./types").EdgePickSide;
  markets: import("@/lib/kalshi/types").KalshiMarketSummary[];
}): EdgeScanPick {
  const candidate = buildPickCandidate({
    projection: params.projection,
    side: params.side,
    markets: params.markets,
  });
  const confidenceLabel = confidenceLabelFromScore(candidate.confidenceScore);
  const base = {
    id: pickId(params.projection.id, params.side),
    prizepicksProjectionId: params.projection.id,
    playerName: params.projection.playerName,
    sport: params.projection.leagueName,
    team: params.projection.team,
    opponent: params.projection.opponent,
    statDisplayName: params.projection.statDisplayName,
    statType: params.projection.statType,
    lineScore: params.projection.lineScore,
    side: params.side,
    oddsType: params.projection.oddsType,
    startTime: params.projection.startTime,
    pickLine: pickLineForProjection(params.projection, params.side),
    prizepicksImpliedProb: candidate.prizepicksImpliedProb,
    kalshiImpliedProb: candidate.kalshiImpliedProb,
    adjustedProb: candidate.adjustedProb,
    edgePercent: candidate.edgePercent,
    confidenceScore: candidate.confidenceScore,
    confidenceLabel,
    category: "premium" as const,
    kalshi: candidate.kalshi,
    projection: params.projection,
  };

  return {
    ...base,
    reasoning: buildEdgeReasoning(base),
  };
}

function bestSideForProjection(
  projection: import("@/lib/prizepicks/types").PrizePicksProjection,
  markets: import("@/lib/kalshi/types").KalshiMarketSummary[]
): EdgeScanPick {
  const over = buildScanPick({ projection, side: "over", markets });
  const under = buildScanPick({ projection, side: "under", markets });

  const overEdge = over.edgePercent ?? Number.NEGATIVE_INFINITY;
  const underEdge = under.edgePercent ?? Number.NEGATIVE_INFINITY;

  if (underEdge > overEdge) return under;
  if (overEdge > underEdge) return over;

  return over.confidenceScore >= under.confidenceScore ? over : under;
}

function assignCategories(sorted: EdgeScanPick[]): EdgeScanResult {
  const picks = sorted.map((pick) => ({ ...pick }));
  const avoidList: EdgeScanPick[] = [];
  const demonWatchlist: EdgeScanPick[] = [];
  const premiumCandidates: EdgeScanPick[] = [];

  for (const pick of picks) {
    const edge = pick.edgePercent ?? Number.NEGATIVE_INFINITY;
    const weakMatch = bestVenueMatchScore(pick) < 60;
    const suspicious = isSuspiciousEdgePick(pick);

    if (edge <= -1.5 || weakMatch || suspicious) {
      pick.category = "avoid";
      avoidList.push(pick);
      continue;
    }

    if (isDemonType(pick.oddsType)) {
      pick.category = "demon";
      demonWatchlist.push(pick);
      continue;
    }

    premiumCandidates.push(pick);
  }

  premiumCandidates.sort((a, b) => (b.edgePercent ?? 0) - (a.edgePercent ?? 0));

  let freePick: EdgeScanPick | null = null;
  const premiumPicks: EdgeScanPick[] = [];

  for (const candidate of premiumCandidates) {
    const edge = candidate.edgePercent ?? 0;
    if (
      !freePick &&
      candidate.oddsType === "standard" &&
      edge >= 2 &&
      candidate.confidenceLabel !== "low"
    ) {
      candidate.category = "free";
      freePick = candidate;
      continue;
    }
    if (premiumPicks.length < PREMIUM_COUNT && edge > 0) {
      candidate.category = "premium";
      premiumPicks.push(candidate);
    }
  }

  if (!freePick) {
    const fallback = premiumCandidates.find(
      (pick) => (pick.edgePercent ?? 0) > 0 && pick.confidenceLabel !== "low"
    );
    if (fallback) {
      fallback.category = "free";
      freePick = fallback;
      const idx = premiumPicks.findIndex((pick) => pick.id === fallback.id);
      if (idx >= 0) premiumPicks.splice(idx, 1);
    }
  }

  return {
    summary: {
      scannedAt: new Date().toISOString(),
      projectionCount: 0,
      kalshiMarketCount: 0,
      matchedCount: picks.filter((pick) => pick.kalshi).length,
      prizepicksFromCache: false,
      sports: [],
    },
    picks,
    freePick,
    premiumPicks,
    demonWatchlist: demonWatchlist.sort((a, b) => (b.edgePercent ?? 0) - (a.edgePercent ?? 0)),
    avoidList: avoidList.sort((a, b) => (a.edgePercent ?? 0) - (b.edgePercent ?? 0)),
  };
}

export function rankAndCategorizePicks(picks: EdgeScanPick[]): EdgeScanResult {
  const sorted = [...picks].sort((a, b) => {
    const edgeDiff = (b.edgePercent ?? -999) - (a.edgePercent ?? -999);
    if (edgeDiff !== 0) return edgeDiff;
    return b.confidenceScore - a.confidenceScore;
  });
  return assignCategories(sorted);
}

export function scanProjectionsForEdges(params: {
  projections: import("@/lib/prizepicks/types").PrizePicksProjection[];
  markets: import("@/lib/kalshi/types").KalshiMarketSummary[];
  prizepicksFromCache: boolean;
}): EdgeScanResult {
  const picks = params.projections.map((projection) =>
    bestSideForProjection(projection, params.markets)
  );
  const result = rankAndCategorizePicks(picks);
  const sports = Array.from(new Set(params.projections.map((row) => row.leagueName))).sort();
  result.summary = {
    ...result.summary,
    projectionCount: params.projections.length,
    kalshiMarketCount: params.markets.length,
    matchedCount: picks.filter((pick) => pick.kalshi).length,
    prizepicksFromCache: params.prizepicksFromCache,
    sports,
  };
  return result;
}

export function filterEdgeScanResult(
  result: EdgeScanResult,
  filters: import("./types").EdgeScanFilters
): EdgeScanResult {
  let picks = [...result.picks];

  if (filters.sport && filters.sport !== "all") {
    picks = picks.filter((pick) => pick.sport === filters.sport);
  }
  if (filters.category && filters.category !== "all") {
    picks = picks.filter((pick) => pick.category === filters.category);
  }
  if (typeof filters.minEdgePercent === "number") {
    picks = picks.filter((pick) => (pick.edgePercent ?? -999) >= filters.minEdgePercent!);
  }
  if (filters.minConfidence && filters.minConfidence !== "all") {
    const order = { low: 1, medium: 2, high: 3 } as const;
    const min = order[filters.minConfidence];
    picks = picks.filter((pick) => order[pick.confidenceLabel] >= min);
  }
  if (filters.startAfter) {
    const after = new Date(filters.startAfter).getTime();
    picks = picks.filter((pick) => new Date(pick.startTime).getTime() >= after);
  }
  if (filters.startBefore) {
    const before = new Date(filters.startBefore).getTime();
    picks = picks.filter((pick) => new Date(pick.startTime).getTime() <= before);
  }

  const filtered = rankAndCategorizePicks(picks);
  filtered.summary = { ...result.summary, ...filtered.summary, projectionCount: picks.length };
  return filtered;
}

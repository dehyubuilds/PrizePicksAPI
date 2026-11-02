import {
  createEdgeFinderSessionId,
  putEdgeFinderScanSession,
} from "@/lib/edge-finder/scan-session";
import { fetchKalshiMarketsForEdgeScan } from "@/lib/edge-finder/kalshi-markets";
import type { EdgeScanPick, EdgeScanResult } from "@/lib/edge-finder/types";
import { fetchPrizePicksProjections } from "@/lib/prizepicks/client";
import { prizepicksIntegrationEnabled } from "@/lib/prizepicks/config";
import { polymarketIntegrationEnabled } from "@/lib/polymarket/config";
import { fetchPolymarketMarketsForEdgeScan } from "@/lib/polymarket/markets";
import { inferSportTagsFromProjections } from "@/lib/edge-finder/infer-sport";
import {
  boardGroupKey,
  canonicalLiveLinesByBoardSlot,
  isPlayablePrizePicksProjection,
} from "@/lib/edge-finder-automation/prizepicks-live";
import { propStatFromProjection } from "@/lib/sports-stats/stat-mapping";
import { buildPickFeatures, loadFeatureContext } from "./features";
import { DAILY_PICKS_LEAGUES, isSupportedProjection } from "./leagues";
import { pickBestSide } from "./score-pick";
import { dailyPickToEdgeScanPick, sortDailyPicks } from "./rank-picks";
import { filterPostableDailyPicks } from "./select-postable-pick";
import { computeVenueAlignment } from "./venue-alignment";
import { dailyPicksModelVersion } from "./env";
import type { DailyModelPickMeta } from "./types";

function isStandardOddsType(oddsType: string): boolean {
  return oddsType.trim().toLowerCase() === "standard";
}

export async function runDailyPicksScan(params: {
  userId: string;
  forceLivePrizePicks?: boolean;
}): Promise<{ sessionId: string; result: EdgeScanResult; pickMetas: Map<string, DailyModelPickMeta> }> {
  if (!prizepicksIntegrationEnabled()) {
    throw new Error("PrizePicks integration is not enabled. Set PRIZEPICKS_ENABLED=true.");
  }

  const prizePicks = await fetchPrizePicksProjections(
    params.forceLivePrizePicks
      ? { forceLive: true, disallowCacheFallback: false }
      : {}
  );

  const canonicalBySlot = canonicalLiveLinesByBoardSlot(prizePicks.projections);
  const scannable = prizePicks.projections.filter((projection) => {
    if (!isSupportedProjection(projection)) return false;
    if (!isStandardOddsType(projection.oddsType)) return false;
    if (!isPlayablePrizePicksProjection(projection)) return false;
    if (propStatFromProjection(projection) === "unknown") return false;
    const canonical = canonicalBySlot.get(boardGroupKey(projection));
    if (!canonical || canonical.id !== projection.id) return false;
    return true;
  });

  const { weights, bias } = await loadFeatureContext();
  const sports = inferSportTagsFromProjections(scannable).filter((tag) =>
    (DAILY_PICKS_LEAGUES as readonly string[]).includes(tag)
  );
  const kalshiSports = sports.length ? sports : [...DAILY_PICKS_LEAGUES];
  const kalshiMarkets = await fetchKalshiMarketsForEdgeScan(kalshiSports);
  const polyMarkets = polymarketIntegrationEnabled()
    ? await fetchPolymarketMarketsForEdgeScan(kalshiSports)
    : [];

  const pickMetas = new Map<string, DailyModelPickMeta>();
  const scored: EdgeScanPick[] = [];

  for (const projection of scannable.slice(0, 200)) {
    const features = await buildPickFeatures(projection, bias);

    const best = pickBestSide({ features, weights });
    const venue = computeVenueAlignment({
      projection,
      modelSide: best.side,
      modelEdgePercent: best.modelEdgePercent,
      kalshiMarkets,
      polyMarkets,
    });

    const finalEdgePercent =
      Math.round((best.modelEdgePercent + venue.venueBoost) * 10) / 10;
    const finalConfidenceScore = Math.min(
      98,
      best.confidenceScore + venue.confidenceBoost
    );

    const meta: DailyModelPickMeta = {
      modelEdgePercent: best.modelEdgePercent,
      modelProb: best.modelProb,
      venueAlignment: venue.alignment,
      venueEdgePercent: venue.venueEdgePercent,
      venueBoost: venue.venueBoost,
      confidenceBoost: venue.confidenceBoost,
      finalEdgePercent,
      finalConfidenceScore,
      features,
      modelVersion: dailyPicksModelVersion(),
    };

    const pick = dailyPickToEdgeScanPick({
      projection,
      side: best.side,
      meta,
      venue,
    });
    pickMetas.set(pick.id, meta);
    scored.push(pick);
  }

  const picks = sortDailyPicks(scored, pickMetas);
  const postable = filterPostableDailyPicks(picks);
  const now = new Date().toISOString();
  const sessionId = createEdgeFinderSessionId();

  await putEdgeFinderScanSession({
    sessionId,
    userId: params.userId,
    createdAt: now,
    updatedAt: now,
    projections: scannable,
    totalRawProjections: prizePicks.projections.length,
    totalScannableProjections: scannable.length,
    prizepicksFromCache: prizePicks.fromCache === true,
    sports,
  });

  const result: EdgeScanResult = {
    summary: {
      scannedAt: now,
      projectionCount: scannable.length,
      kalshiMarketCount: kalshiMarkets.length,
      polymarketMarketCount: polyMarkets.length,
      matchedCount: postable.length,
      prizepicksFromCache: prizePicks.fromCache === true,
      sports,
      postableEdgeCount: postable.length,
      totalProjectionCount: prizePicks.projections.length,
      scannedProjectionCount: scannable.length,
    },
    picks,
    freePick: postable[0] ?? null,
    premiumPicks: postable.slice(1, 3),
    demonWatchlist: [],
    avoidList: [],
  };

  return { sessionId, result, pickMetas };
}

import { fetchPrizePicksProjections } from "@/lib/prizepicks";
import { prizepicksIntegrationEnabled } from "@/lib/prizepicks/config";
import type { PrizePicksProjection } from "@/lib/prizepicks/types";
import { scanProjectionsForEdges } from "./categorize";
import { fetchKalshiMarketsForEdgeScan } from "./kalshi-markets";
import { inferSportTagsFromProjections } from "./infer-sport";
import { selectProjectionsForEdgeScan } from "./select-projections";
import {
  createEdgeFinderSessionId,
  loadEdgeFinderScanSession,
  putEdgeFinderScanSession,
} from "./scan-session";
import type { EdgeScanResult } from "./types";

export type EdgeFinderPrizepicksPhaseResult = {
  sessionId: string;
  totalRawProjections: number;
  totalScannableProjections: number;
  scannedProjectionCount: number;
  sports: string[];
  prizepicksFromCache: boolean;
  scannedProjections: PrizePicksProjection[];
};

export type EdgeFinderKalshiPhaseResult = {
  sessionId: string;
  kalshiMarketCount: number;
};

function assertPrizepicksEnabled(): void {
  if (!prizepicksIntegrationEnabled()) {
    throw new Error("PrizePicks integration is not enabled. Set PRIZEPICKS_ENABLED=true.");
  }
}

export async function runEdgeFinderPrizepicksPhase(params: {
  userId: string;
  /** Automation jobs require a live PrizePicks board — never stale cache. */
  forceLivePrizePicks?: boolean;
}): Promise<EdgeFinderPrizepicksPhaseResult> {
  assertPrizepicksEnabled();

  const prizePicks = await fetchPrizePicksProjections(
    params.forceLivePrizePicks
      ? { forceLive: true, disallowCacheFallback: true }
      : {}
  );
  const { selected, totalRaw, totalScannable } = selectProjectionsForEdgeScan(
    prizePicks.projections
  );

  if (!selected.length) {
    if (totalRaw > 0) {
      throw new Error(
        `PrizePicks returned ${totalRaw} props but none were scannable (all inactive).`
      );
    }
    throw new Error(
      prizePicks.fromCache
        ? "PrizePicks cache is empty. Run Test PrizePicks API above first."
        : "PrizePicks returned no props. Update PRIZEPICKS_BROWSER_COOKIE on Netlify and redeploy, then run Test API."
    );
  }

  const sports = inferSportTagsFromProjections(selected);
  const sessionId = createEdgeFinderSessionId();
  const now = new Date().toISOString();

  await putEdgeFinderScanSession({
    sessionId,
    userId: params.userId,
    createdAt: now,
    updatedAt: now,
    projections: selected,
    totalRawProjections: totalRaw,
    totalScannableProjections: totalScannable,
    prizepicksFromCache: prizePicks.fromCache === true,
    sports,
  });

  return {
    sessionId,
    totalRawProjections: totalRaw,
    totalScannableProjections: totalScannable,
    scannedProjectionCount: selected.length,
    sports,
    prizepicksFromCache: prizePicks.fromCache === true,
    scannedProjections: selected,
  };
}

export async function runEdgeFinderKalshiPhase(params: {
  userId: string;
  sessionId: string;
}): Promise<EdgeFinderKalshiPhaseResult> {
  const session = await loadEdgeFinderScanSession(params);
  const markets = await fetchKalshiMarketsForEdgeScan(session.sports);

  session.markets = markets;
  session.kalshiMarketCount = markets.length;
  session.updatedAt = new Date().toISOString();
  await putEdgeFinderScanSession(session);

  return {
    sessionId: session.sessionId,
    kalshiMarketCount: markets.length,
  };
}

export async function runEdgeFinderAnalyzePhase(params: {
  userId: string;
  sessionId: string;
}): Promise<EdgeScanResult> {
  const session = await loadEdgeFinderScanSession(params);
  if (!session.markets) {
    throw new Error("Kalshi markets are missing from this scan session. Retry from step 2.");
  }

  const result = scanProjectionsForEdges({
    projections: session.projections,
    markets: session.markets,
    prizepicksFromCache: session.prizepicksFromCache,
  });

  result.summary = {
    ...result.summary,
    totalProjectionCount: session.totalRawProjections,
    scannedProjectionCount: session.projections.length,
  };

  return result;
}

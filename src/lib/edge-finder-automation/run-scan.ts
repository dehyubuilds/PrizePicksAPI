import {
  runEdgeFinderAnalyzePhase,
  runEdgeFinderKalshiPhase,
  runEdgeFinderPrizepicksPhase,
} from "@/lib/edge-finder/scan-phases";
import { polymarketIntegrationEnabled } from "@/lib/polymarket/config";
import { enrichScanResultWithPolymarket } from "@/lib/edge-finder/polymarket-enrich";
import type { EdgeScanResult } from "@/lib/edge-finder/types";
import {
  canonicalLiveLinesByBoardSlot,
  filterPicksOnLivePrizePicksBoard,
} from "./prizepicks-live";
import { filterPostableEdgePicks } from "./select-postable-pick";

export async function runEdgeFinderFullScan(params: {
  userId: string;
  forceLivePrizePicks?: boolean;
}): Promise<{ sessionId: string; result: EdgeScanResult }> {
  const phase1 = await runEdgeFinderPrizepicksPhase({
    userId: params.userId,
    forceLivePrizePicks: params.forceLivePrizePicks,
  });
  await runEdgeFinderKalshiPhase({
    userId: params.userId,
    sessionId: phase1.sessionId,
  });
  let result = await runEdgeFinderAnalyzePhase({
    userId: params.userId,
    sessionId: phase1.sessionId,
  });

  if (polymarketIntegrationEnabled()) {
    result = await enrichScanResultWithPolymarket(result);
  }

  let edgePicks = result.picks;
  if (params.forceLivePrizePicks) {
    const canonicalBySlot = canonicalLiveLinesByBoardSlot(phase1.scannedProjections);
    edgePicks = filterPicksOnLivePrizePicksBoard(result.picks, canonicalBySlot);
  }

  return {
    sessionId: phase1.sessionId,
    result: {
      ...result,
      picks: edgePicks,
      summary: {
        ...result.summary,
        postableEdgeCount: filterPostableEdgePicks(edgePicks).length,
      },
    },
  };
}

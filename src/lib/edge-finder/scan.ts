import { filterEdgeScanResult } from "./categorize";
import {
  runEdgeFinderAnalyzePhase,
  runEdgeFinderKalshiPhase,
  runEdgeFinderPrizepicksPhase,
} from "./scan-phases";
import type { EdgeScanFilters, EdgeScanResult } from "./types";

export { fetchKalshiMarketsForEdgeScan } from "./kalshi-markets";
export { selectProjectionsForEdgeScan, MAX_EDGE_SCAN_PROJECTIONS } from "./select-projections";
export {
  runEdgeFinderAnalyzePhase,
  runEdgeFinderKalshiPhase,
  runEdgeFinderPrizepicksPhase,
} from "./scan-phases";

/** Run all three phases sequentially (used by legacy single-route callers). */
export async function runEdgeFinderScan(
  filters: EdgeScanFilters | undefined,
  userId: string
): Promise<EdgeScanResult> {
  const phase1 = await runEdgeFinderPrizepicksPhase({ userId });
  await runEdgeFinderKalshiPhase({ userId, sessionId: phase1.sessionId });
  const result = await runEdgeFinderAnalyzePhase({ userId, sessionId: phase1.sessionId });
  if (!filters) return result;
  return filterEdgeScanResult(result, filters);
}

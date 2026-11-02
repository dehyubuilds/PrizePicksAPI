import type { KalshiMarketSummary } from "@/lib/kalshi/types";
import type { PolymarketMarketSummary } from "@/lib/polymarket/types";
import type { PrizePicksProjection } from "@/lib/prizepicks/types";

export type EdgePickSide = "over" | "under";
export type EdgePickCategory = "free" | "premium" | "demon" | "avoid";
export type EdgeConfidenceLabel = "low" | "medium" | "high";
export type EdgeVenueSource = "kalshi" | "polymarket";

export type EdgeKalshiMatch = {
  ticker: string;
  marketTitle: string;
  pickedSide: "yes" | "no";
  matchScore: number;
  market: KalshiMarketSummary;
};

export type EdgePolymarketMatch = {
  conditionId: string;
  marketTitle: string;
  pickedSide: "yes" | "no";
  matchScore: number;
  market: PolymarketMarketSummary;
};

export type EdgeScanPick = {
  id: string;
  prizepicksProjectionId: string;
  playerName: string;
  sport: string;
  team: string;
  opponent: string;
  statDisplayName: string;
  statType: string;
  lineScore: number;
  side: EdgePickSide;
  oddsType: string;
  startTime: string;
  pickLine: string;
  prizepicksImpliedProb: number;
  kalshiImpliedProb: number | null;
  polymarketImpliedProb?: number | null;
  polymarketEdgePercent?: number | null;
  adjustedProb: number | null;
  edgePercent: number | null;
  confidenceScore: number;
  confidenceLabel: EdgeConfidenceLabel;
  category: EdgePickCategory;
  primaryVenue?: EdgeVenueSource;
  reasoning: string;
  kalshi: EdgeKalshiMatch | null;
  polymarket?: EdgePolymarketMatch | null;
  projection: PrizePicksProjection;
};

export type EdgeScanSummary = {
  scannedAt: string;
  projectionCount: number;
  kalshiMarketCount: number;
  polymarketMarketCount?: number;
  matchedCount: number;
  prizepicksFromCache: boolean;
  sports: string[];
  postableDemonCount?: number;
  postableEdgeCount?: number;
  /** Raw PrizePicks rows before dedupe/cap. */
  totalProjectionCount?: number;
  /** Props actually analyzed in this scan. */
  scannedProjectionCount?: number;
};

export type EdgeScanResult = {
  summary: EdgeScanSummary;
  picks: EdgeScanPick[];
  freePick: EdgeScanPick | null;
  premiumPicks: EdgeScanPick[];
  demonWatchlist: EdgeScanPick[];
  avoidList: EdgeScanPick[];
};

export type EdgeScanFilters = {
  sport?: string;
  category?: EdgePickCategory | "all";
  minEdgePercent?: number;
  minConfidence?: EdgeConfidenceLabel | "all";
  startAfter?: string;
  startBefore?: string;
};

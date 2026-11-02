import type { EdgeScanPick, EdgeScanResult } from "@/lib/edge-finder/types";

export type EdgePriority = "now" | "watch" | "pass";

export type EdgeOpportunity = {
  rank: number;
  priority: EdgePriority;
  pick: EdgeScanPick;
  explanation: string;
  xSignal?: string;
  grokConfidence?: number;
  sources: {
    prizepicks: true;
    kalshi: boolean;
    polymarket: boolean;
    grok: boolean;
  };
};

export type PrizePicksEdgeReport = {
  generatedAt: string;
  model?: string;
  summary?: string;
  boardCount: number;
  scannedCount: number;
  kalshiMarketCount: number;
  polymarketMarketCount: number;
  shortlistCount: number;
  intelCount?: number;
  rejectedCount?: number;
  incompleteCount?: number;
  incompleteEvents?: string[];
  opportunities: EdgeOpportunity[];
  scan: EdgeScanResult;
  delta?: PickDelta;
  nextBotRunAt?: string;
};

export type PickChange = {
  kind: "promoted" | "new_take" | "dropped" | "line_moved";
  pickLine: string;
  detail: string;
};

export type PickDelta = {
  previousAt?: string;
  firstRun: boolean;
  promoted: PickChange[];
  newTakes: PickChange[];
  dropped: PickChange[];
  lineMoved: PickChange[];
  stillWaiting: number;
};

export type PrizePicksEdgeCliOptions = {
  count?: number;
  json?: boolean;
  noPublish?: boolean;
  noGrok?: boolean;
  noIntel?: boolean;
  slateOnly?: boolean;
  sports?: string[];
  maxEvents?: number;
};

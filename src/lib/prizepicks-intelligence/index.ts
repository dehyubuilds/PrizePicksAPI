export { normalizeMarket, normalizeSlate, isResearchHorizonProjection } from "./ingest";
export { resolveSportFamily, causalVariablesForFamily, displaySport } from "./sport-context";
export { clusterEvents, eventKeyForMarket, isComboOrPeriodMarket, isResearchableCluster, matchesSportFilter } from "./cluster";
export { processPackets } from "./gates";
export { researchEvents } from "./grok-research";
export { classifyMarketAwareness } from "./awareness";
export { parseSource, credibilityForSourceType, normalizeSourceType } from "./validate";
export { reconcileSignals, signalDedupeKey, promoteWatchlist } from "./reconcile";
export { renderIntelligenceMarkdown, formatTerminalSummary } from "./report-md";
export { runPrizePicksIntelligence } from "./run";
export { INTEL_DIR } from "./persist";
export type {
  NormalizedMarket,
  IntelligenceSignal,
  RunReport,
  EventCluster,
  GrokEventPacket,
  WatchItem,
  RejectedThesis,
  IncompleteResearch,
} from "./types";

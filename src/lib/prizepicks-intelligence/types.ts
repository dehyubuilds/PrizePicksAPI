import type { PrizePicksProjection } from "@/lib/prizepicks/types";

export type SportFamily =
  | "basketball"
  | "football"
  | "baseball"
  | "hockey"
  | "soccer"
  | "tennis"
  | "golf"
  | "combat"
  | "unknown";

export type SourceType =
  | "OFFICIAL"
  | "LEAGUE_REPORT"
  | "INJURY_REPORT"
  | "COACH_QUOTE"
  | "PLAYER_QUOTE"
  | "BEAT_REPORTER"
  | "LOCAL_REPORTER"
  | "PRACTICE_REPORT"
  | "PREGAME_REPORT"
  | "LINEUP"
  | "WEATHER"
  | "ANALYTICS"
  | "ANONYMOUS"
  | "FAN"
  | "PICKS_ACCOUNT"
  | "UNVERIFIED";

export type Credibility = "HIGH" | "MEDIUM" | "LOW";
export type EvidenceConfidence = "HIGH" | "MEDIUM" | "LOW";
export type MarketAwareness =
  | "BROADLY_KNOWN"
  | "POSSIBLY_UNDER_REFLECTED"
  | "NEWLY_EMERGED"
  | "SPECULATIVE";
export type Direction = "UP" | "DOWN" | "MIXED" | "UNCLEAR";
export type SignalType =
  | "ROLE_CHANGE"
  | "LINEUP"
  | "INJURY"
  | "USAGE"
  | "MATCHUP"
  | "ENVIRONMENT"
  | "WORKLOAD"
  | "TACTICAL";
export type Verdict =
  | "UNDER_REFLECTED_CHANGE"
  | "POSSIBLY_UNDER_REFLECTED"
  | "LIKELY_ALREADY_REFLECTED";

export type IntelligenceSource = {
  author: string;
  outlet: string;
  url: string;
  publishedAt: string;
  sourceType: SourceType;
  credibility: Credibility;
};

export type MarketRaw = {
  oddsType: string;
  gameId: string;
  status: string;
  leagueId: string;
  boardTime?: string;
  updatedAt?: string;
  variants?: PrizePicksProjection[];
};

export type NormalizedMarket = {
  id: string;
  sport: string;
  league: string;
  event: string;
  player: string;
  team: string;
  opponent: string;
  statType: string;
  projection: number;
  startTime: string;
  source: "PrizePicks";
  sportFamily: SportFamily;
  raw: MarketRaw;
};

export type EventCluster = {
  eventKey: string;
  sport: string;
  sportFamily: SportFamily;
  event: string;
  team: string;
  opponent: string;
  startTime: string;
  causalVariables: string[];
  markets: NormalizedMarket[];
};

export type GrokChange = {
  eventKey: string;
  player?: string;
  statType?: string;
  signalType?: string;
  whatChanged: string;
  whyNow: string;
  whyItMatters?: string;
  direction?: string;
  causalChain?: string[];
  developing?: boolean;
  missingConfirmation?: string;
  expectedNextSource?: string;
  expectedResolutionTime?: string;
  bullCase?: string;
  bearCase?: string;
  alreadyPricedArgument?: string;
  missingEvidence?: string;
  invalidationCondition?: string;
  invalidationAlreadyApplies?: boolean;
  rejected?: boolean;
  rejectReason?: string;
  sources?: IntelligenceSource[];
};

export type GrokEventPacket = {
  eventKey: string;
  changes?: GrokChange[];
  watch?: GrokChange[];
  rejected?: GrokChange[];
};

export type IntelligenceSignal = {
  signalId: string;
  marketId: string;
  sport: string;
  event: string;
  player: string;
  team: string;
  opponent: string;
  statType: string;
  projection: number;
  direction: Direction;
  signalType: SignalType;
  whyNow: string;
  causalChain: string[];
  evidenceConfidence: EvidenceConfidence;
  marketAwareness: MarketAwareness;
  freshnessMinutes: number;
  whatChanged: string;
  whyItMatters: string;
  bullCase: string;
  bearCase: string;
  alreadyPricedArgument: string;
  missingEvidence: string;
  invalidationCondition: string;
  verdict: Verdict;
  sources: IntelligenceSource[];
  firstSeenAt: string;
  lastSeenAt: string;
  isNew: boolean;
  previousSignalId?: string;
  signalEvolution?: string;
};

export type WatchItem = {
  player: string;
  sport: string;
  market: string;
  developingSignal: string;
  missingConfirmation: string;
  expectedNextSource: string;
  expectedResolutionTime: string;
};

export type RejectedThesis = {
  player: string;
  market: string;
  initialHypothesis: string;
  whyRejected: string;
  evidenceReviewed: string;
};

export type IncompleteResearch = {
  event: string;
  eventKey: string;
  reason: string;
};

export type SignalOutcome = {
  signalId: string;
  projection: number;
  actual?: number | null;
  resolvedAt?: string;
  outcome: "PENDING" | "HIT" | "MISS" | "PUSH";
};

export type ActiveStore = {
  updatedAt: string;
  signals: IntelligenceSignal[];
};

export type RunReport = {
  runId: string;
  runDate: string;
  generatedAt: string;
  marketsAnalyzed: number;
  sportsAnalyzed: string[];
  eventsResearched: number;
  model?: string;
  signals: IntelligenceSignal[];
  contextSignals: IntelligenceSignal[];
  watchlist: WatchItem[];
  rejected: RejectedThesis[];
  incomplete: IncompleteResearch[];
};

export type IntelligenceCliOptions = {
  slateOnly?: boolean;
  noGrok?: boolean;
  maxEvents?: number;
  sports?: string[];
  date?: string;
  projections?: PrizePicksProjection[];
  quiet?: boolean;
  grokResearch?: (clusters: EventCluster[]) => Promise<{
    packets: GrokEventPacket[];
    rejected: RejectedThesis[];
    incomplete?: IncompleteResearch[];
    model?: string;
  }>;
};

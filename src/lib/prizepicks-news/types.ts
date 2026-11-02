import type { NewsSport } from "./scope";

export type NewsEventType =
  | "injury"
  | "absence"
  | "lineup_change"
  | "role_change"
  | "workload_limit"
  | "coach_comment"
  | "weather"
  | "other";

export type EvidenceStatus = "official" | "corroborated" | "reported" | "unverified" | "contradicted";

export type Verdict =
  | "supported_opportunity"
  | "interesting_story"
  | "market_already_adjusted"
  | "needs_verification"
  | "invalid_market_comparison"
  | "no_eligible_prop"
  | "insufficient_data"
  | "expired";

export type NewsSource = {
  url: string;
  author: string;
  publishedAt: string | null;
};

export type NewsEvent = {
  id: string;
  sport: NewsSport;
  teamIds: string[];
  playerIds: string[];
  eventType: NewsEventType;
  summary: string;
  direction: "up" | "down" | "unclear";
  evidenceStatus: EvidenceStatus;
  sources: NewsSource[];
  sourceUrls: string[];
  publishedAt: string | null;
  discoveredAt: string;
  roleChange: boolean;
};

export type IndexedProp = {
  projectionId: string;
  sport: NewsSport;
  player: string;
  playerKey: string;
  team: string;
  opponent: string;
  gameId: string;
  market: string;
  /** Odds API sport key when the PrizePicks league is one competition. Mixed boards fill this later. */
  oddsSportKey?: string;
  stat: string;
  line: number;
  oddsType: string;
  startTime: string;
};

export type SlateGame = {
  sport: NewsSport;
  gameId: string;
  team: string;
  opponent: string;
  startTime: string;
  players: string[];
};

export type Candidate = {
  eventId: string;
  sport: NewsSport;
  player: string;
  game: string;
  market: string | null;
  stat: string | null;
  line: number | null;
  projectionId: string | null;
  startTime: string | null;
  verdict: Verdict;
  marketProbability: number | null;
  pricingSide: "over" | "under" | null;
  books: number | null;
  risks: string[];
  reason: string;
  summary: string;
  sourceUrls: string[];
  publishedAt: string | null;
  evidenceStatus: EvidenceStatus;
  thresholdType?: "half_point" | "integer";
  rejectionCode?: string;
  pLessWin?: number | null;
  pPush?: number | null;
  pMoreWin?: number | null;
  pricingMethod?: string | null;
  discoveryMethod?: "NEWS" | "MARKET" | "BOTH";
  tier?: "A" | "B" | "C" | null;
  marketImpliedProbability?: number | null;
  pricingDiscrepancy?: number | null;
  estimatedEdge?: number | null;
  entryExpectedValue?: number | null;
  edgeStatus?: "UNVERIFIED_PAYOUT" | "VERIFIED" | "UNAVAILABLE";
  evidenceScore?: number | null;
  bookRange?: number | null;
};

export type NewsReport = {
  startedAt: string;
  endedAt: string;
  mode: "live" | "estimate" | "dry-run" | "check-odds";
  live: boolean;
  sportsChecked: string[];
  eligibleGames: number;
  sourcesQueried: string[];
  newsEventsDiscovered: number;
  uniqueEvents: number;
  affectedPlayers: number;
  propsMatched: number;
  oddsRequests: number;
  oddsCredits: number;
  grokCalls: number;
  grokCostUsd: number | null;
  budgetNote: string;
  funnel: ResearchFunnel;
  stories: Candidate[];
  rejected: Candidate[];
  discoveryMode?: "hybrid" | "news" | "market";
  propsScanned?: number;
  marketGroupsConsidered?: number;
  marketGroupsRequested?: number;
  shortlist?: Candidate[];
  tierA?: number;
  tierB?: number;
  tierC?: number;
  lanes?: { news: number; market: number; both: number };
};

export type ResearchFunnel = {
  eligibleGames: number;
  newsSearchesAttempted: number;
  newsSearchesCompleted: number;
  newsSearchesTimedOut: number;
  newsItemsDiscovered: number;
  newsItemsDeduplicated: number;
  newsItemsRetained: number;
  affectedPlayers: number;
  propsMatched: number;
  halfPointProps: number;
  integerProps: number;
  eligibleSportsbookRequests: number;
  cacheHits: number;
  providerRequestsAttempted: number;
  providerRequestsCompleted: number;
  providerErrors: number;
  creditsConsumed: number;
  candidatesPriced: number;
  candidatesUnpriced: number;
  storiesGenerated: number;
  supportedOpportunities: number;
};

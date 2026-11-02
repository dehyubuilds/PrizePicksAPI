export const SCHEMA_VERSION = 1;
export const MODEL_VERSION = "valorant-maps12-baseline-1";

export type ValorantMode = "sources" | "board" | "intelligence" | "history" | "model" | "backtest" | "report" | "full";

export type PropClass = "standard" | "demon" | "goblin" | "promo" | "other";

export type EvidenceStatus = "CONFIRMED" | "CORROBORATED" | "UNVERIFIED" | "CONTRADICTED" | "STALE";

export type Verdict =
  | "SUPPORTED_MODEL_DISCREPANCY"
  | "POSSIBLE_DISCREPANCY"
  | "NO_MEASURABLE_DISCREPANCY"
  | "INSUFFICIENT_DATA"
  | "ROLE_CHANGE_RISK"
  | "INVALID_MARKET_SCOPE";

export type MarketComparison = "EXACT_MARKET_COMPARISON" | "INDEPENDENT_MODEL_ONLY" | "INSUFFICIENT_DATA";

export type ValorantProp = {
  projectionId: string;
  player: string;
  playerKey: string;
  team: string;
  opponent: string;
  eventId: string;
  startTime: string;
  scope: "maps_1_2";
  statLabel: string;
  line: number;
  propClass: PropClass;
  eligible: boolean;
};

export type SourceRecord = {
  name: string;
  url: string;
  handle: string | null;
  sourceType: "official" | "statistics" | "x_account";
  specialization: string;
  verificationMethod: string;
  lastVerified: string | null;
  reliability: "verified_access" | "page_reachable" | "unverified" | "blocked";
  apiAccess: "authorized_api" | "page_only" | "unknown" | "none";
  commercialUse: "unknown";
  notes: string;
};

export type IntelItem = {
  matchId: string;
  url: string | null;
  author: string | null;
  handle: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  player: string | null;
  team: string | null;
  claim: string;
  status: EvidenceStatus;
  supportingUrls: string[];
  effect: "none" | "ROLE_CHANGE_RISK" | "MODEL_UNCERTAINTY_INCREASED";
  measuredKillDelta: null;
};

export type MapAppearance = {
  provider: string;
  providerPlayerId: string;
  playerName: string;
  team: string;
  opponent: string;
  map: string;
  seriesPosition: 1 | 2 | null;
  rounds: number;
  kills: number;
  agent: string | null;
  matchDate: string;
  format: string | null;
  patch: string | null;
  retrievedAt: string;
};

export type Projection = {
  projectionId: string;
  player: string;
  team: string;
  opponent: string;
  eventId: string;
  startTime: string;
  line: number;
  propClass: PropClass;
  modelVersion: string;
  status: "projected" | "INSUFFICIENT_HISTORICAL_DATA";
  baselineExpected: number | null;
  adjustedExpected: number | null;
  interval: { low: number; high: number; kind: string } | null;
  probabilityMore: number | null;
  probabilityLess: number | null;
  probabilityPush: number | null;
  sampleSize: number;
  calibration: "uncalibrated";
  distribution: "not_fitted";
  reason: string;
  verdict: Verdict;
  marketComparison: MarketComparison;
  identity: "high" | "ambiguous" | "unmatched";
};

export type ValorantReport = {
  schemaVersion: typeof SCHEMA_VERSION;
  generatedAt: string;
  mode: ValorantMode;
  placesWagers: false;
  publishes: false;
  props: ValorantProp[];
  sources: SourceRecord[];
  intelligence: IntelItem[];
  history: MapAppearance[];
  historyBlockers: string[];
  projections: Projection[];
  backtest: {
    status: "insufficient_history" | "evaluated";
    heldOut: number;
    modelAMae: number | null;
    modelBMae: number | null;
    baselineMae: number | null;
    brier: number | null;
    modelBImproved: boolean;
    note: string;
  };
  grokCalls: number;
  grokCostUsd: number | null;
  grokNote: string;
  limitations: string[];
};

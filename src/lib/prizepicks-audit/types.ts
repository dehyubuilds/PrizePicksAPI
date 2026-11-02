export type AuditMode = "inventory" | "sources" | "markets" | "full" | "report";

export type NameResolution = "provider" | "known_map" | "unresolved";

export type PropScope =
  | { kind: "match"; label: "full game" }
  | { kind: "map"; map: number; label: string }
  | { kind: "maps"; from: number; to: number; label: string }
  | { kind: "quarter"; quarter: number; label: string }
  | { kind: "half"; half: number; label: string }
  | { kind: "period"; period: number; label: string }
  | { kind: "inning"; label: string }
  | { kind: "series"; label: string }
  | { kind: "unknown"; label: string };

export type ValueKind = "continuous" | "integer" | "binary" | "composite" | "mixed" | "unknown";

export type SourceStatus =
  | "VERIFIED_ACCESS"
  | "DOCUMENTED_BUT_UNTESTED"
  | "REQUIRES_SUBSCRIPTION"
  | "UNAVAILABLE"
  | "UNKNOWN";

export type CoverageClass =
  | "EXACT_COMPARABLE_MARKET"
  | "ADJACENT_ALT_LINES"
  | "RELATED_MARKET_ONLY"
  | "NO_COMPARABLE_MARKET"
  | "UNKNOWN";

export type ComparisonClass =
  | "VERIFIED_MARKET_DISCREPANCY"
  | "POSSIBLE_PRICING_INEFFICIENCY"
  | "INSUFFICIENT_COMPARABLE_DATA"
  | "MARKET_ALREADY_ADJUSTED"
  | "INVALID_COMPARISON";

export type EffortClass = "LOW_EFFORT" | "MEDIUM_EFFORT" | "HIGH_EFFORT" | "BLOCKED_BY_DATA";

export type ScoreValue = number | "UNKNOWN";

export type PropFamilyRecord = {
  id: string;
  providerLabel: string;
  providerStatType: string;
  normalizedFamily: string;
  abbreviationUnexpanded: boolean;
  scope: PropScope;
  valueKind: ValueKind;
  lineCount: number;
  integerLines: number;
  halfPointLines: number;
  sampleThresholds: number[];
  standardCount: number;
  promotionalCount: number;
  dependsOnPlayingTime: boolean;
  dependsOnMatchDuration: boolean;
  dependsOnTeamOpportunities: boolean;
  scoringDefinition: null;
};

export type CategoryRecord = {
  categoryId: string;
  displayName: string;
  nameResolution: NameResolution;
  providerLeagueId: string;
  sportOrGame: string | null;
  sportAssignment: "provider" | "known_map" | "unassigned";
  activeEventCount: number;
  upcomingEventCount: number;
  activePlayerCount: number;
  activePropCount: number;
  standardPropCount: number;
  promotionalPropCount: number;
  propFamilies: PropFamilyRecord[];
  dataFreshness: string | null;
  scoringDefinitions: null;
};

export type DataSourceRecord = {
  provider: string;
  url: string | null;
  categories: string[];
  statCoverage: string;
  historicalDepth: string | null;
  updateFrequency: string | null;
  apiAvailable: "yes" | "no" | "unknown";
  access: "free" | "paid" | "unknown";
  price: string | null;
  commercialUse: "allowed" | "restricted" | "prohibited" | "unknown";
  reliability: "tested" | "untested" | "unknown";
  machineReadable: "yes" | "no" | "unknown";
  status: SourceStatus;
  tested: boolean;
  notes: string;
};

export type FamilyCoverage = {
  familyId: string;
  providerLabel: string;
  scopeLabel: string;
  coverage: CoverageClass;
  oddsSportKey: string | null;
  marketKey: string | null;
  reason: string;
};

export type CategoryCoverage = {
  categoryId: string;
  displayName: string;
  oddsSportKey: string | null;
  families: FamilyCoverage[];
};

export type InefficiencyObservation = {
  observedAt: string;
  categoryId: string;
  displayName: string;
  propFamily: string;
  scopeLabel: string;
  eventId: string;
  player: string;
  prizePicksLine: number;
  oddsType: string;
  sportsbookLine: number | null;
  sportsbookPrices: Array<{ book: string; over: number; under: number }> | null;
  bookmakerCount: number | null;
  quoteTimestamp: string | null;
  comparisonMethod: string;
  comparison: ComparisonClass;
  rejectionReason: string | null;
  discrepancyPoints: number | null;
  direction: "higher_line" | "lower_line" | "same_line" | null;
  independentEventKey: string;
};

export type DimensionScore = {
  score: ScoreValue;
  formula: string;
  observations: string;
};

export type CategoryScorecard = {
  categoryId: string;
  displayName: string;
  dimensions: {
    dataAvailability: DimensionScore;
    historicalDepth: DimensionScore;
    sourceReliability: DimensionScore;
    modelingFeasibility: DimensionScore;
    independentMarketCoverage: DimensionScore;
    discrepancyFrequency: DimensionScore;
    discrepancyPersistence: DimensionScore;
    pricingUncertainty: DimensionScore;
    operationalCost: DimensionScore;
    commercialUse: DimensionScore;
  };
  claimsRepeatableInefficiency: false | true;
};

export type OpportunityRow = {
  categoryId: string;
  displayName: string;
  effort: EffortClass;
  why: string;
  sequence: string;
};

export type AuditReport = {
  generatedAt: string;
  mode: AuditMode;
  placesWagers: false;
  publishes: false;
  boardFetchedAt: string | null;
  boardFromCache: boolean;
  leagueCatalogStatus: "loaded" | "unavailable";
  leagueCatalogError: string | null;
  categories: CategoryRecord[];
  sources: DataSourceRecord[];
  coverage: CategoryCoverage[];
  observations: InefficiencyObservation[];
  longitudinal: {
    observationDays: number;
    independentEvents: number;
    validComparisons: number;
    repeatableKeys: number;
    note: string;
  };
  scorecards: CategoryScorecard[];
  investigateRanking: string[];
  empiricalRanking: string[];
  matrix: OpportunityRow[];
  oddsCredits: number;
  oddsRequests: number;
  grokCalls: number;
  grokCostUsd: number | null;
  grokNote: string;
  limitations: string[];
};

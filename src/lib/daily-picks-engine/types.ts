import type { EdgePickSide } from "@/lib/edge-finder/types";
import type { PrizePicksProjection } from "@/lib/prizepicks/types";

export type VenueAlignmentStatus = "aligned" | "neutral" | "conflict";

export type DailyPickFeatures = {
  playerAvg: number | null;
  lineScore: number;
  avgVsLine: number | null;
  ppBiasOverRate: number;
  lineMovementSignal: number;
  timeToTipHours: number | null;
  featureCoverage: number;
  stat: string;
};

export type ScoredDailySide = {
  side: EdgePickSide;
  modelProb: number;
  modelEdgePercent: number;
  confidenceScore: number;
};

export type DailyModelPickMeta = {
  modelEdgePercent: number;
  modelProb: number;
  venueAlignment: VenueAlignmentStatus;
  venueEdgePercent: number | null;
  venueBoost: number;
  confidenceBoost: number;
  finalEdgePercent: number;
  finalConfidenceScore: number;
  features: DailyPickFeatures;
  modelVersion: string;
};

export type ModelWeights = {
  w0: number;
  w1: number;
  w2: number;
  w3: number;
  w4: number;
};

export const DEFAULT_MODEL_WEIGHTS: ModelWeights = {
  w0: 0,
  w1: 0.12,
  w2: 0.8,
  w3: 0.35,
  w4: 0.15,
};

export type BiasAggregates = {
  version: string;
  updatedAt: string;
  overHitRateByStat: Record<string, number>;
  defaultOverRate: number;
};

export const DEFAULT_BIAS_AGGREGATES: BiasAggregates = {
  version: "v1",
  updatedAt: new Date(0).toISOString(),
  overHitRateByStat: {},
  defaultOverRate: 0.5,
};

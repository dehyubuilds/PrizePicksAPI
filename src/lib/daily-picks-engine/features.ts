import {
  quantAggregatesKey,
  quantModelWeightsKey,
  readQuantJson,
} from "@/lib/quant-research/store";
import type { PrizePicksProjection } from "@/lib/prizepicks/types";
import { readStatsCache, rollingAverageFromCache } from "@/lib/sports-stats/stats-cache";
import { propStatFromProjection } from "@/lib/sports-stats/stat-mapping";
import {
  DEFAULT_BIAS_AGGREGATES,
  DEFAULT_MODEL_WEIGHTS,
  type BiasAggregates,
  type DailyPickFeatures,
  type ModelWeights,
} from "./types";
import { dailyPicksModelVersion } from "./env";

export async function loadModelWeights(): Promise<ModelWeights> {
  const fromS3 = await readQuantJson<ModelWeights>(
    quantModelWeightsKey(dailyPicksModelVersion())
  );
  return fromS3 ?? DEFAULT_MODEL_WEIGHTS;
}

export async function loadBiasAggregates(): Promise<BiasAggregates> {
  const fromS3 = await readQuantJson<BiasAggregates>(
    quantAggregatesKey(dailyPicksModelVersion())
  );
  return fromS3 ?? DEFAULT_BIAS_AGGREGATES;
}

function lineMovementSignal(projection: PrizePicksProjection): number {
  if (!projection.boardTime || !projection.updatedAt) return 0;
  const boardMs = new Date(projection.boardTime).getTime();
  const updatedMs = new Date(projection.updatedAt).getTime();
  if (!Number.isFinite(boardMs) || !Number.isFinite(updatedMs)) return 0;
  if (updatedMs <= boardMs) return 0;
  const delta = projection.lineScore;
  return Math.max(-1, Math.min(1, delta > 0 ? 0.1 : -0.1));
}

function timeToTipHours(projection: PrizePicksProjection, nowMs = Date.now()): number | null {
  const startMs = new Date(projection.startTime).getTime();
  if (!Number.isFinite(startMs)) return null;
  return Math.max(0, (startMs - nowMs) / (60 * 60 * 1000));
}

export async function buildPickFeatures(
  projection: PrizePicksProjection,
  bias: BiasAggregates
): Promise<DailyPickFeatures> {
  const stat = propStatFromProjection(projection);
  const cache = await readStatsCache({ playerName: projection.playerName, stat });
  const playerAvg = rollingAverageFromCache(cache, "l10");
  const statKey = stat === "unknown" ? projection.statDisplayName : stat;
  const ppBiasOverRate =
    bias.overHitRateByStat[statKey] ??
    bias.overHitRateByStat[projection.statDisplayName] ??
    bias.defaultOverRate;
  let avgVsLine = playerAvg !== null ? playerAvg - projection.lineScore : null;
  if (avgVsLine === null) {
    avgVsLine = (ppBiasOverRate - 0.5) * 1.5;
  }

  let featureCoverage = 0;
  if (playerAvg !== null) featureCoverage += 0.5;
  if (projection.boardTime) featureCoverage += 0.25;
  if (stat !== "unknown") featureCoverage += 0.25;

  return {
    playerAvg,
    lineScore: projection.lineScore,
    avgVsLine,
    ppBiasOverRate,
    lineMovementSignal: lineMovementSignal(projection),
    timeToTipHours: timeToTipHours(projection),
    featureCoverage,
    stat,
  };
}

export async function loadFeatureContext(): Promise<{
  weights: ModelWeights;
  bias: BiasAggregates;
}> {
  const [weights, bias] = await Promise.all([loadModelWeights(), loadBiasAggregates()]);
  return { weights, bias };
}

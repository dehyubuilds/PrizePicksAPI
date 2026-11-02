import { confidenceLabelFromScore } from "@/lib/edge-finder/implied-probability";
import type { EdgePickSide } from "@/lib/edge-finder/types";
import type { DailyPickFeatures, ModelWeights, ScoredDailySide } from "./types";

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function scoreSide(params: {
  side: EdgePickSide;
  features: DailyPickFeatures;
  weights: ModelWeights;
}): ScoredDailySide {
  const { features, weights, side } = params;
  const avgVsLine = features.avgVsLine ?? 0;
  const sideAdjustedAvg = side === "over" ? avgVsLine : -avgVsLine;
  const biasSignal = side === "over" ? features.ppBiasOverRate - 0.5 : 0.5 - features.ppBiasOverRate;
  const tipSignal =
    features.timeToTipHours !== null && features.timeToTipHours < 3 ? 0.05 : 0;

  const logit =
    weights.w0 +
    weights.w1 * sideAdjustedAvg +
    weights.w2 * biasSignal +
    weights.w3 * features.lineMovementSignal +
    weights.w4 * tipSignal;

  const modelProb = sigmoid(logit);
  const modelEdgePercent = Math.round((modelProb - 0.5) * 1000) / 10;

  const coverageBoost = Math.round(features.featureCoverage * 20);
  const edgeBoost = Math.min(25, Math.abs(modelEdgePercent) * 1.5);
  const confidenceScore = Math.round(35 + coverageBoost + edgeBoost);

  return {
    side,
    modelProb,
    modelEdgePercent,
    confidenceScore: Math.min(95, confidenceScore),
  };
}

export function pickBestSide(params: {
  features: DailyPickFeatures;
  weights: ModelWeights;
}): ScoredDailySide {
  const over = scoreSide({ side: "over", ...params });
  const under = scoreSide({ side: "under", ...params });
  if (over.modelEdgePercent === under.modelEdgePercent) {
    return over.confidenceScore >= under.confidenceScore ? over : under;
  }
  return over.modelEdgePercent > under.modelEdgePercent ? over : under;
}

export function confidenceLabelForScore(score: number): ReturnType<typeof confidenceLabelFromScore> {
  return confidenceLabelFromScore(score);
}

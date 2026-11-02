import type { EdgeScanPick } from "@/lib/edge-finder/types";
import {
  fetchLivePrizePicksBoard,
  refreshEdgePickFromLive,
  resolveExactLivePickForPick,
} from "@/lib/edge-finder-automation/prizepicks-live";
import { loadFeatureContext, buildPickFeatures } from "./features";
import { pickBestSide } from "./score-pick";
import { dailyPostableRejectionReason, isPostableDailyPick } from "./select-postable-pick";
import type { DailyModelPickMeta } from "./types";

export type DailyPickRevalidationResult = {
  pick: EdgeScanPick | null;
  meta: DailyModelPickMeta | null;
  reason?: string;
};

export async function revalidateDailyPickAtPostTime(
  pick: EdgeScanPick,
  priorMeta?: DailyModelPickMeta
): Promise<DailyPickRevalidationResult> {
  const { canonicalBySlot } = await fetchLivePrizePicksBoard();
  const live = resolveExactLivePickForPick(pick, canonicalBySlot);
  if (!live) {
    return { pick: null, meta: null, reason: "no_live_standard_pick" };
  }

  const { weights, bias } = await loadFeatureContext();
  const features = await buildPickFeatures(live, bias);
  const best = pickBestSide({ features, weights });

  const meta: DailyModelPickMeta = {
    modelEdgePercent: best.modelEdgePercent,
    modelProb: best.modelProb,
    venueAlignment: priorMeta?.venueAlignment ?? "neutral",
    venueEdgePercent: priorMeta?.venueEdgePercent ?? null,
    venueBoost: priorMeta?.venueBoost ?? 0,
    confidenceBoost: 0,
    finalEdgePercent:
      Math.round((best.modelEdgePercent + (priorMeta?.venueBoost ?? 0)) * 10) / 10,
    finalConfidenceScore: Math.min(98, best.confidenceScore),
    features,
    modelVersion: priorMeta?.modelVersion ?? "v1",
  };

  let updated = refreshEdgePickFromLive(pick, live);
  updated = {
    ...updated,
    edgePercent: meta.finalEdgePercent,
    confidenceScore: meta.finalConfidenceScore,
    confidenceLabel:
      meta.finalConfidenceScore >= 72
        ? "high"
        : meta.finalConfidenceScore >= 55
          ? "medium"
          : "low",
  };

  if (!isPostableDailyPick(updated)) {
    return {
      pick: null,
      meta: null,
      reason: dailyPostableRejectionReason(updated) ?? "post_time_revalidation_failed",
    };
  }

  return { pick: updated, meta };
}

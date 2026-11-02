import { postTextToX } from "@/lib/playlist-insights/x-text-post";
import type { EdgeFinderSlot } from "@/lib/edge-finder-automation/types";
import type { EdgeScanPick } from "@/lib/edge-finder/types";
import { logPickPrediction } from "@/lib/quant-research/prediction-logger";
import type { DailyModelPickMeta } from "./types";
import { dailyPickTweetText } from "./pick-tweet";

export async function postDailyPickToX(params: {
  userId: string;
  pick: EdgeScanPick;
  meta: DailyModelPickMeta;
  dayKey: string;
  slot: EdgeFinderSlot;
}): Promise<{ tweetUrl: string } | { error: string }> {
  const text = dailyPickTweetText(params.pick, {
    venueAlignment: params.meta.venueAlignment,
    venueEdgePercent: params.meta.venueEdgePercent,
  });
  const result = await postTextToX({ userId: params.userId, text });
  if ("error" in result) {
    return { error: result.error };
  }

  await logPickPrediction({
    pickId: params.pick.id,
    postedAt: new Date().toISOString(),
    dayKey: params.dayKey,
    slot: params.slot,
    modelVersion: params.meta.modelVersion,
    pick: params.pick,
    features: params.meta.features,
    venueAlignment: params.meta.venueAlignment,
    modelEdgePercent: params.meta.modelEdgePercent,
    finalConfidenceScore: params.meta.finalConfidenceScore,
    tweetUrl: result.tweetUrl,
  });

  return { tweetUrl: result.tweetUrl };
}

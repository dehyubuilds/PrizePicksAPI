import type { EdgeFinderSlot } from "@/lib/edge-finder-automation/types";
import type { EdgeScanPick } from "@/lib/edge-finder/types";
import type { DailyPickFeatures } from "@/lib/daily-picks-engine/types";
import {
  quantPredictionKey,
  writeQuantJson,
} from "./store";

export type PickPredictionRecord = {
  pickId: string;
  postedAt: string;
  dayKey: string;
  slot: EdgeFinderSlot;
  modelVersion: string;
  pick: EdgeScanPick;
  features: DailyPickFeatures;
  venueAlignment: "aligned" | "neutral" | "conflict";
  modelEdgePercent: number;
  finalConfidenceScore: number;
  tweetUrl?: string;
};

export async function logPickPrediction(record: PickPredictionRecord): Promise<void> {
  await writeQuantJson(quantPredictionKey(record.pickId), record);
  console.log(
    JSON.stringify({
      audit: "quant_prediction_logged",
      pickId: record.pickId,
      dayKey: record.dayKey,
      slot: record.slot,
      modelVersion: record.modelVersion,
      playerName: record.pick.playerName,
      side: record.pick.side,
      modelEdgePercent: record.modelEdgePercent,
      venueAlignment: record.venueAlignment,
      at: record.postedAt,
    })
  );
}

import type { EdgeScanPick } from "@/lib/edge-finder/types";
import { dailyPicksMinConfidence, dailyPicksMinEdge } from "./env";

export const DAILY_MIN_EDGE = dailyPicksMinEdge();
export const DAILY_MAX_EDGE = 20;

export function isPostableDailyPick(pick: EdgeScanPick): boolean {
  if (pick.oddsType.trim().toLowerCase() !== "standard") return false;
  const edge = pick.edgePercent ?? 0;
  if (edge < DAILY_MIN_EDGE) return false;
  if (edge > DAILY_MAX_EDGE) return false;
  const minConf = dailyPicksMinConfidence();
  if (minConf === "high" && pick.confidenceLabel !== "high") return false;
  if (pick.confidenceLabel === "low") return false;
  return true;
}

export function filterPostableDailyPicks(picks: EdgeScanPick[]): EdgeScanPick[] {
  return picks.filter(isPostableDailyPick);
}

export function dailyPostableRejectionReason(pick: EdgeScanPick): string | null {
  if (pick.oddsType.trim().toLowerCase() !== "standard") return "non_standard_odds";
  const edge = pick.edgePercent ?? 0;
  if (edge < DAILY_MIN_EDGE) return "model_edge_below_minimum";
  if (edge > DAILY_MAX_EDGE) return "model_edge_suspiciously_high";
  if (pick.confidenceLabel === "low") return "low_confidence";
  if (dailyPicksMinConfidence() === "high" && pick.confidenceLabel !== "high") {
    return "confidence_below_high";
  }
  return null;
}

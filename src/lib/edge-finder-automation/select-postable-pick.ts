import { isSuspiciousEdgePick, bestVenueMatchScore } from "@/lib/edge-finder/match-quality";
import type { EdgeScanPick } from "@/lib/edge-finder/types";

export const AUTOMATION_MIN_MATCH_SCORE = 65;
export const AUTOMATION_MIN_EDGE_STANDARD = 3;
export const AUTOMATION_MAX_EDGE = 20;

export function isStandardOddsType(oddsType: string): boolean {
  return oddsType.trim().toLowerCase() === "standard";
}

export function isPostableEdgePick(pick: EdgeScanPick): boolean {
  if (!isStandardOddsType(pick.oddsType)) return false;
  if (pick.confidenceLabel === "low") return false;

  const edge = pick.edgePercent ?? 0;
  if (edge < AUTOMATION_MIN_EDGE_STANDARD) return false;
  if (edge > AUTOMATION_MAX_EDGE) return false;
  if (isSuspiciousEdgePick(pick)) return false;

  const kalshiOk = pick.kalshi && pick.kalshi.matchScore >= AUTOMATION_MIN_MATCH_SCORE;
  const polymarketOk = pick.polymarket && pick.polymarket.matchScore >= AUTOMATION_MIN_MATCH_SCORE;
  if (!kalshiOk && !polymarketOk) return false;

  return bestVenueMatchScore(pick) >= AUTOMATION_MIN_MATCH_SCORE;
}

export function filterPostableEdgePicks(picks: EdgeScanPick[]): EdgeScanPick[] {
  return picks.filter(isPostableEdgePick);
}

export function sortPostableEdgePicks(picks: EdgeScanPick[]): EdgeScanPick[] {
  return [...picks].sort((a, b) => {
    const edgeDiff = (b.edgePercent ?? -999) - (a.edgePercent ?? -999);
    if (edgeDiff !== 0) return edgeDiff;
    return b.confidenceScore - a.confidenceScore;
  });
}

export function postableRejectionReason(pick: EdgeScanPick): string | null {
  if (!isStandardOddsType(pick.oddsType)) return "non_standard_odds";
  if (pick.confidenceLabel === "low") return "low_confidence";
  const edge = pick.edgePercent ?? 0;
  if (edge < AUTOMATION_MIN_EDGE_STANDARD) return "edge_below_minimum";
  if (edge > AUTOMATION_MAX_EDGE) return "edge_suspiciously_high";
  if (isSuspiciousEdgePick(pick)) return "suspicious_edge";
  if (bestVenueMatchScore(pick) < AUTOMATION_MIN_MATCH_SCORE) return "weak_venue_match";
  return null;
}

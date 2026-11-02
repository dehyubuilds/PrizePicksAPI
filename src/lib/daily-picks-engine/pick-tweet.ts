import { prizePicksBoardUrlForPick } from "@/lib/prizepicks/board-url";
import type { EdgeScanPick } from "@/lib/edge-finder/types";
import type { VenueAlignmentStatus } from "./types";

export function dailyPickTweetText(
  pick: EdgeScanPick,
  params?: { venueAlignment?: VenueAlignmentStatus; venueEdgePercent?: number | null }
): string {
  const side = pick.side === "over" ? "Over" : "Under";
  const edge = pick.edgePercent ?? 0;
  const confidence =
    pick.confidenceLabel === "high"
      ? "High"
      : pick.confidenceLabel === "medium"
        ? "Med"
        : "Low";
  const deepLink = prizePicksBoardUrlForPick({
    prizepicksProjectionId: pick.prizepicksProjectionId,
    side: pick.side,
    lineScore: pick.lineScore,
  });

  let venueNote = "";
  if (params?.venueAlignment === "aligned" && params.venueEdgePercent !== null) {
    const venue =
      pick.primaryVenue === "polymarket"
        ? "Polymarket"
        : "Kalshi";
    venueNote = ` · ${venue} confirms +${Math.round(params.venueEdgePercent ?? 0)}%`;
  }

  return (
    `Daily model play (live now): ${pick.playerName} ${side} ${pick.lineScore} ${pick.statDisplayName}. ` +
    `Model edge +${edge}% · Confidence ${confidence}${venueNote}. ${deepLink} ` +
    `Entertainment only, not gambling advice.`
  );
}

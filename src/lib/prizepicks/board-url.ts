import type { EdgePickSide } from "@/lib/edge-finder/types";

export const PRIZEPICKS_APP_BASE_URL = "https://app.prizepicks.com";

/** PrizePicks board URLs encode decimals as "p" (e.g. 0.5 → 0p5, 27.5 → 27p5). */
export function formatPrizePicksLineForBoardUrl(lineScore: number): string {
  const normalized = Number.isInteger(lineScore) ? String(lineScore) : String(lineScore);
  return normalized.replace(".", "p");
}

const LEAGUE_ID_BY_SPORT: Record<string, string> = {
  MLB: "2",
  WNBA: "3",
  MLS: "6",
  NBA: "7",
  NHL: "8",
  NFL: "9",
  CFB: "15",
  CBB: "20",
};

export function prizePicksBoardUrlForProjection(params: {
  projectionId: string;
  side: EdgePickSide;
  lineScore: number;
  leagueId?: string;
  sport?: string;
}): string | null {
  const projectionId = params.projectionId.trim();
  if (!projectionId) return null;

  const leagueId =
    params.leagueId?.trim() ||
    LEAGUE_ID_BY_SPORT[(params.sport ?? "").trim().toUpperCase()] ||
    "";
  const query = new URLSearchParams();
  if (leagueId) query.set("league_id", leagueId);
  query.set("projId", projectionId);
  return `${PRIZEPICKS_APP_BASE_URL}/board?${query.toString()}`;
}

export function prizePicksBoardUrlForPick(params: {
  prizepicksProjectionId: string;
  side: EdgePickSide;
  lineScore: number;
  leagueId?: string;
  sport?: string;
}): string {
  return (
    prizePicksBoardUrlForProjection({
      projectionId: params.prizepicksProjectionId,
      side: params.side,
      lineScore: params.lineScore,
      leagueId: params.leagueId,
      sport: params.sport,
    }) ?? `${PRIZEPICKS_APP_BASE_URL}/`
  );
}

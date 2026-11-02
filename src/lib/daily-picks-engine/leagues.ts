import type { PrizePicksProjection } from "@/lib/prizepicks/types";

/** Leagues the Daily Picks Engine scans and posts. */
export const DAILY_PICKS_LEAGUES = ["NBA", "WNBA", "MLB"] as const;
export type DailyPicksLeague = (typeof DAILY_PICKS_LEAGUES)[number];

export function normalizeLeagueName(name: string): string {
  return name.trim().toUpperCase();
}

export function isDailyPicksLeague(name: string): name is DailyPicksLeague {
  return (DAILY_PICKS_LEAGUES as readonly string[]).includes(normalizeLeagueName(name));
}

export function isSupportedProjection(projection: PrizePicksProjection): boolean {
  return isDailyPicksLeague(projection.leagueName);
}

/** @deprecated Use isSupportedProjection */
export function isNbaProjection(projection: PrizePicksProjection): boolean {
  return normalizeLeagueName(projection.leagueName) === "NBA";
}

export function leagueForProjection(projection: PrizePicksProjection): DailyPicksLeague | null {
  const league = normalizeLeagueName(projection.leagueName);
  return isDailyPicksLeague(league) ? league : null;
}

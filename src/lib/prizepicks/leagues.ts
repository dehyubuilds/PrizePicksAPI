/** PrizePicks league_id → display name (subset used for Kalshi sport matching). */
export const PRIZEPICKS_LEAGUE_NAMES: Record<string, string> = {
  "2": "MLB",
  "3": "WNBA",
  "7": "NBA",
  "8": "NHL",
  "9": "NFL",
  "6": "MLS",
  "15": "CFB",
  "20": "CBB",
};

export function leagueNameForId(leagueId: string): string {
  return PRIZEPICKS_LEAGUE_NAMES[leagueId] ?? `League ${leagueId}`;
}

const BASEBALL_STAT =
  /\b(strikeouts?|hits?|rbis?|runs?|walks?|home runs?|pitching outs?|total bases|singles?|doubles?|stolen bases?)\b/i;
const FOOTBALL_STAT =
  /\b(rush(?:ing)? yards?|rec(?:eiving)? yards?|pass(?:ing)? yards?|receptions?|touchdowns?)\b/i;
const HOCKEY_STAT = /\b(shots on goal|sog|goals?|assists?|saves?)\b/i;
const SOCCER_STAT = /\b(shots?|passes?|goals?|tackles?|saves?|crosses?|clearances?)\b/i;

/** Guess league_id when bulk /projections omits it (MLB/NFL/NHL/MLS only — not NBA vs WNBA). */
export function inferLeagueIdForProjection(projection: {
  leagueId?: string;
  statDisplayName?: string;
  statType?: string;
}): string {
  if (projection.leagueId?.trim()) return projection.leagueId.trim();
  const stat = `${projection.statDisplayName ?? ""} ${projection.statType ?? ""}`;
  if (BASEBALL_STAT.test(stat)) return "2";
  if (FOOTBALL_STAT.test(stat)) return "9";
  if (HOCKEY_STAT.test(stat)) return "8";
  if (SOCCER_STAT.test(stat)) return "6";
  return "";
}

export function projectionNeedsLeagueId(projection: { leagueId?: string }): boolean {
  return !projection.leagueId?.trim();
}

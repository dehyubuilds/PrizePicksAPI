import type { PrizePicksProjection } from "@/lib/prizepicks/types";

const SOCCER_STAT = /\b(shots?|passes?|goals?|tackles?|saves?|crosses?|clearances?)\b/i;
const BASKETBALL_STAT = /\b(points?|rebounds?|assists?|threes?|3.?pt|steals?|blocks?|pts|rebs?|asts?)\b/i;
const BASEBALL_STAT = /\b(strikeouts?|hits?|rbis?|runs?|walks?|home runs?|pitching outs?)\b/i;
const FOOTBALL_STAT = /\b(rush(?:ing)? yards?|rec(?:eiving)? yards?|pass(?:ing)? yards?|receptions?|touchdowns?)\b/i;
const HOCKEY_STAT = /\b(shots on goal|sog|goals?|assists?|saves?)\b/i;

function statHaystack(projection: PrizePicksProjection): string {
  return `${projection.statDisplayName} ${projection.statType}`;
}

function isUnknownLeagueName(leagueName: string): boolean {
  const value = leagueName.trim();
  return !value || /^league(\s|$)/i.test(value);
}

/** Infer Kalshi sport tags when PrizePicks bulk fetch omits league_id. */
export function inferSportTagsForProjection(projection: PrizePicksProjection): string[] {
  const league = projection.leagueName.trim();
  if (!isUnknownLeagueName(league)) {
    return [league];
  }

  const stat = statHaystack(projection);
  if (SOCCER_STAT.test(stat)) return ["World Cup", "MLS"];
  if (BASKETBALL_STAT.test(stat)) return ["NBA", "WNBA"];
  if (BASEBALL_STAT.test(stat)) return ["MLB"];
  if (FOOTBALL_STAT.test(stat)) return ["NFL"];
  if (HOCKEY_STAT.test(stat)) return ["NHL"];

  return ["World Cup", "NBA", "MLB", "NHL", "NFL", "WNBA", "MLS"];
}

export function inferSportTagsFromProjections(projections: PrizePicksProjection[]): string[] {
  const tags = new Set<string>();
  for (const projection of projections) {
    for (const tag of inferSportTagsForProjection(projection)) {
      tags.add(tag);
    }
  }
  return Array.from(tags).sort();
}

export function projectionSportTags(projection: PrizePicksProjection): string[] {
  return inferSportTagsForProjection(projection);
}

import { causalVariablesForFamily, isUnknownLeagueName } from "./sport-context";
import type { EventCluster, NormalizedMarket } from "./types";

export const PRIORITY_SPORTS = ["NFL", "MLB", "WNBA", "NBA", "NHL", "CFB", "CBB", "MLS"] as const;

const PERIOD_OR_COMBO =
  /\b(1Q|2Q|3Q|4Q|1st Half|2nd Half|1st Inn(?:ing)?|2nd Inn(?:ing)?|3rd Inn(?:ing)?|MAPS?\s*\d)\b/i;
const SLASHED_TEAMS = /[A-Za-z]{2,4}\s*\/\s*[A-Za-z]{2,4}/;

/** True parlay board (ARI/SF vs SF/ARI), not a normal "NYY / BOS" matchup label. */
function isComboMatchup(market: NormalizedMarket): boolean {
  return SLASHED_TEAMS.test(market.team.trim()) && SLASHED_TEAMS.test(market.opponent.trim());
}

export function isComboOrPeriodMarket(market: NormalizedMarket): boolean {
  const hay = `${market.event} ${market.team} ${market.opponent} ${market.statType} ${market.raw.gameId}`;
  if (/CMBO_combo|combo_/i.test(market.raw.gameId)) return true;
  if (PERIOD_OR_COMBO.test(hay)) return true;
  if (isComboMatchup(market)) return true;
  return false;
}

export function isResearchableCluster(cluster: EventCluster): boolean {
  if (!cluster.markets.length) return false;
  if (cluster.markets.every(isComboOrPeriodMarket)) return false;
  if (PRIORITY_SPORTS.includes(cluster.sport as (typeof PRIORITY_SPORTS)[number])) return true;
  if (isUnknownLeagueName(cluster.sport) && cluster.sportFamily === "unknown") return false;
  return ["football", "baseball", "basketball", "hockey", "soccer"].includes(cluster.sportFamily);
}

export function eventKeyForMarket(market: NormalizedMarket): string {
  const gameId = market.raw.gameId.trim();
  if (gameId && !/CMBO_combo|combo_/i.test(gameId)) return gameId;
  return `${market.sport}:${market.event}:${market.startTime}`;
}

function preferredSport(rows: NormalizedMarket[]): NormalizedMarket {
  const priority = rows.find((row) =>
    PRIORITY_SPORTS.includes(row.sport as (typeof PRIORITY_SPORTS)[number])
  );
  return priority ?? rows[0]!;
}

function sportRank(sport: string): number {
  const idx = (PRIORITY_SPORTS as readonly string[]).indexOf(sport);
  return idx === -1 ? 100 : idx;
}

export function matchesSportFilter(cluster: EventCluster, sports?: string[]): boolean {
  if (!sports?.length) return true;
  const wanted = new Set(sports.map((sport) => sport.trim().toUpperCase()).filter(Boolean));
  if (wanted.has("ALL")) return true;
  const sport = cluster.sport.trim().toUpperCase();
  if (wanted.has(sport)) return true;
  if (wanted.has("MLB") && (sport === "BASEBALL" || cluster.sportFamily === "baseball")) return true;
  if (wanted.has("WNBA") && sport === "WNBA") return true;
  return false;
}

export function clusterEvents(
  markets: NormalizedMarket[],
  maxEvents = 18,
  sports?: string[]
): EventCluster[] {
  const groups = new Map<string, NormalizedMarket[]>();
  for (const market of markets) {
    if (isComboOrPeriodMarket(market)) continue;
    const key = eventKeyForMarket(market);
    const list = groups.get(key) ?? [];
    list.push(market);
    groups.set(key, list);
  }

  const clusters: EventCluster[] = Array.from(groups.entries()).map(([eventKey, rows]) => {
    const first = preferredSport(rows);
    return {
      eventKey,
      sport: first.sport,
      sportFamily: first.sportFamily,
      event: first.event,
      team: first.team,
      opponent: first.opponent,
      startTime: first.startTime,
      causalVariables: causalVariablesForFamily(first.sportFamily),
      markets: rows,
    };
  });

  const researchable = clusters
    .filter(isResearchableCluster)
    .filter((cluster) => matchesSportFilter(cluster, sports));

  researchable.sort((a, b) => {
    const sportDiff = sportRank(a.sport) - sportRank(b.sport);
    if (sportDiff !== 0) return sportDiff;
    const aTime = new Date(a.startTime).getTime();
    const bTime = new Date(b.startTime).getTime();
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
    return a.event.localeCompare(b.event);
  });

  const perSport = 4;
  const taken = new Set<string>();
  const balanced: EventCluster[] = [];
  const sportCounts = new Map<string, number>();

  for (const cluster of researchable) {
    const count = sportCounts.get(cluster.sport) ?? 0;
    if (count >= perSport) continue;
    taken.add(cluster.eventKey);
    sportCounts.set(cluster.sport, count + 1);
    balanced.push(cluster);
    if (balanced.length >= maxEvents) return balanced;
  }
  for (const cluster of researchable) {
    if (taken.has(cluster.eventKey)) continue;
    balanced.push(cluster);
    if (balanced.length >= maxEvents) break;
  }
  return balanced;
}

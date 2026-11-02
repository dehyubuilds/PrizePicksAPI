import {
  boardGroupKey,
  isPlayablePrizePicksProjection,
} from "@/lib/edge-finder-automation/prizepicks-live";
import { bestVenueMatchScore } from "@/lib/edge-finder/match-quality";
import type { EdgeScanPick, EdgeScanResult } from "@/lib/edge-finder/types";
import { PRIZEPICKS_LEAGUE_NAMES } from "@/lib/prizepicks/leagues";
import type { PrizePicksProjection } from "@/lib/prizepicks/types";
import { displaySport, resolveSportFamily } from "@/lib/prizepicks-intelligence/sport-context";
import type { EdgePriority } from "./types";

export const MORNING_LEAGUES = new Set([
  "MLB",
  "NFL",
  "NBA",
  "WNBA",
  "NHL",
  "CFB",
  "CBB",
  "MLS",
]);

const MAX_GROUPS = 180;
const MAX_GROK_CANDIDATES = 36;
const HORIZON_MS = 48 * 60 * 60 * 1000;

function oddsRank(oddsType: string): number {
  const value = oddsType.trim().toLowerCase();
  if (value === "standard") return 0;
  if (value === "demon") return 1;
  if (value === "goblin") return 2;
  return 3;
}

function isMajorLeague(projection: PrizePicksProjection): boolean {
  if (MORNING_LEAGUES.has(projection.leagueName)) return true;
  const named = PRIZEPICKS_LEAGUE_NAMES[projection.leagueId];
  return Boolean(named && MORNING_LEAGUES.has(named));
}

export function filterProjectionsBySports(
  projections: PrizePicksProjection[],
  sports?: string[]
): PrizePicksProjection[] {
  if (!sports?.length) return projections;
  const wanted = new Set(sports.map((sport) => sport.trim().toUpperCase()).filter(Boolean));
  if (wanted.has("ALL")) return projections;
  return projections.filter((projection) => {
    const family = resolveSportFamily({
      leagueName: projection.leagueName,
      leagueId: projection.leagueId,
      statType: projection.statType,
      statDisplayName: projection.statDisplayName,
    });
    const sport = displaySport({
      leagueName: projection.leagueName,
      leagueId: projection.leagueId,
      family,
    }).toUpperCase();
    if (wanted.has(sport)) return true;
    if (wanted.has("MLB") && (sport === "MLB" || family === "baseball")) return true;
    if (wanted.has("WNBA") && sport === "WNBA") return true;
    return false;
  });
}

function pickOnePerOddsType(rows: PrizePicksProjection[]): PrizePicksProjection[] {
  const byType = new Map<string, PrizePicksProjection>();
  for (const row of rows) {
    const key = row.oddsType.trim().toLowerCase() || "standard";
    const existing = byType.get(key);
    if (!existing || row.lineScore < existing.lineScore) byType.set(key, row);
  }
  return Array.from(byType.values()).sort((a, b) => oddsRank(a.oddsType) - oddsRank(b.oddsType));
}

/** Playable major-league board: one standard/demon/goblin per player-stat slot. */
export function selectMorningBoard(
  projections: PrizePicksProjection[],
  nowMs = Date.now()
): { selected: PrizePicksProjection[]; playableCount: number; majorCount: number } {
  const playable = projections.filter((row) => isPlayablePrizePicksProjection(row, nowMs));
  const horizon = playable.filter((row) => {
    const start = new Date(row.startTime).getTime();
    return Number.isFinite(start) && start <= nowMs + HORIZON_MS;
  });
  const pool = horizon.length ? horizon : playable.length ? playable : projections.filter((row) => row.status !== "inactive");
  const major = pool.filter(isMajorLeague);
  const use = major.length ? major : pool;

  const groups = new Map<string, PrizePicksProjection[]>();
  for (const row of use) {
    const key = boardGroupKey(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const ordered = Array.from(groups.values()).sort((a, b) => {
    const aTime = new Date(a[0]?.startTime ?? "").getTime();
    const bTime = new Date(b[0]?.startTime ?? "").getTime();
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
    return (a[0]?.playerName ?? "").localeCompare(b[0]?.playerName ?? "");
  });

  const perLeague = 36;
  const taken = new Set<string>();
  const pickedGroups: PrizePicksProjection[][] = [];
  const leagueCounts = new Map<string, number>();

  for (const group of ordered) {
    const league = group[0]?.leagueName || "other";
    const count = leagueCounts.get(league) ?? 0;
    if (count >= perLeague) continue;
    const key = boardGroupKey(group[0]!);
    if (taken.has(key)) continue;
    taken.add(key);
    leagueCounts.set(league, count + 1);
    pickedGroups.push(group);
    if (pickedGroups.length >= MAX_GROUPS) break;
  }

  if (pickedGroups.length < MAX_GROUPS) {
    for (const group of ordered) {
      const key = boardGroupKey(group[0]!);
      if (taken.has(key)) continue;
      taken.add(key);
      pickedGroups.push(group);
      if (pickedGroups.length >= MAX_GROUPS) break;
    }
  }

  const selected: PrizePicksProjection[] = [];
  for (const group of pickedGroups) {
    selected.push(...pickOnePerOddsType(group));
  }

  return {
    selected,
    playableCount: playable.length,
    majorCount: major.length,
  };
}

export function mechanicalPriority(pick: EdgeScanPick): EdgePriority {
  const edge = pick.edgePercent ?? Number.NEGATIVE_INFINITY;
  const match = bestVenueMatchScore(pick);
  if (edge >= 6 && match >= 65) return "now";
  if (edge >= 2 && match >= 50) return "watch";
  if (edge >= 4) return "watch";
  return "pass";
}

function candidateScore(pick: EdgeScanPick): number {
  const edge = pick.edgePercent ?? -20;
  const match = bestVenueMatchScore(pick);
  const demonBonus = pick.oddsType.trim().toLowerCase() === "demon" && edge >= 4 ? 3 : 0;
  return edge + match / 20 + demonBonus;
}

export function shortlistOpportunities(
  result: EdgeScanResult,
  max = MAX_GROK_CANDIDATES
): EdgeScanPick[] {
  const seen = new Set<string>();
  const pool: EdgeScanPick[] = [];
  const source = [
    result.freePick,
    ...result.premiumPicks,
    ...result.demonWatchlist,
    ...result.picks,
  ];
  for (const pick of source) {
    if (!pick || seen.has(pick.id)) continue;
    seen.add(pick.id);
    const edge = pick.edgePercent ?? Number.NEGATIVE_INFINITY;
    const match = bestVenueMatchScore(pick);
    const demon = pick.oddsType.trim().toLowerCase() === "demon";
    if (pick.category === "avoid" && !(demon && edge >= 4 && match >= 60)) continue;
    if (edge < 1.5 && match < 55) continue;
    if (edge < 0 && !(demon && edge >= -0.5 && match >= 70)) continue;
    pool.push(pick);
  }

  return pool.sort((a, b) => candidateScore(b) - candidateScore(a)).slice(0, max);
}

/** When Kalshi/Poly matching is thin, still give Grok a diverse playable slate. */
export function researchFallbackSlate(result: EdgeScanResult, max = MAX_GROK_CANDIDATES): EdgeScanPick[] {
  const primary = shortlistOpportunities(result, max);
  if (primary.length >= 8) return primary;

  const seenPlayer = new Set<string>();
  const extra: EdgeScanPick[] = [];
  const ranked = [...result.picks].sort((a, b) => {
    const aDemon = a.oddsType.trim().toLowerCase() === "demon" ? 0 : 1;
    const bDemon = b.oddsType.trim().toLowerCase() === "demon" ? 0 : 1;
    if (aDemon !== bDemon) return aDemon - bDemon;
    const aTime = new Date(a.startTime).getTime();
    const bTime = new Date(b.startTime).getTime();
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
    return (b.edgePercent ?? -20) - (a.edgePercent ?? -20);
  });

  for (const pick of ranked) {
    const player = pick.playerName.trim().toLowerCase();
    if (!player || seenPlayer.has(player)) continue;
    if (primary.some((row) => row.id === pick.id)) continue;
    seenPlayer.add(player);
    extra.push(pick);
    if (primary.length + extra.length >= max) break;
  }

  return [...primary, ...extra].slice(0, max);
}

import type { PrizePicksProjection } from "@/lib/prizepicks/types";
import { displaySport, resolveSportFamily } from "./sport-context";
import type { NormalizedMarket } from "./types";

const RESEARCH_LOOKBACK_MS = 6 * 60 * 60 * 1000;
const RESEARCH_HORIZON_MS = 48 * 60 * 60 * 1000;

/** Games for research — includes in-play and tip-off-soon rows the posting bot would lock out. */
export function isResearchHorizonProjection(
  projection: PrizePicksProjection,
  nowMs = Date.now()
): boolean {
  const status = projection.status.trim().toLowerCase();
  if (status === "inactive") return false;
  const startMs = new Date(projection.startTime).getTime();
  if (!Number.isFinite(startMs)) return status === "pre_game" || status === "in_play";
  return startMs > nowMs - RESEARCH_LOOKBACK_MS && startMs <= nowMs + RESEARCH_HORIZON_MS;
}

function boardSlotKey(projection: PrizePicksProjection): string {
  return [
    projection.playerName.trim().toLowerCase(),
    projection.statType.trim().toLowerCase() || projection.statDisplayName.trim().toLowerCase(),
    projection.gameId.trim().toLowerCase(),
  ].join("|");
}

function eventLabel(projection: PrizePicksProjection): string {
  const team = projection.team.trim();
  const opponent = projection.opponent.trim();
  if (team && opponent) return `${team} vs ${opponent}`;
  return opponent || team || "Unknown event";
}

export function normalizeMarket(projection: PrizePicksProjection): NormalizedMarket {
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
  });
  return {
    id: projection.id,
    sport,
    league: sport,
    event: eventLabel(projection),
    player: projection.playerName.trim(),
    team: projection.team.trim(),
    opponent: projection.opponent.trim(),
    statType: (projection.statDisplayName || projection.statType).trim(),
    projection: projection.lineScore,
    startTime: projection.startTime,
    source: "PrizePicks",
    sportFamily: family,
    raw: {
      oddsType: projection.oddsType,
      gameId: projection.gameId,
      status: projection.status,
      leagueId: projection.leagueId,
      boardTime: projection.boardTime,
      updatedAt: projection.updatedAt,
    },
  };
}

/** Full slate → unique player/stat/game markets, preferring the standard line. */
export function normalizeSlate(
  projections: PrizePicksProjection[],
  nowMs = Date.now()
): NormalizedMarket[] {
  const horizon = projections.filter((row) => isResearchHorizonProjection(row, nowMs));
  const pool = horizon.length ? horizon : projections.filter((row) => row.status !== "inactive");
  const groups = new Map<string, PrizePicksProjection[]>();
  for (const row of pool) {
    const key = boardSlotKey(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const markets: NormalizedMarket[] = [];
  for (const rows of Array.from(groups.values())) {
    const standard = rows.find((row) => row.oddsType.trim().toLowerCase() === "standard") ?? rows[0];
    if (!standard) continue;
    const market = normalizeMarket(standard);
    const variants = rows.filter((row) => row.id !== standard.id);
    if (variants.length) market.raw.variants = variants;
    markets.push(market);
  }
  return markets.sort((a, b) => {
    const aTime = new Date(a.startTime).getTime();
    const bTime = new Date(b.startTime).getTime();
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
    return a.player.localeCompare(b.player);
  });
}

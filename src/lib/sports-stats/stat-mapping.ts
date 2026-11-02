import type { PrizePicksProjection } from "@/lib/prizepicks/types";
import type { PlayerBoxStats, PlayerGameStats, PropStatType } from "./types";

export function propStatFromProjection(projection: Pick<
  PrizePicksProjection,
  "statDisplayName" | "statType"
>): PropStatType {
  const hay = `${projection.statDisplayName} ${projection.statType}`.toLowerCase();

  if (/point/.test(hay) && /rebound/.test(hay) && /assist/.test(hay)) return "pra";
  if (/\bpra\b/.test(hay) || /pts\s*\+\s*reb\s*\+\s*ast/.test(hay)) return "pra";
  if (/fantasy/.test(hay)) return "unknown";

  if (/strikeout|\bk'?s\b|\bso\b/.test(hay)) return "strikeouts";
  if (/total bases|\btb\b/.test(hay)) return "total_bases";
  if (/home run|\bhr\b/.test(hay)) return "home_runs";
  if (/stolen base|\bsb\b/.test(hay)) return "stolen_bases";
  if (/\brbi/.test(hay)) return "rbi";
  if (/\bwalk|\bbb\b/.test(hay)) return "walks";
  if (/pitching out|\bout\b/.test(hay) && /pitch/.test(hay)) return "pitching_outs";
  if (/\bruns?\b/.test(hay) && !/home run/.test(hay)) return "runs";
  if (/\bhits?\b/.test(hay) && !/strikeout/.test(hay)) return "hits";

  if (/rebound|\brebs?\b/.test(hay)) return "rebounds";
  if (/assist|\basts?\b/.test(hay)) return "assists";
  if (/steal|\bstl/.test(hay)) return "steals";
  if (/block|\bblk/.test(hay)) return "blocks";
  if (/3.?pt|three|3pm/.test(hay)) return "threes";
  if (/point|\bpts\b/.test(hay)) return "points";

  return "unknown";
}

export function playerGameStatsFromNbaBox(stats: PlayerBoxStats): PlayerGameStats {
  return {
    didPlay: stats.didPlay,
    values: {
      points: stats.points,
      rebounds: stats.rebounds,
      assists: stats.assists,
      steals: stats.steals,
      blocks: stats.blocks,
      threes: stats.threes,
      pra: stats.points + stats.rebounds + stats.assists,
    },
  };
}

export function statValueFromGameStats(
  stats: PlayerGameStats,
  stat: PropStatType
): number | null {
  const value = stats.values[stat];
  return value === undefined ? null : value;
}

/** @deprecated Use statValueFromGameStats */
export function statValueFromBox(stats: PlayerBoxStats, stat: PropStatType): number | null {
  return statValueFromGameStats(playerGameStatsFromNbaBox(stats), stat);
}

export function normalizePlayerName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function playerNamesMatch(a: string, b: string): boolean {
  const na = normalizePlayerName(a);
  const nb = normalizePlayerName(b);
  if (na === nb) return true;
  const aTokens = na.split(" ").filter(Boolean);
  const bTokens = nb.split(" ").filter(Boolean);
  if (!aTokens.length || !bTokens.length) return false;
  return aTokens[aTokens.length - 1] === bTokens[bTokens.length - 1];
}

export function teamTokenMatches(haystack: string, token: string): boolean {
  const hay = haystack.trim().toUpperCase();
  const value = token.trim().toUpperCase();
  if (!hay || !value) return false;
  if (hay.includes(value)) return true;
  const lastWord = value.split(/\s+/).pop() ?? value;
  return hay.includes(lastWord);
}

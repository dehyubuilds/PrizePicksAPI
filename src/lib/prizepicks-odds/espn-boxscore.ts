import { normalizePlayerName } from "./markets";

export type BoxLine = {
  player: string;
  team: string;
  stats: Record<string, number>;
};

export type ParsedBox = {
  completed: boolean;
  players: BoxLine[];
};

const BASKETBALL = new Set(["NBA", "WNBA", "NCAAB"]);
const FOOTBALL = new Set(["NFL", "NCAAF"]);

const MARKET_STAT: Record<string, string> = {
  player_points: "PTS",
  player_rebounds: "REB",
  player_assists: "AST",
  player_steals: "STL",
  player_blocks: "BLK",
  player_threes: "3PT",
  player_pass_yds: "passing.YDS",
  player_pass_tds: "passing.TD",
  player_rush_yds: "rushing.YDS",
  player_receptions: "receiving.REC",
  player_reception_yds: "receiving.YDS",
};

export function espnPath(sport: string): string | null {
  const paths: Record<string, string> = {
    NFL: "football/nfl",
    NCAAF: "football/college-football",
    NBA: "basketball/nba",
    WNBA: "basketball/wnba",
    MLB: "baseball/mlb",
    NHL: "hockey/nhl",
    NCAAB: "basketball/mens-college-basketball",
  };
  return paths[sport] ?? null;
}

export function canSettleMarket(sport: string, market: string): boolean {
  if (!MARKET_STAT[market]) return false;
  if (BASKETBALL.has(sport) && !market.startsWith("player_pass") && !market.startsWith("player_rush") && !market.startsWith("player_reception")) {
    return ["player_points", "player_rebounds", "player_assists", "player_steals", "player_blocks", "player_threes"].includes(market);
  }
  if (FOOTBALL.has(sport)) {
    return market.startsWith("player_pass") || market.startsWith("player_rush") || market.startsWith("player_reception");
  }
  return false;
}

export function gradeStat(side: "over" | "under", line: number, actual: number): "win" | "loss" | "push" {
  if (actual === line) return "push";
  if (side === "over") return actual > line ? "win" : "loss";
  return actual < line ? "win" : "loss";
}

export function playerStat(box: ParsedBox, playerName: string, market: string): number | null {
  const key = MARKET_STAT[market];
  if (!key) return null;
  const want = normalizePlayerName(playerName);
  const hits = box.players.filter((row) => normalizePlayerName(row.player) === want);
  if (hits.length !== 1) return null;
  const value = hits[0]?.stats[key];
  return value == null ? null : value;
}

export function parseSummary(json: unknown, sport: string): ParsedBox | null {
  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, unknown>;
  const completed = readCompleted(root);
  if (BASKETBALL.has(sport)) return { completed, players: basketballPlayers(root) };
  if (FOOTBALL.has(sport)) return { completed, players: footballPlayers(root) };
  return { completed, players: [] };
}

export function parseScoreboardGames(json: unknown): Array<{ id: string; name: string; completed: boolean }> {
  if (!json || typeof json !== "object") return [];
  const events = (json as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];
  const games: Array<{ id: string; name: string; completed: boolean }> = [];
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const row = event as Record<string, unknown>;
    const comp = (row.competitions as Array<Record<string, unknown>> | undefined)?.[0];
    const competitors = (comp?.competitors as Array<Record<string, unknown>> | undefined) ?? [];
    const names = competitors
      .map((competitor) => {
        const team = competitor.team as Record<string, unknown> | undefined;
        return [team?.displayName, team?.shortDisplayName, team?.abbreviation, team?.name].filter(Boolean).join(" ");
      })
      .join(" ");
    const id = String(row.id ?? "");
    if (!id || !names) continue;
    const status = (comp?.status as Record<string, unknown> | undefined)?.type as Record<string, unknown> | undefined;
    games.push({
      id,
      name: `${names} ${String(row.name ?? "")}`,
      completed: Boolean(status?.completed),
    });
  }
  return games;
}

export function matchCompletedGame(
  team: string,
  opponent: string,
  games: Array<{ id: string; name: string; completed: boolean }>
): { id: string; name: string; completed: boolean } | null {
  const tokens = `${team} ${opponent}`
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
  let best: { id: string; name: string; completed: boolean } | null = null;
  let bestHits = 0;
  for (const game of games) {
    const hay = game.name.toUpperCase();
    const hits = tokens.filter((token) => hay.includes(token)).length;
    if (hits >= 2 && hits > bestHits) {
      best = game;
      bestHits = hits;
    }
  }
  return best;
}

function readCompleted(root: Record<string, unknown>): boolean {
  const competitions = ((root.header as Record<string, unknown> | undefined)?.competitions ?? []) as Array<Record<string, unknown>>;
  const status = (competitions[0]?.status as Record<string, unknown> | undefined)?.type as Record<string, unknown> | undefined;
  return Boolean(status?.completed);
}

function basketballPlayers(root: Record<string, unknown>): BoxLine[] {
  return teamBlocks(root).flatMap((block) => {
    const stats = (block.statistics as Array<Record<string, unknown>> | undefined)?.[0];
    if (!stats) return [];
    const names = (stats.names as unknown[]) ?? (stats.labels as unknown[]) ?? [];
    return athletes(stats).map((athlete) => ({
      player: athlete.name,
      team: block.team,
      stats: zipStats(names.map(String), athlete.stats),
    }));
  });
}

function footballPlayers(root: Record<string, unknown>): BoxLine[] {
  return teamBlocks(root).flatMap((block) => {
    const groups = (block.statistics as Array<Record<string, unknown>> | undefined) ?? [];
    const merged = new Map<string, BoxLine>();
    for (const group of groups) {
      const groupName = String(group.name ?? group.type ?? "").toLowerCase();
      const names = ((group.keys as unknown[]) ?? (group.names as unknown[]) ?? []).map(String);
      for (const athlete of athletes(group)) {
        const current = merged.get(athlete.name) ?? { player: athlete.name, team: block.team, stats: {} };
        const zipped = zipStats(names, athlete.stats);
        for (const [key, value] of Object.entries(zipped)) {
          current.stats[`${groupName}.${key}`] = value;
        }
        merged.set(athlete.name, current);
      }
    }
    return [...merged.values()];
  });
}

function teamBlocks(root: Record<string, unknown>): Array<{ team: string; statistics: unknown }> {
  const players = (root.boxscore as { players?: unknown } | undefined)?.players;
  if (!Array.isArray(players)) return [];
  return players
    .map((block) => {
      if (!block || typeof block !== "object") return null;
      const row = block as Record<string, unknown>;
      const team = row.team as Record<string, unknown> | undefined;
      const name = String(team?.displayName ?? team?.abbreviation ?? "");
      if (!name) return null;
      return { team: name, statistics: row.statistics };
    })
    .filter((row): row is { team: string; statistics: unknown } => Boolean(row));
}

function athletes(group: Record<string, unknown>): Array<{ name: string; stats: string[] }> {
  const rows = group.athletes;
  if (!Array.isArray(rows)) return [];
  const out: Array<{ name: string; stats: string[] }> = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const athlete = (row as { athlete?: { displayName?: string } }).athlete;
    const name = athlete?.displayName?.trim() ?? "";
    const stats = (row as { stats?: unknown }).stats;
    if (!name || !Array.isArray(stats)) continue;
    out.push({ name, stats: stats.map(String) });
  }
  return out;
}

function zipStats(names: string[], values: string[]): Record<string, number> {
  const stats: Record<string, number> = {};
  names.forEach((name, index) => {
    const raw = values[index] ?? "";
    if (name === "3PT" && raw.includes("-")) {
      const made = Number(raw.split("-")[0]);
      if (Number.isFinite(made)) stats[name] = made;
      return;
    }
    const value = Number(raw);
    if (Number.isFinite(value)) stats[name] = value;
  });
  return stats;
}

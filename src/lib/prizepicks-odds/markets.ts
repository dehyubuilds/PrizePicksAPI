/** PrizePicks league → The Odds API sport, and which prop markets we will pay credits for. */

export const DEFAULT_ODDS_SPORTS = ["ALL"] as const;

export const ODDS_SPORT_KEYS: Record<string, string> = {
  NFL: "americanfootball_nfl",
  NBA: "basketball_nba",
  WNBA: "basketball_wnba",
  MLB: "baseball_mlb",
  NHL: "icehockey_nhl",
  CFB: "americanfootball_ncaaf",
  CBB: "basketball_ncaab",
};

const BASKETBALL: Array<{ market: string; test: RegExp }> = [
  { market: "player_points_rebounds_assists", test: /\bpra\b|pts?.{0,8}rebs?.{0,8}asts?|points?.{0,16}rebounds?.{0,16}assists/i },
  { market: "player_points_rebounds", test: /points?.{0,12}rebounds/i },
  { market: "player_points_assists", test: /points?.{0,12}assists/i },
  { market: "player_rebounds_assists", test: /rebounds?.{0,12}assists/i },
  { market: "player_threes", test: /3-?pointers?|threes|three pointers/i },
  { market: "player_blocks", test: /\bblocks?\b/i },
  { market: "player_steals", test: /\bsteals?\b/i },
  { market: "player_rebounds", test: /\brebounds?\b/i },
  { market: "player_assists", test: /\bassists?\b/i },
  { market: "player_points", test: /\bpoints?\b/i },
];

const BASEBALL: Array<{ market: string; test: RegExp }> = [
  { market: "batter_hits_runs_rbis", test: /hits?.{0,12}runs?.{0,12}rbis|h\s*\+\s*r\s*\+\s*rbi/i },
  { market: "batter_total_bases", test: /total bases/i },
  { market: "batter_home_runs", test: /home runs?/i },
  { market: "pitcher_strikeouts", test: /strikeouts?/i },
  { market: "pitcher_earned_runs", test: /earned runs?/i },
  { market: "pitcher_hits_allowed", test: /hits allowed/i },
  { market: "pitcher_outs", test: /pitching outs|outs recorded/i },
  { market: "pitcher_walks", test: /\bwalks?\b/i },
  { market: "batter_rbis", test: /\brbis?\b/i },
  { market: "batter_hits", test: /\bhits?\b/i },
];

const FOOTBALL: Array<{ market: string; test: RegExp }> = [
  { market: "player_rush_reception_yds", test: /rush.{0,12}rec/i },
  { market: "player_pass_yds", test: /pass(?:ing)? yards/i },
  { market: "player_pass_tds", test: /pass(?:ing)? (?:touchdowns|tds)/i },
  { market: "player_pass_completions", test: /completions/i },
  { market: "player_pass_interceptions", test: /interceptions/i },
  { market: "player_reception_yds", test: /receiv(?:ing)? yards|rec yards/i },
  { market: "player_receptions", test: /receptions/i },
  { market: "player_rush_yds", test: /rush(?:ing)? yards/i },
];

const HOCKEY: Array<{ market: string; test: RegExp }> = [
  { market: "player_shots_on_goal", test: /shots on goal|\bsog\b/i },
  { market: "player_assists", test: /\bassists?\b/i },
  { market: "player_points", test: /\bpoints?\b/i },
];

const RULES: Record<string, Array<{ market: string; test: RegExp }>> = {
  NBA: BASKETBALL,
  WNBA: BASKETBALL,
  CBB: BASKETBALL,
  MLB: BASEBALL,
  NFL: FOOTBALL,
  CFB: FOOTBALL,
  NHL: HOCKEY,
};

const SKIP = /\bcombo\b|\b1q\b|\b2q\b|\b3q\b|\b4q\b|quarter|half|halves|inning|\d+\+|w\//i;

/**
 * Alternate market keys from The Odds API betting-markets list.
 * https://the-odds-api.com/sports-odds-data/betting-markets.html
 * WNBA uses the same `_alternate` player keys; the WNBA sport page documents that pattern.
 * NCAAF and NCAAB alternate keys are not in that list, so those sports are omitted.
 */
const ALTERNATE_BY_SPORT: Record<string, Record<string, string>> = {
  NBA: basketballAlternates(),
  WNBA: basketballAlternates(),
  NFL: {
    player_pass_yds: "player_pass_yds_alternate",
    player_pass_tds: "player_pass_tds_alternate",
    player_pass_completions: "player_pass_completions_alternate",
    player_pass_interceptions: "player_pass_interceptions_alternate",
    player_reception_yds: "player_reception_yds_alternate",
    player_receptions: "player_receptions_alternate",
    player_rush_yds: "player_rush_yds_alternate",
    player_rush_reception_yds: "player_rush_reception_yds_alternate",
  },
  MLB: {
    batter_total_bases: "batter_total_bases_alternate",
    batter_home_runs: "batter_home_runs_alternate",
    batter_hits: "batter_hits_alternate",
    batter_rbis: "batter_rbis_alternate",
    batter_hits_runs_rbis: "batter_hits_runs_rbis_alternate",
    pitcher_hits_allowed: "pitcher_hits_allowed_alternate",
    pitcher_walks: "pitcher_walks_alternate",
    pitcher_earned_runs: "pitcher_earned_runs_alternate",
    pitcher_strikeouts: "pitcher_strikeouts_alternate",
    pitcher_outs: "pitcher_outs_alternate",
  },
  NHL: {
    player_points: "player_points_alternate",
    player_assists: "player_assists_alternate",
    player_shots_on_goal: "player_shots_on_goal_alternate",
  },
};

function basketballAlternates(): Record<string, string> {
  return {
    player_points: "player_points_alternate",
    player_rebounds: "player_rebounds_alternate",
    player_assists: "player_assists_alternate",
    player_blocks: "player_blocks_alternate",
    player_steals: "player_steals_alternate",
    player_threes: "player_threes_alternate",
    player_points_assists: "player_points_assists_alternate",
    player_points_rebounds: "player_points_rebounds_alternate",
    player_rebounds_assists: "player_rebounds_assists_alternate",
    player_points_rebounds_assists: "player_points_rebounds_assists_alternate",
  };
}

/** Documented alternate market for this primary key, or null when the provider list does not include one. */
export function alternateMarket(league: string, market: string): string | null {
  return ALTERNATE_BY_SPORT[league.trim().toUpperCase()]?.[market] ?? null;
}

/** Map an alternate response key back to the primary market we match on. */
export function primaryMarketKey(market: string): string {
  return market.endsWith("_alternate") ? market.slice(0, -"_alternate".length) : market;
}

export function sportKeyForLeague(league: string): string | null {
  return ODDS_SPORT_KEYS[league.trim().toUpperCase()] ?? null;
}

/** Every supported sport unless the caller passes leagues. `all` scans every supported sport. */
export function resolveOddsSports(input?: string[]): string[] {
  const raw = (input?.length ? input : [...DEFAULT_ODDS_SPORTS])
    .map((sport) => sport.trim().toUpperCase())
    .filter(Boolean);
  if (raw.includes("ALL")) return Object.keys(ODDS_SPORT_KEYS);
  const unknown = raw.filter((sport) => !ODDS_SPORT_KEYS[sport]);
  if (unknown.length) {
    throw new Error(
      `Unknown sports: ${unknown.join(", ")}. Use ${Object.keys(ODDS_SPORT_KEYS).join(", ")}, or all.`
    );
  }
  return [...new Set(raw)];
}

export function marketForStat(league: string, statDisplayName: string, statType: string): string | null {
  const sport = league.trim().toUpperCase();
  const rules = RULES[sport];
  if (!rules) return null;
  const hay = `${statDisplayName} ${statType}`;
  if (SKIP.test(hay)) return null;
  for (const rule of rules) {
    if (rule.test.test(hay)) return rule.market;
  }
  return null;
}

export function normalizePlayerName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Credits for one event-odds call: markets returned × regions. Events list is 1 per sport. */
export function estimatePropCredits(events: number, marketsPerEvent: number, regions = 1): number {
  return Math.max(0, events) * Math.max(0, marketsPerEvent) * Math.max(1, regions);
}

/** Optional stop. An unset budget does not cap the run. */
export function exceedsCreditBudget(spent: number, nextCost: number, maxCredits?: number): boolean {
  if (maxCredits == null || !Number.isFinite(maxCredits)) return false;
  return spent + nextCost > maxCredits;
}

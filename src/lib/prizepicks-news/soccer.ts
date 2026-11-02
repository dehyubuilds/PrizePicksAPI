import { parseEvents, type OddsEvent, type OddsResponse } from "@/lib/prizepicks-odds/client";
import { eventMatchesTeams } from "@/lib/prizepicks-odds/teams";
import type { IndexedProp } from "./types";

/** Competitions that show up on the PrizePicks soccer boards. Event lists are 1 credit each. */
export const SOCCER_SPORT_KEYS = [
  "soccer_epl",
  "soccer_spain_la_liga",
  "soccer_italy_serie_a",
  "soccer_france_ligue_one",
  "soccer_germany_bundesliga",
  "soccer_germany_dfb_pokal",
  "soccer_mexico_ligamx",
  "soccer_brazil_campeonato",
  "soccer_argentina_primera_division",
  "soccer_usa_mls",
  "soccer_saudi_arabia_pro_league",
  "soccer_germany_bundesliga2",
] as const;

const LEAGUE_ODDS_KEY: Record<string, string> = {
  "14": "soccer_epl",
  EPL: "soccer_epl",
  "531": "soccer_spain_la_liga",
  LALIGA: "soccer_spain_la_liga",
};

/** PrizePicks names that are not a substring of the Odds API club name. */
const ALIASES: Record<string, string> = {
  "man city": "Manchester City",
  "atletico mg": "Atletico Mineiro",
  "ca mineiro": "Atletico Mineiro",
  pumas: "Universidad Nacional",
  "club universidad nacional": "Universidad Nacional",
  "real racing club": "Racing Santander",
  "los angeles galaxy": "Galaxy",
};

function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function soccerOddsKeyForLeague(leagueId: string, leagueName: string): string | undefined {
  return LEAGUE_ODDS_KEY[leagueId.trim()] ?? LEAGUE_ODDS_KEY[leagueName.trim().toUpperCase()];
}

export function soccerMarketForStat(statDisplayName: string, statType: string): string | null {
  const hay = `${statDisplayName} ${statType}`;
  if (/goal\s*\+|goals?\s*\+|tackles?|fouls?|cards?|saves?|passes|crosses|clearances|\bcombo\b/i.test(hay)) return null;
  if (/shots?\s+on\s+target|\bsot\b/i.test(hay)) return "player_shots_on_target";
  if (/\bshots?\b/i.test(hay)) return "player_shots";
  if (/\bassists?\b/i.test(hay)) return "player_assists";
  return null;
}

export function soccerTeamName(name: string): string {
  return ALIASES[fold(name)] ?? name;
}

export function soccerEventMatches(params: { team: string; opponent: string; home: string; away: string }): boolean {
  return eventMatchesTeams({
    team: soccerTeamName(params.team),
    opponent: soccerTeamName(params.opponent),
    home: params.home,
    away: params.away,
  });
}

export function isComboSoccerSide(name: string): boolean {
  return name.includes("/") || name.includes("+");
}

/** One Odds API competition per game. Two matches, or none, leaves the prop unpriced. */
export function assignSoccerSportKeys(props: IndexedProp[], eventsBySport: Map<string, OddsEvent[]>): IndexedProp[] {
  const byGame = new Map<string, string | null>();
  for (const prop of props) {
    if (prop.sport !== "SOCCER" || prop.oddsSportKey) continue;
    if (byGame.has(prop.gameId)) continue;
    const hits: string[] = [];
    for (const [sportKey, events] of Array.from(eventsBySport.entries())) {
      const matched = events.some((game) =>
        soccerEventMatches({ team: prop.team, opponent: prop.opponent, home: game.home_team, away: game.away_team })
      );
      if (matched) hits.push(sportKey);
    }
    byGame.set(prop.gameId, hits.length === 1 ? hits[0]! : null);
  }
  return props.map((prop) => {
    if (prop.sport !== "SOCCER" || prop.oddsSportKey) return prop;
    const key = byGame.get(prop.gameId);
    return key ? { ...prop, oddsSportKey: key } : prop;
  });
}

/** Leave enough credits for one three-market price request after the event lists. */
const PRICE_FLOOR = 3;

export async function fetchSoccerEventLists(args: {
  fetchOdds: (pathAndQuery: string, cacheKey: string) => Promise<OddsResponse>;
  creditsUsed: number;
  maxCredits: number;
  log?: (message: string) => void;
}): Promise<{ events: Map<string, OddsEvent[]>; credits: number; requests: number; cacheHits: number; providerErrors: number }> {
  const events = new Map<string, OddsEvent[]>();
  let credits = 0;
  let requests = 0;
  let cacheHits = 0;
  let providerErrors = 0;
  for (const sportKey of SOCCER_SPORT_KEYS) {
    if (args.creditsUsed + credits + 1 + PRICE_FLOOR > args.maxCredits) break;
    try {
      const listed = await args.fetchOdds(`/sports/${sportKey}/events`, `events_${sportKey}`);
      requests += 1;
      if (listed.fromCache) cacheHits += 1;
      if (!listed.fromCache) credits += listed.lastCost ?? 1;
      events.set(sportKey, parseEvents(listed.json));
    } catch (err) {
      providerErrors += 1;
      const message = err instanceof Error ? err.message : "The sportsbook event list failed.";
      args.log?.(`odds request failed ${sportKey} ${message}`);
    }
  }
  return { events, credits, requests, cacheHits, providerErrors };
}

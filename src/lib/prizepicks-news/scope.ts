/**
 * News-first PrizePicks research.
 * Reuses the PrizePicks board, The Odds API client (cached, billed per market),
 * and xAI responses with web_search plus x_search. Grok returns text, so a URL
 * counts only when it is in that JSON. There is no full X timeline API.
 * This module does not place wagers or publish a share page.
 */

import { marketForStat } from "@/lib/prizepicks-odds/markets";
import { soccerMarketForStat } from "./soccer";

export const NEWS_SPORTS = ["MLB", "WNBA", "NFL"] as const;
/** Opt-in. A default or `all` scan does not include these. */
export const MARKET_ONLY_SPORTS = ["SOCCER"] as const;
export type NewsSport = (typeof NEWS_SPORTS)[number] | (typeof MARKET_ONLY_SPORTS)[number];

export const DEFAULT_MAX_EVENTS = 10;
export const DEFAULT_MAX_ODDS_CREDITS = 40;
/** Six planned searches, plus one narrower retry each. A timeout still counts. */
export const MAX_GROK_CALLS = 12;

const WNBA_MARKETS = [
  "player_rebounds",
  "player_rebounds_assists",
  "player_points_rebounds",
  "player_assists",
  "player_points",
  "player_threes",
  "player_steals",
  "player_blocks",
  "player_points_rebounds_assists",
  "player_points_assists",
] as const;

const NFL_MARKETS = [
  "player_receptions",
  "player_reception_yds",
  "player_rush_attempts",
  "player_rush_yds",
  "player_pass_attempts",
  "player_pass_yds",
  "player_pass_tds",
  "player_pass_completions",
  "player_rush_reception_yds",
] as const;

const NFL_EXTRA: Array<{ market: (typeof NFL_MARKETS)[number]; test: RegExp }> = [
  { market: "player_rush_attempts", test: /rush(?:ing)? attempts/i },
  { market: "player_pass_attempts", test: /pass(?:ing)? attempts/i },
];

export const SOURCE_HANDLES: Record<NewsSport, string[]> = {
  MLB: ["@MLB", "@MLB_PR", "@JeffPassan", "@Ken_Rosenthal", "@Feinsand", "@JonHeyman", "@jonmorosi", "@PitchingNinja", "@fangraphs", "@RotoWireMLB"],
  WNBA: ["@WNBA", "@WNBA_PR", "@alexaphilippou", "@howardmegdal", "@AnnieCostabile", "@RotoWire", "@herhoopstats"],
  NFL: ["@NFL", "@AdamSchefter", "@RapSheet", "@TomPelissero", "@MikeGarafolo", "@FieldYates", "@JayGlazer", "@RotoWireNFL"],
  SOCCER: [],
};

const ALLOWED_SPORTS = new Set<string>([...NEWS_SPORTS, ...MARKET_ONLY_SPORTS]);

export function resolveNewsSports(input?: string[]): NewsSport[] {
  const raw = (input?.length ? input : [...NEWS_SPORTS]).map((sport) => sport.trim().toUpperCase()).filter(Boolean);
  if (raw.includes("ALL")) return [...NEWS_SPORTS];
  const unknown = raw.filter((sport) => !ALLOWED_SPORTS.has(sport));
  if (unknown.length) {
    throw new Error(`News research only covers MLB, WNBA, and NFL. Market mode also covers SOCCER. Rejected: ${unknown.join(", ")}.`);
  }
  return Array.from(new Set(raw)) as NewsSport[];
}

const SOCCER_MARKETS = ["player_shots_on_target", "player_shots", "player_assists"] as const;

export function marketPriority(sport: NewsSport): readonly string[] {
  if (sport === "MLB") return ["pitcher_strikeouts"];
  if (sport === "WNBA") return WNBA_MARKETS;
  if (sport === "SOCCER") return SOCCER_MARKETS;
  return NFL_MARKETS;
}

/** Allowed Odds API market, or null. MLB non-strikeout markets are rejected. */
export function newsMarketForStat(sport: NewsSport, statDisplayName: string, statType: string): { market: string | null; rejectedMlb: boolean } {
  const hay = `${statDisplayName} ${statType}`;
  if (sport === "SOCCER") return { market: soccerMarketForStat(statDisplayName, statType), rejectedMlb: false };
  if (sport === "NFL") {
    const extra = NFL_EXTRA.find((rule) => rule.test.test(hay));
    if (extra) return { market: extra.market, rejectedMlb: false };
  }
  const mapped = marketForStat(sport, statDisplayName, statType);
  if (sport === "MLB") {
    if (/hitter|batter/i.test(hay)) return { market: null, rejectedMlb: true };
    if (mapped === "pitcher_strikeouts") return { market: mapped, rejectedMlb: false };
    return { market: null, rejectedMlb: mapped != null };
  }
  if (mapped && (marketPriority(sport) as readonly string[]).includes(mapped)) return { market: mapped, rejectedMlb: false };
  return { market: null, rejectedMlb: false };
}

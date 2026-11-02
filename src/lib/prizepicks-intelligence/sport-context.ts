import { PRIZEPICKS_LEAGUE_NAMES } from "@/lib/prizepicks/leagues";
import type { SportFamily } from "./types";

const CAUSAL: Record<SportFamily, string[]> = {
  basketball: [
    "minutes",
    "starting lineup",
    "usage",
    "touches",
    "potential assists",
    "rebound opportunities",
    "shot attempts",
    "pace",
    "defensive matchup",
    "coverage",
    "rotation",
    "bench role",
    "injuries",
    "teammate absences",
    "foul-risk role changes",
    "blowout exposure",
    "coach adjustments",
  ],
  football: [
    "snap share",
    "route participation",
    "targets",
    "carries",
    "red-zone usage",
    "offensive line changes",
    "quarterback changes",
    "personnel packages",
    "injuries",
    "defensive matchup",
    "weather",
    "game script",
    "depth-chart changes",
  ],
  baseball: [
    "batting order",
    "lineup status",
    "pitcher handedness",
    "pitcher repertoire",
    "platoon role",
    "park factors",
    "weather",
    "bullpen availability",
    "pitch count",
    "lineup scratches",
    "rest days",
  ],
  hockey: [
    "line combinations",
    "power-play unit",
    "ice time",
    "goalie confirmation",
    "injuries",
    "defensive matchup",
    "travel",
    "rest",
    "special teams role",
  ],
  soccer: [
    "starting XI",
    "expected minutes",
    "formation",
    "set-piece responsibility",
    "penalty responsibility",
    "tactical role",
    "injuries",
    "rotation",
    "opponent style",
    "competition priority",
  ],
  tennis: [
    "surface",
    "opponent style",
    "serve matchup",
    "return matchup",
    "injury",
    "fatigue",
    "travel",
    "recent workload",
    "tournament context",
  ],
  golf: [
    "course fit",
    "weather",
    "tee-time wave",
    "injury",
    "course setup",
    "strokes-gained profile",
    "travel/rest",
  ],
  combat: [
    "late opponent changes",
    "injury reports",
    "weight-cut issues",
    "reach/style matchup",
    "camp changes",
    "expected fight pace",
  ],
  unknown: ["role", "availability", "lineup", "matchup", "environment", "workload", "tactical_role"],
};

const KNOWN_LEAGUE_FAMILY: Record<string, SportFamily> = {
  NBA: "basketball",
  WNBA: "basketball",
  CBB: "basketball",
  NFL: "football",
  CFB: "football",
  MLB: "baseball",
  NHL: "hockey",
  MLS: "soccer",
};

const STAT_FAMILY: Array<{ family: SportFamily; pattern: RegExp }> = [
  { family: "baseball", pattern: /\b(strikeouts?|hits?|rbis?|runs?|walks?|home runs?|pitching outs?|total bases|singles?|doubles?|stolen bases?|hitter fs|pitches thrown)\b/i },
  { family: "football", pattern: /\b(rush(?:ing)? yards?|rec(?:eiving)? yards?|pass(?:ing)? yards?|receptions?|touchdowns?|sacks?|tackles?|rush\+rec)\b/i },
  { family: "hockey", pattern: /\b(shots on goal|sog|goals?|assists?|saves?|power play)\b/i },
  { family: "soccer", pattern: /\b(shots?|passes?|goals?|tackles?|saves?|crosses?|clearances?|fouls)\b/i },
  { family: "basketball", pattern: /\b(points?|rebounds?|assists?|threes?|3.?pt|steals?|blocks?|pts|rebs?|asts?|pra|pts\+rebs)\b/i },
  { family: "tennis", pattern: /\b(aces|double faults|games|sets|break points)\b/i },
  { family: "golf", pattern: /\b(birdies|fairways|greens? in regulation|strokes?|bogeys)\b/i },
  { family: "combat", pattern: /\b(takedowns?|significant strikes?|rounds?|knockdowns?)\b/i },
];

export function isUnknownLeagueName(leagueName: string): boolean {
  const value = leagueName.trim();
  return !value || /^league(\s|$)/i.test(value);
}

export function resolveSportFamily(params: {
  leagueName?: string;
  leagueId?: string;
  statType?: string;
  statDisplayName?: string;
}): SportFamily {
  const named = params.leagueName?.trim() ?? "";
  if (named && !isUnknownLeagueName(named) && KNOWN_LEAGUE_FAMILY[named]) {
    return KNOWN_LEAGUE_FAMILY[named];
  }
  const fromId = params.leagueId ? PRIZEPICKS_LEAGUE_NAMES[params.leagueId] : "";
  if (fromId && KNOWN_LEAGUE_FAMILY[fromId]) return KNOWN_LEAGUE_FAMILY[fromId];

  const hay = `${params.statDisplayName ?? ""} ${params.statType ?? ""}`;
  for (const { family, pattern } of STAT_FAMILY) {
    if (pattern.test(hay)) return family;
  }
  const lower = named.toLowerCase();
  if (/tennis|atp|wta/.test(lower)) return "tennis";
  if (/golf|pga/.test(lower)) return "golf";
  if (/ufc|mma|boxing|combat/.test(lower)) return "combat";
  return "unknown";
}

export function causalVariablesForFamily(family: SportFamily): string[] {
  return [...CAUSAL[family]];
}

export function displaySport(params: {
  leagueName?: string;
  leagueId?: string;
  family: SportFamily;
}): string {
  const named = params.leagueName?.trim() ?? "";
  if (named && !isUnknownLeagueName(named)) return named;
  const fromId = params.leagueId ? PRIZEPICKS_LEAGUE_NAMES[params.leagueId] : "";
  if (fromId) return fromId;
  if (params.family === "unknown") return named || "Unknown";
  return params.family.toUpperCase();
}

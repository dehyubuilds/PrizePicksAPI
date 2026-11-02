import type { PropScope, ValueKind } from "./types";

const MAP_RANGE = /\bmaps?\s*(\d+)\s*(?:-|–|to)\s*(\d+)\b/i;
const MAP_ONE = /\bmaps?\s*(\d+)\b/i;
const QUARTER = /\b([1-4])q\b|\b(\d+)(?:st|nd|rd|th)\s*quarter\b/i;
const HALF = /\b([12])h\b|\b(\d+)(?:st|nd|rd|th)\s*half\b/i;
const PERIOD = /\b(\d+)(?:st|nd|rd|th)\s*period\b/i;
const INNING = /\b(\d+(?:\s*-\s*\d+)?)\s*inn(?:ing(?:s)?)?\.?\b/i;

const BINARY = /\banytime\b|\bfirst goal\b|\bto score\b|\byes\/no\b|\bdouble-double\b|\btriple-double\b/i;
const COMPOSITE = /\+|combo|fantasy score|pts\s*\+\s*rebs|goal \+ assist/i;
const PLAYING_TIME = /\bminutes\b|\bsnaps?\b|\binnings pitched\b|\bpitches thrown\b/i;
const MATCH_DURATION = /\bfight time\b|\bmap duration\b|\bgame duration\b|\brounds?\b/i;
const TEAM_CHANCES = /\battempts\b|\btargets\b|\bshots\b|\bsog\b|\bsot\b/i;

/** Short provider tokens we do not expand into a different stat. */
const KNOWN_SHORT = new Set(["HR", "RBI", "RBIS", "SOG", "SOT", "PRA", "3PM", "PPG", "RPG", "APG"]);

export function parseScope(label: string): { scope: PropScope; familyLabel: string } {
  const text = label.trim();
  const range = text.match(MAP_RANGE);
  if (range) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    const phrase = range[0];
    return {
      scope: { kind: "maps", from, to, label: phrase },
      familyLabel: strip(text, phrase),
    };
  }
  const map = text.match(MAP_ONE);
  if (map) {
    const phrase = map[0];
    return {
      scope: { kind: "map", map: Number(map[1]), label: phrase },
      familyLabel: strip(text, phrase),
    };
  }
  const quarter = text.match(QUARTER);
  if (quarter) {
    const phrase = quarter[0];
    const quarterNumber = Number(quarter[1] ?? quarter[2]);
    return {
      scope: { kind: "quarter", quarter: quarterNumber, label: phrase },
      familyLabel: strip(text, phrase),
    };
  }
  const half = text.match(HALF);
  if (half) {
    const phrase = half[0];
    const halfNumber = /1h/i.test(phrase) ? 1 : /2h/i.test(phrase) ? 2 : Number(half[2]);
    return {
      scope: { kind: "half", half: halfNumber, label: phrase },
      familyLabel: strip(text, phrase),
    };
  }
  const period = text.match(PERIOD);
  if (period) {
    const phrase = period[0];
    return {
      scope: { kind: "period", period: Number(period[1]), label: phrase },
      familyLabel: strip(text, phrase),
    };
  }
  const inning = text.match(INNING);
  if (inning) {
    const phrase = inning[0];
    return { scope: { kind: "inning", label: phrase }, familyLabel: strip(text, phrase) };
  }
  if (/\bseries\b/i.test(text)) {
    return { scope: { kind: "series", label: "series" }, familyLabel: strip(text, "series") };
  }
  return { scope: { kind: "match", label: "full game" }, familyLabel: text };
}

function strip(text: string, phrase: string): string {
  const next = text.replace(phrase, " ").replace(/\s+/g, " ").trim();
  return next || text.trim();
}

export function scopesComparable(left: PropScope, right: PropScope): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "map" && right.kind === "map") return left.map === right.map;
  if (left.kind === "maps" && right.kind === "maps") return left.from === right.from && left.to === right.to;
  if (left.kind === "quarter" && right.kind === "quarter") return left.quarter === right.quarter;
  if (left.kind === "half" && right.kind === "half") return left.half === right.half;
  if (left.kind === "period" && right.kind === "period") return left.period === right.period;
  if (left.kind === "inning" && right.kind === "inning") return left.label.toLowerCase() === right.label.toLowerCase();
  if (left.kind === "unknown" || right.kind === "unknown") return false;
  return true;
}

export function abbreviationUnexpanded(family: string): boolean {
  const token = family.trim();
  if (!/^[A-Za-z]{2,4}$/.test(token)) return false;
  return !KNOWN_SHORT.has(token.toUpperCase());
}

export function classifyValueKind(labels: string[], lines: number[]): ValueKind {
  const hay = labels.join(" ");
  if (BINARY.test(hay)) return "binary";
  if (COMPOSITE.test(hay)) return "composite";
  if (!lines.length) return "unknown";
  const integers = lines.filter((line) => Number.isInteger(line)).length;
  const halves = lines.filter((line) => !Number.isInteger(line)).length;
  if (integers && halves) return "mixed";
  if (integers === lines.length) return "integer";
  if (halves === lines.length) return "continuous";
  return "unknown";
}

export function dependencyFlags(label: string): {
  dependsOnPlayingTime: boolean;
  dependsOnMatchDuration: boolean;
  dependsOnTeamOpportunities: boolean;
} {
  return {
    dependsOnPlayingTime: PLAYING_TIME.test(label),
    dependsOnMatchDuration: MATCH_DURATION.test(label),
    dependsOnTeamOpportunities: TEAM_CHANCES.test(label),
  };
}

export function familyId(scope: PropScope, family: string): string {
  return `${scope.kind}:${scope.label}:${family.trim().toLowerCase()}`;
}

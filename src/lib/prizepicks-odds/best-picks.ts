import type { EvaluatedProp } from "./evaluate";
import type { OddsSnapshot } from "./snapshots";

/** Ranking version. The order is not a probability. */
export const RANKING_VERSION = "best-picks-v1";

export const DAILY_MIN_MARKET_PROBABILITY = 55;
export const DAILY_MIN_BOOKS = 2;
export const DAILY_MAX_QUOTE_AGE_MINUTES = 360;
export const DAILY_NEAR_TIP_WINDOW_MINUTES = 90;
export const DAILY_NEAR_TIP_MAX_QUOTE_AGE_MINUTES = 30;
export const DAILY_MAX_BOOK_DISAGREEMENT = 8;
export const DAILY_MAX_PICKS = 8;
export const DAILY_MAX_PER_PLAYER = 2;

export type EvidenceQuality = "high" | "moderate" | "limited";

export type DailyThresholds = {
  minProbability: number;
  minBooks: number;
  maxQuoteAgeMinutes: number;
  maxDisagreement: number;
  maxPicks: number;
};

export type DailyPick = {
  rank: number;
  sport: string;
  eventId: string;
  eventStart: string;
  player: string;
  opponent: string;
  market: string;
  stat: string;
  side: "over" | "under";
  line: number;
  oddsType: string;
  marketProbability: number;
  pricingMethod: "direct" | "market-interpolate-v1";
  sportsbookCount: number;
  quoteAgeMinutes: number | null;
  evidenceQuality: "high" | "moderate";
  reasons: string[];
  warnings: string[];
  researchStatus: "verified" | "warnings" | "not_requested" | "unavailable";
  projectionId: string;
  league: string;
};

const MATERIAL = ["unverified_injury", "unverified_availability", "minutes_restriction", "conflicting_reports", "unverified_minutes"];

export function dailyThresholds(partial: Partial<DailyThresholds> = {}): DailyThresholds {
  return {
    minProbability: numberFromEnv("DAILY_MIN_MARKET_PROBABILITY", partial.minProbability, DAILY_MIN_MARKET_PROBABILITY),
    minBooks: numberFromEnv("DAILY_MIN_BOOKS", partial.minBooks, DAILY_MIN_BOOKS),
    maxQuoteAgeMinutes: numberFromEnv("DAILY_MAX_QUOTE_AGE_MINUTES", partial.maxQuoteAgeMinutes, DAILY_MAX_QUOTE_AGE_MINUTES),
    maxDisagreement: numberFromEnv("DAILY_MAX_BOOK_DISAGREEMENT", partial.maxDisagreement, DAILY_MAX_BOOK_DISAGREEMENT),
    maxPicks: numberFromEnv("DAILY_MAX_PICKS", partial.maxPicks, DAILY_MAX_PICKS),
  };
}

function numberFromEnv(name: string, override: number | undefined, fallback: number): number {
  if (override != null && Number.isFinite(override)) return override;
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function quoteAgeMinutes(quotedAt: string | null, generatedAt: string): number | null {
  if (!quotedAt) return null;
  const age = Date.parse(generatedAt) - Date.parse(quotedAt);
  if (!Number.isFinite(age) || age < 0) return null;
  return Math.round(age / 60000);
}

export function minutesUntilStart(startTime: string, generatedAt: string): number | null {
  const delta = Date.parse(startTime) - Date.parse(generatedAt);
  if (!Number.isFinite(delta)) return null;
  return Math.round(delta / 60000);
}

export function disagreementPoints(prop: EvaluatedProp): number | null {
  if (prop.bookRange) return Math.round((prop.bookRange.high - prop.bookRange.low) * 10) / 10;
  return prop.interpolationUncertainty;
}

/**
 * Evidence quality is not a hit probability.
 * HIGH: exact line, at least three books, disagreement at most 4 points, quote under 60 minutes, no material warning.
 * MODERATE: a priced line that clears the qualification gates, including a narrow interpolation.
 * LIMITED: fails those gates and stays off the recommended list.
 */
export function evidenceQuality(prop: EvaluatedProp, generatedAt: string, thresholds: DailyThresholds): EvidenceQuality {
  if (prop.marketProbability == null || prop.side == null || prop.rejectionReasons.length) return "limited";
  if (prop.books < thresholds.minBooks) return "limited";
  if (prop.marketProbability < thresholds.minProbability) return "limited";
  const spread = disagreementPoints(prop);
  if (spread != null && spread > thresholds.maxDisagreement) return "limited";
  const age = quoteAgeMinutes(prop.quotedAt, generatedAt);
  if (age != null && age > thresholds.maxQuoteAgeMinutes) return "limited";
  const until = minutesUntilStart(prop.startTime, generatedAt);
  if (until != null && until <= DAILY_NEAR_TIP_WINDOW_MINUTES && (age == null || age > DAILY_NEAR_TIP_MAX_QUOTE_AGE_MINUTES)) {
    return "limited";
  }
  if (until != null && until <= 0) return "limited";
  if (prop.probabilitySource === "interpolated" && (prop.interpolationUncertainty ?? 99) > 6) return "limited";
  const material = (prop.researchFlags ?? []).some((flag) => MATERIAL.includes(flag));
  const fresh = age != null && age <= 60;
  const tight = spread != null && spread <= 4;
  if (prop.probabilitySource === "direct" && prop.books >= 3 && tight && fresh && !material) return "high";
  return "moderate";
}

export function compareBestPicks(generatedAt: string, thresholds: DailyThresholds) {
  return (a: EvaluatedProp, b: EvaluatedProp): number => {
    const tier = (prop: EvaluatedProp) => (evidenceQuality(prop, generatedAt, thresholds) === "high" ? 0 : 1);
    const age = (prop: EvaluatedProp) => quoteAgeMinutes(prop.quotedAt, generatedAt) ?? 10_000;
    const spread = (prop: EvaluatedProp) => disagreementPoints(prop) ?? 100;
    return (
      tier(a) - tier(b) ||
      (b.marketProbability ?? 0) - (a.marketProbability ?? 0) ||
      b.books - a.books ||
      spread(a) - spread(b) ||
      age(a) - age(b) ||
      (a.probabilitySource === "direct" ? 0 : 1) - (b.probabilitySource === "direct" ? 0 : 1) ||
      a.playerName.localeCompare(b.playerName) ||
      a.line - b.line
    );
  };
}

export function rankBestPicks(
  props: EvaluatedProp[],
  generatedAt: string,
  thresholds: DailyThresholds = dailyThresholds(),
  previous: OddsSnapshot | null = null
): DailyPick[] {
  const qualified = props.filter((prop) => evidenceQuality(prop, generatedAt, thresholds) !== "limited" && prop.side);
  qualified.sort(compareBestPicks(generatedAt, thresholds));
  const picks: DailyPick[] = [];
  const seenMarket = new Set<string>();
  const playerCounts = new Map<string, number>();
  for (const prop of qualified) {
    const marketKey = `${prop.eventId}|${prop.matchKey}|${prop.market}`;
    if (seenMarket.has(marketKey)) continue;
    const playerKey = `${prop.eventId}|${prop.matchKey}`;
    const used = playerCounts.get(playerKey) ?? 0;
    if (used >= DAILY_MAX_PER_PLAYER) continue;
    const quality = evidenceQuality(prop, generatedAt, thresholds);
    if (quality === "limited" || !prop.side || prop.marketProbability == null) continue;
    seenMarket.add(marketKey);
    playerCounts.set(playerKey, used + 1);
    prop.evidenceQuality = quality;
    prop.selectionRank = picks.length + 1;
    picks.push(toDailyPick(prop, generatedAt, quality, previous));
    if (picks.length >= thresholds.maxPicks) break;
  }
  return picks;
}

function toDailyPick(
  prop: EvaluatedProp,
  generatedAt: string,
  quality: "high" | "moderate",
  previous: OddsSnapshot | null
): DailyPick {
  const age = quoteAgeMinutes(prop.quotedAt, generatedAt);
  const spread = disagreementPoints(prop);
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (prop.probabilitySource === "direct") {
    reasons.push(`${prop.books} sportsbooks priced this exact line.`);
  } else {
    reasons.push("The exact line was not posted. The chance is interpolated between nearby book lines.");
    warnings.push("Interpolated prices are less direct than an exact line.");
  }
  if (spread != null) reasons.push(`The books are ${spread} point${spread === 1 ? "" : "s"} apart.`);
  if (age != null) reasons.push(`The newest quote is ${age} minutes old.`);
  else warnings.push("The odds response did not include a quote time.");
  for (const flag of prop.researchFlags ?? []) {
    if (flag === "minutes_restriction" || flag === "unverified_minutes") {
      warnings.push("A minutes limit was mentioned. The hit chance was not changed.");
    } else if (flag === "unverified_injury" || flag === "unverified_availability") {
      warnings.push("An availability note is unverified.");
    } else if (flag === "conflicting_reports") {
      warnings.push("The reports disagree about whether this player is available.");
    } else if (flag === "lineup_change") {
      warnings.push("A verified lineup note is attached. Recheck the price before lock.");
    } else if (flag === "research_unavailable") {
      warnings.push("Research did not return. The market price was left as-is.");
    }
  }
  const moved = priorLine(previous, prop);
  if (moved != null && moved !== prop.line) {
    warnings.push(`PrizePicks moved this line from ${moved} to ${prop.line}. This card uses ${prop.line}.`);
  }
  return {
    rank: prop.selectionRank ?? 0,
    sport: prop.sport,
    eventId: prop.eventId,
    eventStart: prop.startTime,
    player: prop.playerName,
    opponent: prop.opponent,
    market: prop.market,
    stat: prop.stat,
    side: prop.side!,
    line: prop.line,
    oddsType: prop.oddsType,
    marketProbability: prop.marketProbability!,
    pricingMethod: prop.probabilitySource === "interpolated" ? "market-interpolate-v1" : "direct",
    sportsbookCount: prop.books,
    quoteAgeMinutes: age,
    evidenceQuality: quality,
    reasons,
    warnings,
    researchStatus: researchLabel(prop),
    projectionId: prop.projectionId,
    league: prop.league,
  };
}

function researchLabel(prop: EvaluatedProp): DailyPick["researchStatus"] {
  if (prop.researchStatus === "failed") return "unavailable";
  if (prop.researchStatus !== "completed") return "not_requested";
  const warning = (prop.researchFlags ?? []).some((flag) => MATERIAL.includes(flag) || flag === "lineup_change");
  return warning ? "warnings" : "verified";
}

export function priorLine(previous: OddsSnapshot | null, prop: EvaluatedProp): number | null {
  if (!previous) return null;
  const hit = previous.legs.find(
    (leg) =>
      leg.playerName === prop.playerName &&
      leg.market === prop.market &&
      (leg.eventId == null || leg.eventId === prop.eventId) &&
      leg.line !== prop.line
  );
  return hit?.line ?? null;
}

export function exclusionCounts(props: EvaluatedProp[], generatedAt: string, thresholds: DailyThresholds): Record<string, number> {
  const counts: Record<string, number> = {};
  const add = (reason: string) => {
    counts[reason] = (counts[reason] ?? 0) + 1;
  };
  for (const prop of props) {
    const until = minutesUntilStart(prop.startTime, generatedAt);
    if (until != null && until <= 0 && prop.marketProbability != null) {
      add("game_started");
      continue;
    }
    if (!prop.rejectionReasons.length && evidenceQuality(prop, generatedAt, thresholds) === "limited") {
      if ((prop.marketProbability ?? 0) < thresholds.minProbability) add("below_probability");
      else if (prop.books < thresholds.minBooks) add("insufficient_books");
      else add("limited_evidence");
      continue;
    }
    for (const reason of prop.rejectionReasons) add(reason);
  }
  return counts;
}

const EXCLUSION_COPY: Record<string, string> = {
  stale_quote: "stale sportsbook quotes",
  unpriced: "not enough books priced the line",
  exact_line_not_priced: "unsupported line gaps",
  books_disagree: "sportsbooks disagree by more than 10 points",
  push_unidentified: "integer lines that can push",
  player_unavailable: "verified scratches",
  game_started: "games already started",
  below_probability: "under the minimum hit chance",
  insufficient_books: "fewer books than the daily minimum",
  limited_evidence: "evidence too thin for the recommended list",
};

export function exclusionSentence(reason: string, count: number): string {
  return `${count} ${EXCLUSION_COPY[reason] ?? reason.replaceAll("_", " ")}`;
}

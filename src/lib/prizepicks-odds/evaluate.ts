import type { BookQuote } from "./consensus";
import { agreedBookLine, type PointQuote } from "./consensus";
import { boardSport, INTERPOLATION_VERSION, missingFeatures, MODEL_VERSION } from "./features";
import { interpolateOver } from "./interpolate";
import { bookRangeTooWide, estimateAtLine, isHalfPointLine, MAX_BOOK_RANGE_POINTS } from "./probability";

export const QUOTE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export type ScanPropInput = {
  id: string;
  playerName: string;
  team: string;
  opponent: string;
  league: string;
  stat: string;
  market: string;
  line: number;
  oddsType: string;
  startTime: string;
  gameId: string;
  updatedAt?: string;
  quotes: BookQuote[];
  otherLines: PointQuote[];
  oddsEventId?: string;
  sportKey?: string;
};

export type EvaluatedProp = {
  id: string;
  sport: string;
  eventId: string;
  playerId: null;
  playerName: string;
  matchKey: string;
  team: string;
  opponent: string;
  startTime: string;
  market: string;
  stat: string;
  period: "full_game";
  settlementScope: "full_game";
  line: number;
  side: "over" | "under" | null;
  oddsType: string;
  sourceTimestamp: string;
  books: number;
  bookPoint: number | null;
  marketProbability: number | null;
  probabilitySource: "direct" | "interpolated" | null;
  interpolationUncertainty: number | null;
  modelProbability: null;
  bookRange: { low: number; high: number } | null;
  confidenceInterval: null;
  estimatedEv: null;
  evStatus: "unavailable";
  dataQuality: "market" | "interpolated" | "insufficient";
  rejectionReasons: string[];
  correlationGroup: string[];
  modelVersion: string;
  explanation: string;
  featuresMissing: string[];
  label: string;
  quotedAt: string | null;
  researchStatus: "not_requested" | "completed" | "failed";
  researchFlags: string[];
  researchSummary: string | null;
  evidenceQuality?: "high" | "moderate" | "limited";
  selectionRank?: number;
  projectionId: string;
  league: string;
};

export function quoteIsStale(lastUpdate: string | undefined, scannedAt: string, maxAgeMs = QUOTE_MAX_AGE_MS): boolean {
  if (!lastUpdate) return false;
  const quoteMs = Date.parse(lastUpdate);
  const scanMs = Date.parse(scannedAt);
  if (!Number.isFinite(quoteMs) || !Number.isFinite(scanMs)) return false;
  return scanMs - quoteMs > maxAgeMs;
}

function usableQuotes<T extends { lastUpdate?: string }>(quotes: T[], scannedAt: string): { rows: T[]; stale: boolean } {
  const dated = quotes.filter((quote) => quote.lastUpdate);
  if (!dated.length) return { rows: quotes, stale: false };
  const fresh = dated.filter((quote) => !quoteIsStale(quote.lastUpdate, scannedAt));
  if (fresh.length >= 2) return { rows: fresh, stale: false };
  if (dated.some((quote) => quoteIsStale(quote.lastUpdate, scannedAt))) return { rows: [], stale: true };
  return { rows: quotes, stale: false };
}

export function propIdentity(input: ScanPropInput): string {
  return [input.league, input.gameId, input.playerName.trim().toLowerCase(), input.market, input.line, input.oddsType]
    .join("|");
}

export function evaluateProp(input: ScanPropInput, scannedAt: string): EvaluatedProp {
  const sport = boardSport(input.league) ?? input.league;
  const freshExact = usableQuotes(input.quotes, scannedAt);
  const freshOther = usableQuotes(input.otherLines, scannedAt);
  const agreed = agreedBookLine(freshOther.rows);
  const estimate = estimateAtLine(freshExact.rows, input.line);
  const interpolated =
    estimate || freshExact.stale ? null : interpolateOver(freshOther.rows, input.line);
  const reasons: string[] = [];
  if (!boardSport(input.league)) reasons.push("unsupported_sport");
  if (freshExact.stale || (!estimate && freshOther.stale)) reasons.push("stale_quote");
  else if (estimate && bookRangeTooWide(estimate)) reasons.push("books_disagree");
  else if (!estimate && interpolated && interpolated.uncertaintyPoints > MAX_BOOK_RANGE_POINTS) reasons.push("books_disagree");
  else if (!estimate && !interpolated) {
    if (!isHalfPointLine(input.line) && (input.quotes.length >= 2 || input.otherLines.length >= 2)) reasons.push("push_unidentified");
    else if (agreed && agreed.point !== input.line) reasons.push("exact_line_not_priced");
    else reasons.push("unpriced");
  }
  const usingInterpolation = reasons.length === 0 && !estimate && interpolated != null;
  const side = estimate?.side ?? (usingInterpolation ? sideFromOver(interpolated!.overProbability) : null);
  const sideLabel = side === "over" ? "Over" : side === "under" ? "Under" : "Unpriced";
  const qualified = reasons.length === 0 && (estimate != null || usingInterpolation);
  const marketProbability = !qualified
    ? null
    : estimate
      ? estimate.marketProbability
      : probabilityForSide(interpolated!.overProbability, side!);
  return {
    id: propIdentity(input),
    sport,
    eventId: input.gameId,
    playerId: null,
    playerName: input.playerName,
    matchKey: input.playerName.trim().toLowerCase(),
    team: input.team,
    opponent: input.opponent,
    startTime: input.startTime,
    market: input.market,
    stat: input.stat,
    period: "full_game",
    settlementScope: "full_game",
    line: input.line,
    side,
    oddsType: input.oddsType,
    sourceTimestamp: input.updatedAt || scannedAt,
    books: estimate?.books ?? interpolated?.books ?? 0,
    bookPoint: agreed?.point ?? null,
    marketProbability,
    probabilitySource: !qualified ? null : estimate ? "direct" : "interpolated",
    interpolationUncertainty: usingInterpolation ? interpolated!.uncertaintyPoints : null,
    modelProbability: null,
    bookRange: estimate?.bookRange ?? null,
    confidenceInterval: null,
    estimatedEv: null,
    evStatus: "unavailable",
    dataQuality: !qualified ? "insufficient" : estimate ? "market" : "interpolated",
    rejectionReasons: reasons,
    correlationGroup: [`game:${input.gameId}`, `player:${input.playerName.trim().toLowerCase()}`],
    modelVersion: usingInterpolation ? INTERPOLATION_VERSION : MODEL_VERSION,
    explanation: explanation(qualified, usingInterpolation, reasons, agreed?.point ?? null, input.line, interpolated),
    featuresMissing: missingFeatures(sport),
    label: `${input.playerName} ${sideLabel} ${input.line} ${input.stat}`,
    quotedAt: newestQuote(freshExact.rows.length ? freshExact.rows : freshOther.rows),
    researchStatus: "not_requested",
    researchFlags: [],
    researchSummary: null,
    projectionId: input.id,
    league: input.league,
  };
}

function sideFromOver(over: number): "over" | "under" {
  return over >= 0.5 ? "over" : "under";
}

function probabilityForSide(over: number, side: "over" | "under"): number {
  const pct = side === "over" ? over * 100 : (1 - over) * 100;
  return Math.round(pct * 10) / 10;
}

function newestQuote(quotes: Array<{ lastUpdate?: string }>): string | null {
  const times = quotes.map((quote) => quote.lastUpdate).filter((value): value is string => Boolean(value));
  if (!times.length) return null;
  return times.sort().at(-1) ?? null;
}

function explanation(
  qualified: boolean,
  interpolated: boolean,
  reasons: string[],
  bookPoint: number | null,
  line: number,
  curve: { lower: number; upper: number } | null
): string {
  if (qualified && interpolated && curve) {
    return `Interpolated between book lines ${curve.lower} and ${curve.upper}. This is not the exact PrizePicks number and it is not a player model.`;
  }
  if (qualified) {
    return "Median no-vig chance at this exact PrizePicks number. Player features are missing, so this is the market estimate only.";
  }
  if (reasons.includes("stale_quote")) {
    return "The stored book quotes are older than six hours. The prop stays off the board until a fresh quote arrives.";
  }
  if (reasons.includes("exact_line_not_priced") && bookPoint != null) {
    return `Books post ${bookPoint} and did not price ${line}. A moved number is not a hit probability.`;
  }
  if (reasons.includes("push_unidentified")) {
    return "This line can push. The two-way price does not say how often.";
  }
  if (reasons.includes("books_disagree")) {
    return "The books that priced this line are more than 10 points apart. The median is not used.";
  }
  return "Not enough books priced this exact line.";
}

import { bookRangeTooWide, estimateAtLine, isHalfPointLine, type MarketEstimate } from "@/lib/prizepicks-odds/probability";
import { quoteIsStale } from "@/lib/prizepicks-odds/evaluate";
import type { BookQuote } from "@/lib/prizepicks-odds/consensus";
import { marketPriority } from "./scope";
import { findPlayerProps } from "./board";
import { conditionalIntegerPrice, priceIntegerFromAdjacent, thresholdType } from "./integer-price";
import type { Candidate, IndexedProp, NewsEvent, Verdict } from "./types";

const FRESH_NEWS_MS = 6 * 60 * 60 * 1000;
const EXPIRED_NEWS_MS = 36 * 60 * 60 * 1000;

export function selectProps(event: NewsEvent, props: IndexedProp[]): IndexedProp[] {
  const priority = marketPriority(event.sport);
  const chosen: IndexedProp[] = [];
  for (const player of event.playerIds) {
    const matches = findPlayerProps(props, event.sport, player);
    const ordered = [...matches].sort((a, b) => priority.indexOf(a.market) - priority.indexOf(b.market) || a.line - b.line);
    const seen = new Set<string>();
    for (const prop of ordered) {
      if (seen.has(prop.market)) continue;
      seen.add(prop.market);
      chosen.push(prop);
      if (seen.size >= 2) break;
    }
  }
  return chosen;
}

export function decideVerdict(input: {
  now: string;
  event: NewsEvent;
  prop: IndexedProp | null;
  quotes: BookQuote[] | null;
  adjacentLow?: BookQuote[] | null;
  adjacentHigh?: BookQuote[] | null;
  budgetExhausted?: boolean;
  providerError?: string | null;
}): { verdict: Verdict; estimate: MarketEstimate | null; risks: string[]; reason: string; code: string; pLessWin: number | null; pPush: number | null; pMoreWin: number | null; pricingMethod: string | null } {
  const { event, prop } = input;
  const now = Date.parse(input.now);
  const published = event.publishedAt ? Date.parse(event.publishedAt) : NaN;
  const risks: string[] = [];
  if (event.roleChange) risks.push("Historical playing time or workload may be stale. The side was not reversed.");
  if (event.evidenceStatus === "contradicted") risks.push("Sources disagree. Neither version was chosen.");
  if (!event.publishedAt) risks.push("Publication time is unknown.");
  const blank = { estimate: null as MarketEstimate | null, pLessWin: null, pPush: null, pMoreWin: null, pricingMethod: null as string | null };
  if (!prop) {
    return { verdict: "no_eligible_prop", ...blank, risks, reason: "No eligible PrizePicks market.", code: "NO_ACTIVE_PRIZEPICKS_PROP" };
  }
  const start = Date.parse(prop.startTime);
  if (Number.isFinite(start) && start <= now) {
    return { verdict: "expired", ...blank, risks, reason: "The game has already started.", code: "EVENT_ALREADY_STARTED" };
  }
  if (Number.isFinite(published) && now - published > EXPIRED_NEWS_MS) {
    return { verdict: "expired", ...blank, risks, reason: "The report is older than 36 hours.", code: "STALE_NEWS" };
  }
  if (input.providerError) {
    return { verdict: "insufficient_data", ...blank, risks, reason: input.providerError, code: providerCode(input.providerError) };
  }
  if (input.budgetExhausted) {
    return { verdict: "insufficient_data", ...blank, risks, reason: "Budget exhausted before this sportsbook request.", code: "ODDS_BUDGET_EXHAUSTED" };
  }
  if (input.quotes == null && !input.adjacentLow && !input.adjacentHigh) {
    return { verdict: "insufficient_data", ...blank, risks, reason: "Awaiting sportsbook prices.", code: "AWAITING_ODDS" };
  }
  if (!isHalfPointLine(prop.line)) {
    return integerDecision(input, prop, risks, published, start);
  }
  const quotes = input.quotes ?? [];
  const dated = quotes.filter((quote) => quote.lastUpdate);
  const fresh = dated.filter((quote) => !quoteIsStale(quote.lastUpdate, input.now));
  if (dated.length && fresh.length < 2) {
    return { verdict: "invalid_market_comparison", ...blank, risks, reason: "The sportsbook quotes are stale.", code: "STALE_ODDS" };
  }
  const estimate = estimateAtLine(fresh.length ? fresh : quotes, prop.line);
  if (!estimate) {
    return {
      verdict: quotes.length ? "invalid_market_comparison" : "insufficient_data",
      ...blank,
      risks,
      reason: quotes.length ? "The books did not price both sides of this exact line." : "No comparable sportsbook price was returned.",
      code: quotes.length ? "SPORTSBOOK_MARKET_UNAVAILABLE" : "SPORTSBOOK_MARKET_UNAVAILABLE",
    };
  }
  if (bookRangeTooWide(estimate)) {
    return { verdict: "invalid_market_comparison", ...blank, estimate, risks, reason: "The sportsbooks disagree by more than 10 points.", code: "BOOKS_DISAGREE" };
  }
  return finish(event, input.now, published, start, risks, {
    estimate,
    pLessWin: null,
    pPush: 0,
    pMoreWin: null,
    pricingMethod: "half_point",
    probabilityNote: "This is a market chance on a half-point line, not expected value.",
  });
}

function providerCode(message: string): string {
  if (/event not available/i.test(message)) return "EVENT_NOT_AVAILABLE";
  if (/401|403|api key|unauthorized/i.test(message)) return "ODDS_AUTH_FAILED";
  if (/timeout|aborted/i.test(message)) return "ODDS_TIMEOUT";
  if (/unsupported|market/i.test(message) && /invalid|unknown/i.test(message)) return "UNSUPPORTED_MARKET";
  return "ODDS_PROVIDER_ERROR";
}

function freshQuotes(quotes: BookQuote[], now: string): { rows: BookQuote[]; stale: boolean } {
  const dated = quotes.filter((quote) => quote.lastUpdate);
  const fresh = dated.filter((quote) => !quoteIsStale(quote.lastUpdate, now));
  if (dated.length && fresh.length < 2) return { rows: [], stale: true };
  return { rows: fresh.length ? fresh : quotes, stale: false };
}

function integerDecision(
  input: { now: string; event: NewsEvent; quotes: BookQuote[] | null; adjacentLow?: BookQuote[] | null; adjacentHigh?: BookQuote[] | null },
  prop: IndexedProp,
  risks: string[],
  published: number,
  start: number
): ReturnType<typeof decideVerdict> {
  const blank = { estimate: null as MarketEstimate | null, pLessWin: null as number | null, pPush: null as number | null, pMoreWin: null as number | null, pricingMethod: null as string | null };
  const low = freshQuotes(input.adjacentLow ?? [], input.now);
  const high = freshQuotes(input.adjacentHigh ?? [], input.now);
  if (low.stale || high.stale) {
    return { verdict: "invalid_market_comparison", ...blank, risks, reason: "The adjacent sportsbook quotes are stale.", code: "STALE_ODDS" };
  }
  const three = priceIntegerFromAdjacent(prop.line, low.rows, high.rows);
  if ("pLessWin" in three) {
    const side = three.pLessWin >= three.pMoreWin ? "under" : "over";
    const chance = Math.round(Math.max(three.pLessWin, three.pMoreWin) * 1000) / 10;
    const estimate: MarketEstimate = {
      marketProbability: chance,
      side,
      books: three.books,
      bookRange: { low: chance, high: chance },
      modelVersion: "market-median-v1",
      pushProbability: 0,
    };
    return finish(input.event, input.now, published, start, risks, {
      estimate,
      pLessWin: three.pLessWin,
      pPush: three.pPush,
      pMoreWin: three.pMoreWin,
      pricingMethod: "adjacent_half_points",
      probabilityNote: `Less ${pct(three.pLessWin)}, push ${pct(three.pPush)}, more ${pct(three.pMoreWin)} from the ${prop.line - 0.5} and ${prop.line + 0.5} lines. Push is separated. This is not entry expected value.`,
    });
  }
  const exactFresh = freshQuotes(input.quotes ?? [], input.now);
  if (exactFresh.stale) {
    return { verdict: "invalid_market_comparison", ...blank, risks, reason: "The sportsbook quotes are stale.", code: "STALE_ODDS" };
  }
  const conditional = conditionalIntegerPrice(exactFresh.rows);
  if (conditional) {
    return {
      verdict: "insufficient_data",
      ...blank,
      pricingMethod: "conditional_two_way",
      risks,
      reason: `Integer line — insufficient data to estimate push probability. The two-way price is conditional on no push (more ${pct(conditional.conditionalMore)}, less ${pct(conditional.conditionalLess)}).`,
      code: "INTEGER_PUSH_PROBABILITY_UNKNOWN",
    };
  }
  return {
    verdict: "insufficient_data",
    ...blank,
    risks,
    reason: "Integer line — insufficient data to estimate push probability. No compatible 0.5-point lines were returned.",
    code: three.code === "INCONSISTENT_ALT_LINES" ? "INCONSISTENT_ALT_LINES" : "NO_COMPATIBLE_ALT_LINES",
  };
}

function pct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function finish(
  event: NewsEvent,
  now: string,
  published: number,
  start: number,
  risks: string[],
  priced: { estimate: MarketEstimate; pLessWin: number | null; pPush: number | null; pMoreWin: number | null; pricingMethod: string; probabilityNote: string }
): ReturnType<typeof decideVerdict> {
  const strong = event.evidenceStatus === "official" || event.evidenceStatus === "corroborated";
  const newsIsFresh = Number.isFinite(published) && Date.parse(now) - published <= FRESH_NEWS_MS && published <= start;
  const base = {
    estimate: priced.estimate,
    pLessWin: priced.pLessWin,
    pPush: priced.pPush,
    pMoreWin: priced.pMoreWin,
    pricingMethod: priced.pricingMethod,
    risks,
  };
  if (event.evidenceStatus === "contradicted") {
    return { verdict: "needs_verification", ...base, reason: "Sources disagree, so the price was not turned into a pick.", code: "CONTRADICTORY_EVIDENCE" };
  }
  if (event.roleChange || !event.publishedAt) {
    return { verdict: "needs_verification", ...base, reason: "The price is real, and the role or timing still needs verification.", code: event.roleChange ? "ROLE_CHANGE" : "PUBLICATION_TIME_UNKNOWN" };
  }
  if (event.evidenceStatus === "unverified") {
    return { verdict: "needs_verification", ...base, reason: "The source is not an official or independent news page.", code: "UNVERIFIED_SOURCE" };
  }
  if (strong && newsIsFresh) {
    return { verdict: "supported_opportunity", ...base, reason: priced.probabilityNote, code: "SUPPORTED" };
  }
  if (strong && Number.isFinite(published)) {
    return { verdict: "market_already_adjusted", ...base, reason: "The report is hours old and the books already show a fresh price.", code: "MARKET_ALREADY_ADJUSTED" };
  }
  if (event.evidenceStatus === "reported" && newsIsFresh) {
    return { verdict: "interesting_story", ...base, reason: "One reporting source and a current price. That is not enough to call it a supported opportunity.", code: "SINGLE_SOURCE" };
  }
  return { verdict: "needs_verification", ...base, reason: "The comparison is incomplete.", code: "INCOMPLETE" };
}

export function candidatesFromEvents(events: NewsEvent[], props: IndexedProp[], now: string): Candidate[] {
  const rows: Candidate[] = [];
  for (const event of events) {
    const matched = selectProps(event, props);
    if (!matched.length) {
      const decision = decideVerdict({ now, event, prop: null, quotes: null });
      rows.push(toCandidate(event, event.playerIds[0] ?? "Unknown", null, decision));
      continue;
    }
    for (const prop of matched) {
      rows.push(toCandidate(event, prop.player, prop, { verdict: "insufficient_data", estimate: null, risks: [], reason: "Awaiting sportsbook prices." }));
    }
  }
  return rows;
}

export function toCandidate(
  event: NewsEvent,
  player: string,
  prop: IndexedProp | null,
  decision: { verdict: Verdict; estimate: MarketEstimate | null; risks: string[]; reason: string; code?: string; pLessWin?: number | null; pPush?: number | null; pMoreWin?: number | null; pricingMethod?: string | null }
): Candidate {
  return {
    eventId: event.id,
    sport: event.sport,
    player,
    game: prop ? `${prop.team} vs ${prop.opponent}` : event.teamIds.join(", "),
    market: prop?.market ?? null,
    stat: prop?.stat ?? null,
    line: prop?.line ?? null,
    projectionId: prop?.projectionId ?? null,
    startTime: prop?.startTime ?? null,
    verdict: decision.verdict,
    marketProbability: decision.estimate?.marketProbability ?? null,
    pricingSide: decision.estimate?.side ?? null,
    books: decision.estimate?.books ?? null,
    risks: decision.risks,
    reason: decision.reason,
    summary: event.summary,
    sourceUrls: event.sourceUrls,
    publishedAt: event.publishedAt,
    evidenceStatus: event.evidenceStatus,
    thresholdType: prop ? thresholdType(prop.line) : undefined,
    rejectionCode: decision.code,
    pLessWin: decision.pLessWin ?? null,
    pPush: decision.pPush ?? null,
    pMoreWin: decision.pMoreWin ?? null,
    pricingMethod: decision.pricingMethod ?? null,
  };
}

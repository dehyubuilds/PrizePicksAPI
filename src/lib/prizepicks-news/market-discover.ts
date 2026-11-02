import type { BookQuote } from "@/lib/prizepicks-odds/consensus";
import { fetchOdds, parseEventOdds, parseEvents, type OddsResponse } from "@/lib/prizepicks-odds/client";
import { quoteIsStale } from "@/lib/prizepicks-odds/evaluate";
import { alternateMarket, exceedsCreditBudget, normalizePlayerName, primaryMarketKey, sportKeyForLeague } from "@/lib/prizepicks-odds/markets";
import { UNVERIFIED_PAYOUTS, expectedValue } from "@/lib/prizepicks-odds/payouts";
import { bookRangeTooWide, estimateAtLine, isHalfPointLine } from "@/lib/prizepicks-odds/probability";
import { eventMatchesTeams } from "@/lib/prizepicks-odds/teams";
import { conditionalIntegerPrice, priceIntegerFromAdjacent, thresholdType } from "./integer-price";
import { marketPriority } from "./scope";
import { assignSoccerSportKeys, fetchSoccerEventLists, soccerEventMatches } from "./soccer";
import type { Candidate, IndexedProp } from "./types";

export const MARKET_SUMMARY = "Market-derived opportunity — no material news identified.";

const MARKET_WEIGHT: Record<string, number> = {
  pitcher_strikeouts: 50,
  player_rebounds: 40,
  player_receptions: 40,
  player_assists: 30,
  player_reception_yds: 32,
  player_rush_yds: 28,
  player_points: 24,
  player_rush_attempts: 24,
  player_threes: 20,
  player_pass_yds: 22,
  player_pass_attempts: 18,
  player_pass_tds: 18,
};

export type MarketGroup = {
  sportKey: string;
  gameId: string;
  team: string;
  opponent: string;
  startTime: string;
  markets: string[];
  props: IndexedProp[];
  score: number;
};

export function groupBoard(props: IndexedProp[], nowIso: string): MarketGroup[] {
  const groups = new Map<string, MarketGroup>();
  for (const prop of props) {
    const sportKey = prop.oddsSportKey || sportKeyForLeague(prop.sport);
    if (!sportKey) continue;
    const key = `${sportKey}:${prop.gameId}`;
    const group = groups.get(key) ?? {
      sportKey,
      gameId: prop.gameId,
      team: prop.team,
      opponent: prop.opponent,
      startTime: prop.startTime,
      markets: [],
      props: [],
      score: 0,
    };
    group.props.push(prop);
    if (!group.markets.includes(prop.market)) group.markets.push(prop.market);
    groups.set(key, group);
  }
  return Array.from(groups.values()).map((group) => {
    const priority = marketPriority(group.props[0]!.sport);
    const present = new Set(group.markets);
    const primary = priority.filter((market) => present.has(market)).slice(0, 3);
    const markets = [...primary];
    for (const market of primary) {
      if (!group.props.some((prop) => prop.market === market && !isHalfPointLine(prop.line))) continue;
      const alt = alternateMarket(group.props[0]!.sport, market);
      if (alt) markets.push(alt);
    }
    const props = group.props.filter((prop) => primary.includes(prop.market));
    const next = { ...group, markets, props };
    return { ...next, score: scoreGroup(next, nowIso) };
  }).filter((group) => group.props.length > 0);
}

export function scoreGroup(group: MarketGroup, nowIso: string): number {
  const weights = group.props.map((prop) => MARKET_WEIGHT[prop.market] ?? 10);
  const best = weights.length ? Math.max(...weights) : 0;
  const extra = Math.min(10, Math.max(0, new Set(group.props.map((prop) => prop.market)).size - 1) * 3);
  const hours = (Date.parse(group.startTime) - Date.parse(nowIso)) / 3_600_000;
  const soon = !Number.isFinite(hours) ? 0 : hours <= 12 ? 20 : hours <= 36 ? 12 : 4;
  return best + extra + soon;
}

export function selectGroups(
  groups: MarketGroup[],
  options: { maxEvents: number; maxRequests: number; creditsUsed: number; maxCredits: number; sportsListed?: ReadonlySet<string>; requestsUsed?: number }
): { chosen: MarketGroup[]; truncated: boolean } {
  const ranked = [...groups].sort((a, b) => b.score - a.score || a.startTime.localeCompare(b.startTime));
  const chosen: MarketGroup[] = [];
  const sportsListed = new Set<string>();
  let requests = options.requestsUsed ?? 0;
  let credits = options.creditsUsed;
  let truncated = false;
  for (const group of ranked) {
    if (chosen.length >= options.maxEvents) break;
    const listCost = sportsListed.has(group.sportKey) || options.sportsListed?.has(group.sportKey) ? 0 : 1;
    const nextRequests = requests + (listCost ? 1 : 0) + 1;
    const nextCredits = credits + listCost + group.markets.length;
    if (nextRequests > options.maxRequests || exceedsCreditBudget(credits, listCost + group.markets.length, options.maxCredits)) {
      truncated = true;
      break;
    }
    if (listCost) sportsListed.add(group.sportKey);
    requests = nextRequests;
    credits = nextCredits;
    chosen.push(group);
  }
  return { chosen, truncated };
}

export function evidenceScore(row: Pick<Candidate, "books" | "pricingMethod" | "bookRange" | "publishedAt"> & { quoteAgeMs?: number | null }): number {
  const books = Math.min(row.books ?? 0, 6) / 6 * 30;
  const method = row.pricingMethod === "half_point" ? 25 : row.pricingMethod === "adjacent_half_points" ? 18 : 0;
  const width = row.bookRange ?? 10;
  const agreement = width <= 3 ? 20 : width <= 6 ? 12 : width <= 10 ? 6 : 0;
  const age = row.quoteAgeMs;
  const fresh = age == null ? 10 : age <= 3_600_000 ? 25 : age <= 3 * 3_600_000 ? 18 : age <= 6 * 3_600_000 ? 10 : 0;
  return Math.round(books + method + agreement + fresh);
}

export function assignTier(row: Candidate): "A" | "B" | "C" | null {
  const priced = row.marketProbability != null && (row.pricingMethod === "half_point" || row.pricingMethod === "adjacent_half_points");
  if (!priced) {
    if (row.rejectionCode === "INTEGER_PUSH_PROBABILITY_UNKNOWN" || row.verdict === "interesting_story" || row.verdict === "needs_verification" || row.verdict === "market_already_adjusted") return "C";
    return null;
  }
  const uncertain = row.risks.some((risk) => /stale|disagree|contradict/i.test(risk)) || row.rejectionCode === "ROLE_CHANGE" || row.rejectionCode === "CONTRADICTORY_EVIDENCE" || row.evidenceStatus === "contradicted";
  if (uncertain) return "C";
  if (row.edgeStatus === "VERIFIED" && row.estimatedEdge != null && (row.evidenceStatus === "official" || row.evidenceStatus === "corroborated")) return "A";
  return "B";
}

export function candidateIdentity(row: Candidate): string {
  return [row.sport, row.player, row.market ?? "", row.line ?? "", row.startTime ?? ""].join("|");
}

export function mergeCandidates(rows: Candidate[]): Candidate[] {
  const merged = new Map<string, Candidate>();
  for (const row of rows) {
    const key = candidateIdentity(row);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, row);
      continue;
    }
    const priced = row.marketProbability != null ? row : existing.marketProbability != null ? existing : row;
    const other = priced === row ? existing : row;
    const news = [existing, row].find((item) => item.discoveryMethod !== "MARKET" && item.summary !== MARKET_SUMMARY);
    merged.set(key, {
      ...priced,
      discoveryMethod: "BOTH",
      summary: news?.summary || priced.summary,
      sourceUrls: Array.from(new Set([...existing.sourceUrls, ...row.sourceUrls])),
      risks: Array.from(new Set([...existing.risks, ...other.risks])),
      eventId: news?.eventId ?? priced.eventId,
      evidenceStatus: news?.evidenceStatus ?? priced.evidenceStatus,
      publishedAt: news?.publishedAt ?? priced.publishedAt,
      reason: news ? `${news.reason} ${priced.reason}`.trim() : priced.reason,
    });
  }
  return Array.from(merged.values());
}

export function buildShortlist(rows: Candidate[], target: number): Candidate[] {
  const ranked = rows
    .filter((row) => row.tier === "A" || row.tier === "B")
    .sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "A" ? -1 : 1) || (b.evidenceScore ?? 0) - (a.evidenceScore ?? 0) || (b.books ?? 0) - (a.books ?? 0));
  return ranked.slice(0, Math.max(0, target));
}

export function annotateCandidate(row: Candidate): Candidate {
  const payout = expectedValue({ book: UNVERIFIED_PAYOUTS, ruleId: "live", outcomeProbabilities: null });
  const edgeStatus = row.edgeStatus ?? (payout.status === "unavailable" ? "UNVERIFIED_PAYOUT" : "UNAVAILABLE");
  const next: Candidate = {
    ...row,
    discoveryMethod: row.discoveryMethod ?? "NEWS",
    edgeStatus,
    estimatedEdge: null,
    entryExpectedValue: null,
    pricingDiscrepancy: null,
    marketImpliedProbability: row.marketProbability,
  };
  next.tier = assignTier(next);
  if (next.evidenceScore == null) next.evidenceScore = next.tier ? evidenceScore(next) : 0;
  return next;
}

function quotesAtPoint(rows: ReturnType<typeof parseEventOdds>, player: string, market: string, line: number): BookQuote[] {
  const want = normalizePlayerName(player);
  const paired = new Map<string, { over?: number; under?: number; lastUpdate?: string }>();
  for (const row of rows) {
    if (primaryMarketKey(row.market) !== market || Math.abs(row.point - line) > 1e-6) continue;
    if (normalizePlayerName(row.player) !== want) continue;
    const quote = paired.get(row.book) ?? {};
    if (row.side === "over") quote.over = row.price;
    else quote.under = row.price;
    if (row.lastUpdate) quote.lastUpdate = row.lastUpdate;
    paired.set(row.book, quote);
  }
  const quotes: BookQuote[] = [];
  for (const [book, quote] of Array.from(paired.entries())) {
    if (quote.over == null || quote.under == null) continue;
    quotes.push({ book, overPrice: quote.over, underPrice: quote.under, lastUpdate: quote.lastUpdate });
  }
  return quotes;
}

function usable(quotes: BookQuote[], now: string): { rows: BookQuote[]; stale: boolean; ageMs: number | null } {
  const dated = quotes.filter((quote) => quote.lastUpdate);
  const fresh = dated.filter((quote) => !quoteIsStale(quote.lastUpdate, now));
  const oldest = dated.reduce<number | null>((age, quote) => {
    const stamp = Date.parse(quote.lastUpdate ?? "");
    if (!Number.isFinite(stamp)) return age;
    const gap = Date.parse(now) - stamp;
    return age == null ? gap : Math.max(age, gap);
  }, null);
  if (dated.length && fresh.length < 2) return { rows: [], stale: true, ageMs: oldest };
  return { rows: fresh.length ? fresh : quotes, stale: false, ageMs: oldest };
}

export function priceMarketProp(prop: IndexedProp, quotes: BookQuote[] | null, adjacentLow: BookQuote[] | null, adjacentHigh: BookQuote[] | null, now: string): Candidate {
  const base: Candidate = {
    eventId: `market:${prop.projectionId}`,
    sport: prop.sport,
    player: prop.player,
    game: `${prop.team} vs ${prop.opponent}`,
    market: prop.market,
    stat: prop.stat,
    line: prop.line,
    projectionId: prop.projectionId,
    startTime: prop.startTime,
    verdict: "insufficient_data",
    marketProbability: null,
    pricingSide: null,
    books: null,
    risks: ["No news search was required. A missing story does not prove the player is healthy or in the same role."],
    reason: "",
    summary: MARKET_SUMMARY,
    sourceUrls: [],
    publishedAt: null,
    evidenceStatus: "unverified",
    thresholdType: thresholdType(prop.line),
    discoveryMethod: "MARKET",
    edgeStatus: "UNVERIFIED_PAYOUT",
    estimatedEdge: null,
    entryExpectedValue: null,
    pricingDiscrepancy: null,
  };
  if (quotes == null && !adjacentLow && !adjacentHigh) {
    return { ...base, rejectionCode: "AWAITING_ODDS", reason: "Awaiting sportsbook prices." };
  }
  if (isHalfPointLine(prop.line)) {
    const fresh = usable(quotes ?? [], now);
    if (fresh.stale) return { ...base, verdict: "invalid_market_comparison", rejectionCode: "STALE_ODDS", reason: "The sportsbook quotes are stale." };
    const estimate = estimateAtLine(fresh.rows, prop.line);
    if (!estimate) return { ...base, verdict: "insufficient_data", rejectionCode: "SPORTSBOOK_MARKET_UNAVAILABLE", reason: "No comparable sportsbook price was returned." };
    if (bookRangeTooWide(estimate)) return { ...base, verdict: "invalid_market_comparison", rejectionCode: "BOOKS_DISAGREE", reason: "The sportsbooks disagree by more than 10 points.", books: estimate.books };
    const over = estimate.side === "over" ? estimate.marketProbability / 100 : 1 - estimate.marketProbability / 100;
    return finishPriced(base, {
      probability: estimate.marketProbability,
      side: estimate.side,
      books: estimate.books,
      range: estimate.bookRange.high - estimate.bookRange.low,
      pLessWin: 1 - over,
      pPush: 0,
      pMoreWin: over,
      method: "half_point",
      ageMs: fresh.ageMs,
      reason: `${estimate.marketProbability}% ${estimate.side === "over" ? "More" : "Less"} from ${estimate.books} books on a half-point line. ${MARKET_SUMMARY} Entry expected value is unavailable because PrizePicks payout rules are unverified.`,
    });
  }
  const low = usable(adjacentLow ?? [], now);
  const high = usable(adjacentHigh ?? [], now);
  if (low.stale || high.stale) return { ...base, verdict: "invalid_market_comparison", rejectionCode: "STALE_ODDS", reason: "The adjacent sportsbook quotes are stale." };
  const three = priceIntegerFromAdjacent(prop.line, low.rows, high.rows);
  if ("pLessWin" in three) {
    const side = three.pLessWin >= three.pMoreWin ? "under" : "over";
    const chance = Math.round(Math.max(three.pLessWin, three.pMoreWin) * 1000) / 10;
    return finishPriced(base, {
      probability: chance,
      side,
      books: three.books,
      range: 0,
      pLessWin: three.pLessWin,
      pPush: three.pPush,
      pMoreWin: three.pMoreWin,
      method: "adjacent_half_points",
      ageMs: Math.max(low.ageMs ?? 0, high.ageMs ?? 0),
      reason: `Less ${pct(three.pLessWin)}, push ${pct(three.pPush)}, more ${pct(three.pMoreWin)}. ${MARKET_SUMMARY} Entry expected value is unavailable because PrizePicks payout rules are unverified.`,
    });
  }
  const exact = usable(quotes ?? [], now);
  if (exact.stale) return { ...base, verdict: "invalid_market_comparison", rejectionCode: "STALE_ODDS", reason: "The sportsbook quotes are stale." };
  const conditional = conditionalIntegerPrice(exact.rows);
  if (conditional) {
    return {
      ...base,
      verdict: "insufficient_data",
      rejectionCode: "INTEGER_PUSH_PROBABILITY_UNKNOWN",
      pricingMethod: "conditional_two_way",
      tier: "C",
      reason: `Integer line — insufficient data to estimate push probability. The two-way price is conditional on no push (more ${pct(conditional.conditionalMore)}, less ${pct(conditional.conditionalLess)}).`,
    };
  }
  return {
    ...base,
    rejectionCode: three.code === "INCONSISTENT_ALT_LINES" ? "INCONSISTENT_ALT_LINES" : "NO_COMPATIBLE_ALT_LINES",
    reason: "Integer line — insufficient data to estimate push probability. No compatible 0.5-point lines were returned.",
  };
}

function finishPriced(
  base: Candidate,
  priced: { probability: number; side: "over" | "under"; books: number; range: number; pLessWin: number; pPush: number; pMoreWin: number; method: string; ageMs: number | null; reason: string }
): Candidate {
  const row: Candidate = {
    ...base,
    verdict: "needs_verification",
    rejectionCode: "MARKET_DERIVED",
    marketProbability: priced.probability,
    marketImpliedProbability: priced.probability,
    pricingSide: priced.side,
    books: priced.books,
    bookRange: priced.range,
    pLessWin: priced.pLessWin,
    pPush: priced.pPush,
    pMoreWin: priced.pMoreWin,
    pricingMethod: priced.method,
    reason: priced.reason,
  };
  row.evidenceScore = evidenceScore({ ...row, quoteAgeMs: priced.ageMs });
  row.tier = assignTier(row);
  return row;
}

function pct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

export async function discoverMarketCandidates(args: {
  props: IndexedProp[];
  now: string;
  maxEvents: number;
  maxRequests: number;
  maxCredits: number;
  creditsUsed: number;
  fetchOdds?: typeof fetchOdds;
  log?: (message: string) => void;
}): Promise<{ candidates: Candidate[]; requests: number; credits: number; cacheHits: number; providerErrors: number; groupsConsidered: number; groupsRequested: number; truncated: boolean }> {
  const fetchImpl = args.fetchOdds ?? fetchOdds;
  let requests = 0;
  let credits = 0;
  let cacheHits = 0;
  let providerErrors = 0;
  const eventsBySport = new Map<string, { id: string; home_team: string; away_team: string }[]>();
  let props = args.props;
  if (args.props.some((prop) => prop.sport === "SOCCER" && !prop.oddsSportKey)) {
    const listed = await fetchSoccerEventLists({
      fetchOdds: fetchImpl,
      creditsUsed: args.creditsUsed,
      maxCredits: args.maxCredits,
      log: args.log,
    });
    requests += listed.requests;
    credits += listed.credits;
    cacheHits += listed.cacheHits;
    providerErrors += listed.providerErrors;
    for (const [sportKey, events] of Array.from(listed.events.entries())) eventsBySport.set(sportKey, events);
    props = assignSoccerSportKeys(args.props, listed.events);
  }
  const groups = groupBoard(props, args.now);
  const { chosen, truncated } = selectGroups(groups, {
    maxEvents: args.maxEvents,
    maxRequests: args.maxRequests,
    creditsUsed: args.creditsUsed + credits,
    maxCredits: args.maxCredits,
    sportsListed: new Set(eventsBySport.keys()),
    requestsUsed: requests,
  });
  const candidates: Candidate[] = [];
  for (const group of chosen) {
    if (!eventsBySport.has(group.sportKey)) {
      try {
        const listed = await fetchImpl(`/sports/${group.sportKey}/events`, `events_${group.sportKey}`);
        requests += 1;
        if (listed.fromCache) cacheHits += 1;
        if (!listed.fromCache) credits += listed.lastCost ?? 1;
        eventsBySport.set(group.sportKey, parseEvents(listed.json));
      } catch (err) {
        providerErrors += 1;
        const message = err instanceof Error ? err.message : "The sportsbook event list failed.";
        args.log?.(`odds request failed ${message}`);
        for (const prop of group.props) {
          candidates.push({ ...priceMarketProp(prop, null, null, null, args.now), rejectionCode: "ODDS_PROVIDER_ERROR", reason: message, verdict: "insufficient_data" });
        }
        continue;
      }
    }
    const matched = (eventsBySport.get(group.sportKey) ?? []).find((game) =>
      group.props[0]?.sport === "SOCCER"
        ? soccerEventMatches({ team: group.team, opponent: group.opponent, home: game.home_team, away: game.away_team })
        : eventMatchesTeams({ team: group.team, opponent: group.opponent, home: game.home_team, away: game.away_team })
    );
    if (!matched) {
      for (const prop of group.props) {
        candidates.push({ ...priceMarketProp(prop, null, null, null, args.now), rejectionCode: "EVENT_NOT_AVAILABLE", reason: "Event not available: no Odds API game matched these teams.", verdict: "insufficient_data" });
      }
      continue;
    }
    if (exceedsCreditBudget(args.creditsUsed + credits, group.markets.length, args.maxCredits)) break;
    const query = group.markets.join(",");
    let response: OddsResponse;
    try {
      args.log?.(`odds request ${group.sportKey} ${query}`);
      response = await fetchImpl(
        `/sports/${group.sportKey}/events/${matched.id}/odds?regions=us&oddsFormat=american&markets=${encodeURIComponent(query)}`,
        `odds_${matched.id}_${query}`
      );
    } catch (err) {
      providerErrors += 1;
      const message = err instanceof Error ? err.message : "The sportsbook market request failed.";
      args.log?.(`odds request failed ${message}`);
      for (const prop of group.props) {
        candidates.push({ ...priceMarketProp(prop, null, null, null, args.now), rejectionCode: "ODDS_PROVIDER_ERROR", reason: message, verdict: "insufficient_data" });
      }
      continue;
    }
    requests += 1;
    if (response.fromCache) cacheHits += 1;
    if (!response.fromCache) credits += response.lastCost ?? group.markets.length;
    const outcomes = parseEventOdds(response.json);
    for (const prop of group.props) {
      const quotes = quotesAtPoint(outcomes, prop.player, prop.market, prop.line);
      const adjacentLow = isHalfPointLine(prop.line) ? null : quotesAtPoint(outcomes, prop.player, prop.market, prop.line - 0.5);
      const adjacentHigh = isHalfPointLine(prop.line) ? null : quotesAtPoint(outcomes, prop.player, prop.market, prop.line + 0.5);
      candidates.push(priceMarketProp(prop, quotes, adjacentLow, adjacentHigh, args.now));
    }
  }
  return {
    candidates,
    requests,
    credits,
    cacheHits,
    providerErrors,
    groupsConsidered: groups.length,
    groupsRequested: chosen.length,
    truncated,
  };
}

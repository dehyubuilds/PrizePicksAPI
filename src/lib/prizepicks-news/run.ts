import fs from "fs";
import path from "path";
import { fetchPrizePicksProjections } from "@/lib/prizepicks/client";
import type { PrizePicksProjection } from "@/lib/prizepicks/types";
import { fetchOdds, oddsApiKey, parseEventOdds, parseEvents, type OddsResponse } from "@/lib/prizepicks-odds/client";
import type { BookQuote } from "@/lib/prizepicks-odds/consensus";
import { eventMatchesTeams } from "@/lib/prizepicks-odds/teams";
import { exceedsCreditBudget, alternateMarket, normalizePlayerName, primaryMarketKey, sportKeyForLeague } from "@/lib/prizepicks-odds/markets";
import { isHalfPointLine } from "@/lib/prizepicks-odds/probability";
import { usdPerResearch } from "@/lib/prizepicks-odds/research";
import { callGrokResponses, grokConfigured, isGrokTimeoutError, type GrokToolUsage } from "@/lib/xai/client";
import { indexBoard } from "./board";
import { DISCOVERY_INSTRUCTIONS, discoveryInput, discoveryTasks, parseDiscoveredEvents } from "./discover";
import { annotateCandidate, buildShortlist, discoverMarketCandidates, mergeCandidates } from "./market-discover";
import { diagnoseOdds } from "./odds-check";
import { emptyFunnel, splitCandidates, writeNewsReport } from "./report";
import { DEFAULT_MAX_EVENTS, DEFAULT_MAX_ODDS_CREDITS, MAX_GROK_CALLS, SOURCE_HANDLES, resolveNewsSports, type NewsSport } from "./scope";
import type { Candidate, IndexedProp, NewsEvent, NewsReport, SlateGame } from "./types";
import { candidatesFromEvents, decideVerdict, toCandidate } from "./verdict";

export type DiscoveryMode = "hybrid" | "news" | "market";

export type NewsOptions = {
  sports?: string[];
  estimate?: boolean;
  dryRun?: boolean;
  maxEvents?: number;
  maxGrokSpend?: number;
  maxOddsCredits?: number;
  checkOdds?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  discoveryMode?: DiscoveryMode;
  minCandidates?: number;
  alwaysMarketPass?: boolean;
  maxMarketEvents?: number;
  maxMarketRequests?: number;
  targetPicks?: number;
  maxMarketGrokChecks?: number;
};

export type NewsDeps = {
  now?: Date;
  projections?: PrizePicksProjection[];
  researchSport?: (sport: NewsSport, games: SlateGame[]) => Promise<unknown>;
  fetchOdds?: typeof fetchOdds;
  root?: string;
  write?: boolean;
};

const CACHE_MS = 6 * 60 * 60 * 1000;

export function parseNewsArgs(argv: string[]): NewsOptions {
  const opts: NewsOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--estimate") opts.estimate = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--max-events" && argv[i + 1]) opts.maxEvents = Number(argv[++i]);
    else if (arg === "--max-grok-spend" && argv[i + 1]) opts.maxGrokSpend = Number(argv[++i]);
    else if (arg === "--max-odds-credits" && argv[i + 1]) opts.maxOddsCredits = Number(argv[++i]);
    else if (arg === "--check-odds") opts.checkOdds = true;
    else if (arg === "--verbose") opts.verbose = true;
    else if (arg === "--always-market-pass") opts.alwaysMarketPass = true;
    else if (arg === "--mode" && argv[i + 1]) {
      const mode = argv[++i];
      if (mode !== "hybrid" && mode !== "news" && mode !== "market") throw new Error(`Unknown mode: ${mode}`);
      opts.discoveryMode = mode;
    } else if (arg === "--min-candidates" && argv[i + 1]) opts.minCandidates = Number(argv[++i]);
    else if (arg === "--max-market-events" && argv[i + 1]) opts.maxMarketEvents = Number(argv[++i]);
    else if (arg === "--max-market-requests" && argv[i + 1]) opts.maxMarketRequests = Number(argv[++i]);
    else if (arg === "--target-picks" && argv[i + 1]) opts.targetPicks = Number(argv[++i]);
    else if (arg === "--max-market-grok-checks" && argv[i + 1]) opts.maxMarketGrokChecks = Number(argv[++i]);
    else if ((arg === "--sports" || arg === "--sport") && argv[i + 1]) {
      opts.sports = argv[++i].split(",").map((sport) => sport.trim()).filter(Boolean);
    }     else throw new Error(`Unknown argument: ${arg}`);
  }
  opts.discoveryMode ??= "hybrid";
  return opts;
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

function grokAllowed(options: NewsOptions, calls: number): { ok: boolean; note: string } {
  const unit = usdPerResearch();
  if (options.maxGrokSpend != null && options.maxGrokSpend <= 0) return { ok: false, note: "Grok spend cap is zero." };
  if (options.maxGrokSpend != null && unit == null) {
    return { ok: false, note: "Set XAI_USD_PER_RESEARCH before --max-grok-spend can allow calls." };
  }
  if (options.maxGrokSpend != null && unit != null && calls * unit > options.maxGrokSpend) {
    return { ok: false, note: "The next Grok call would pass the spend cap." };
  }
  return { ok: true, note: unit == null ? `Grok dollar cost is unavailable. The call cap is ${MAX_GROK_CALLS}, and a timeout still counts.` : `Grok price is $${unit} per call.` };
}

export function researchAttempt(attempt: number): { maxTurns: number; tools: Array<{ type: string }>; gameLimit: number; timeoutMs: number } {
  if (attempt > 0) return { maxTurns: 1, tools: [{ type: "web_search" }], gameLimit: 3, timeoutMs: 45_000 };
  return { maxTurns: 2, tools: [{ type: "web_search" }, { type: "x_search" }], gameLimit: 8, timeoutMs: 80_000 };
}

async function cachedResearch(
  sport: NewsSport,
  games: SlateGame[],
  task: { id: string; focus: string },
  now: Date,
  root: string,
  research: NewsDeps["researchSport"],
  attempt: number
): Promise<{ payload: unknown; fromCache: boolean; toolUsage: GrokToolUsage | null }> {
  const plan = researchAttempt(attempt);
  const file = path.join(root, "grok-cache", `${sport}-${task.id}-${now.toISOString().slice(0, 10)}.json`);
  if (attempt === 0 && fs.existsSync(file)) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, "utf8")) as { savedAt?: number; payload?: unknown };
      if (saved.savedAt && now.getTime() - saved.savedAt < CACHE_MS) return { payload: saved.payload, fromCache: true, toolUsage: null };
    } catch {
      // refetch
    }
  }
  const slate = games.slice(0, plan.gameLimit);
  const focus = attempt === 0 ? task.focus : `${task.focus} Use one short web search. Return empty events if you cannot verify a URL.`;
  const result = research
    ? { parsed: await research(sport, slate), toolUsage: null as GrokToolUsage | null }
    : await callGrokResponses({
        instructions: DISCOVERY_INSTRUCTIONS,
        input: discoveryInput(sport, slate, focus),
        timeoutMs: plan.timeoutMs,
        maxTurns: plan.maxTurns,
        tools: plan.tools,
      });
  const payload = "parsed" in result ? result.parsed : result;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ savedAt: now.getTime(), payload })}\n`);
  return { payload, fromCache: false, toolUsage: result.toolUsage };
}

export async function runPrizePicksNews(options: NewsOptions = {}, deps: NewsDeps = {}): Promise<NewsReport> {
  const startedAt = (deps.now ?? new Date()).toISOString();
  const sports = resolveNewsSports(options.sports);
  if (options.checkOdds) {
    const text = await diagnoseOdds({ maxOddsCredits: options.maxOddsCredits ?? 0, fetchImpl: deps.fetchOdds });
    if (options.verbose) console.error(text);
    const report: NewsReport = {
      startedAt,
      endedAt: new Date().toISOString(),
      mode: "check-odds",
      discoveryMode: options.discoveryMode,
      live: false,
      sportsChecked: sports,
      eligibleGames: 0,
      sourcesQueried: [],
      newsEventsDiscovered: 0,
      uniqueEvents: 0,
      affectedPlayers: 0,
      propsMatched: 0,
      oddsRequests: 0,
      oddsCredits: 0,
      grokCalls: 0,
      grokCostUsd: null,
      budgetNote: text,
      funnel: emptyFunnel(),
      stories: [],
      rejected: [],
    };
    if (deps.write !== false) writeNewsReport(report, [], deps.root);
    return report;
  }
  const mode = options.estimate ? "estimate" : options.dryRun ? "dry-run" : "live";
  const discoveryMode = options.discoveryMode ?? "news";
  const maxEvents = Number.isFinite(options.maxEvents) ? Math.max(0, options.maxEvents ?? DEFAULT_MAX_EVENTS) : DEFAULT_MAX_EVENTS;
  const maxOdds = Number.isFinite(options.maxOddsCredits) ? Math.max(0, options.maxOddsCredits ?? DEFAULT_MAX_ODDS_CREDITS) : DEFAULT_MAX_ODDS_CREDITS;
  if (mode === "live") {
    const missing = [
      discoveryMode === "market" || grokConfigured() ? "" : "XAI_API_KEY",
      oddsApiKey() ? "" : "THE_ODDS_API_KEY",
    ].filter(Boolean);
    if (missing.length) throw new Error(`Missing ${missing.join(" and ")}. Estimate and dry-run do not need them.`);
  }
  const board = deps.projections
    ? { projections: deps.projections }
    : await fetchPrizePicksProjections({ forceLive: mode === "live", disallowCacheFallback: false });
  const indexed = indexBoard(board.projections, sports, startedAt);
  const gamesBySport = new Map<NewsSport, SlateGame[]>();
  for (const game of indexed.games) {
    const list = gamesBySport.get(game.sport) ?? [];
    list.push(game);
    gamesBySport.set(game.sport, list);
  }
  const activeSports = sports.filter((sport) => (gamesBySport.get(sport) ?? []).length);
  const grokPlan = grokAllowed(options, 1);
  const note = [
    grokPlan.note,
    `Odds credits stop at ${maxOdds}.`,
    indexed.rejectedMlb ? `${indexed.rejectedMlb} MLB props were ignored because they are not pitcher strikeouts.` : "",
  ].filter(Boolean).join(" ");

  if (mode !== "live") {
    const report: NewsReport = {
      startedAt,
      endedAt: new Date().toISOString(),
      mode,
      live: false,
      sportsChecked: sports,
      eligibleGames: indexed.games.length,
      sourcesQueried: activeSports.flatMap((sport) => SOURCE_HANDLES[sport]),
      newsEventsDiscovered: 0,
      uniqueEvents: 0,
      affectedPlayers: 0,
      propsMatched: 0,
      oddsRequests: 0,
      oddsCredits: 0,
      grokCalls: 0,
      grokCostUsd: null,
      budgetNote: `${note} No Grok or Odds API call was made. Discovery mode: ${discoveryMode}. Planned news searches: ${discoveryMode === "market" ? 0 : activeSports.reduce((sum, sport) => sum + discoveryTasks(sport).length, 0)}. Market groups on the board: ${discoveryMode === "news" ? 0 : indexed.games.length}.`,
      discoveryMode,
      funnel: emptyFunnel({ eligibleGames: indexed.games.length }),
      stories: [],
      rejected: [],
      propsScanned: indexed.props.length,
    };
    if (deps.write !== false) writeNewsReport(report, [], deps.root);
    return report;
  }

  const root = deps.root ?? path.resolve(process.cwd(), "tmp/prizepicks-news");
  const events: NewsEvent[] = [];
  const runNews = discoveryMode !== "market";
  let grokCalls = 0;
  let searchesAttempted = 0;
  let searchesCompleted = 0;
  let searchesTimedOut = 0;
  let rawNewsItems = 0;
  let webSearchCalls = 0;
  let xSearchCalls = 0;
  let usageExposed = false;
  let grokBlocked = grokPlan.note;
  let stoppedForCap = false;
  const log = (message: string) => {
    if (options.verbose) console.error(`prizepicks-news: ${message}`);
  };
  if (runNews) sportLoop: for (const sport of activeSports) {
    for (const task of discoveryTasks(sport)) {
      if (grokCalls >= MAX_GROK_CALLS) {
        stoppedForCap = true;
        break sportLoop;
      }
      let tries = 0;
      while (tries < 2) {
        const next = grokAllowed(options, grokCalls + 1);
        if (!next.ok) {
          grokBlocked = next.note;
          tries = 2;
          break;
        }
        searchesAttempted += 1;
        log(`news query started ${sport} ${task.id}${tries ? " retry" : ""}`);
        try {
          const found = await cachedResearch(sport, gamesBySport.get(sport) ?? [], task, deps.now ?? new Date(), root, deps.researchSport, tries);
          if (!found.fromCache) grokCalls += 1;
          if (found.toolUsage?.webSearchCalls != null) {
            usageExposed = true;
            webSearchCalls += found.toolUsage.webSearchCalls;
            xSearchCalls += found.toolUsage.xSearchCalls ?? 0;
          }
          searchesCompleted += 1;
          const payloadRows = found.payload && typeof found.payload === "object" && Array.isArray((found.payload as { events?: unknown }).events)
            ? (found.payload as { events: unknown[] }).events.length
            : 0;
          rawNewsItems += payloadRows;
          events.push(...parseDiscoveredEvents(found.payload, sport, startedAt));
          log(`news query completed ${sport} ${task.id}${found.fromCache ? " from cache" : ""}`);
          break;
        } catch (err) {
          grokCalls += 1;
          tries += 1;
          const message = err instanceof Error ? err.message : "Grok research failed.";
          if (isGrokTimeoutError(err) && tries < 2 && grokCalls < MAX_GROK_CALLS) {
            searchesTimedOut += 1;
            log(`news query timed out ${sport} ${task.id}; retrying a shorter web-only search`);
            continue;
          }
          if (isGrokTimeoutError(err)) searchesTimedOut += 1;
          grokBlocked = `${grokBlocked} ${sport} ${task.id}: ${message}`.trim();
          log(`news query failed ${sport} ${task.id}`);
          break;
        }
      }
    }
  }
  const deduped = dedupeById(events);
  const limited = capEvents(deduped, maxEvents);
  const pending = candidatesFromEvents(limited, indexed.props, startedAt);
  const priced = await priceCandidates(pending, limited, indexed.props, startedAt, maxOdds, deps.fetchOdds ?? fetchOdds);
  const newsRows = priced.candidates.map((row) => ({ ...row, discoveryMethod: "NEWS" as const }));
  const qualified = newsRows.filter((row) => row.marketProbability != null && (row.pricingMethod === "half_point" || row.pricingMethod === "adjacent_half_points")).length;
  const wantMarket = discoveryMode === "market" || (discoveryMode === "hybrid" && (Boolean(options.alwaysMarketPass) || qualified < (options.minCandidates ?? 5)));
  const market = wantMarket
    ? await discoverMarketCandidates({
        props: indexed.props,
        now: startedAt,
        maxEvents: options.maxMarketEvents ?? 10,
        maxRequests: options.maxMarketRequests ?? 20,
        maxCredits: maxOdds,
        creditsUsed: priced.credits,
        fetchOdds: deps.fetchOdds,
        log: options.verbose ? (message) => console.error(`prizepicks-news: ${message}`) : undefined,
      })
    : { candidates: [], requests: 0, credits: 0, cacheHits: 0, providerErrors: 0, groupsConsidered: 0, groupsRequested: 0, truncated: false };
  const combined = mergeCandidates([...newsRows, ...market.candidates]).map((row) => annotateCandidate(row));
  const { stories, rejected } = splitCandidates(combined);
  const shortlist = buildShortlist(combined, options.targetPicks ?? 5);
  const oddsRequests = priced.requests + market.requests;
  const oddsCredits = priced.credits + market.credits;
  const unit = usdPerResearch();
  const report: NewsReport = {
    startedAt,
    endedAt: new Date().toISOString(),
    mode,
    live: true,
    sportsChecked: sports,
    eligibleGames: indexed.games.length,
    sourcesQueried: activeSports.flatMap((sport) => SOURCE_HANDLES[sport]),
    newsEventsDiscovered: rawNewsItems,
    uniqueEvents: limited.length,
    affectedPlayers: new Set(combined.map((row) => `${row.sport}:${row.player}`)).size,
    propsMatched: combined.filter((row) => row.projectionId).length,
    oddsRequests,
    oddsCredits,
    grokCalls,
    grokCostUsd: unit == null ? null : Math.round(grokCalls * unit * 100) / 100,
    budgetNote: [
      grokBlocked,
      stoppedForCap ? `Call cap ${MAX_GROK_CALLS} reached; remaining searches were not started.` : "",
      usageExposed ? `Provider tool counts, not a dollar price: ${webSearchCalls} web searches, ${xSearchCalls} X searches.` : "Provider tool counts were not exposed. Dollar cost is unknown.",
      priced.truncated || market.truncated ? "Odds credit budget or the market-request cap stopped further sportsbook calls." : "",
      wantMarket ? `Market groups considered ${market.groupsConsidered}, requested ${market.groupsRequested}.` : "Market-first pass was not run.",
      unit == null ? "Grok dollar cost is unknown. Timed-out calls still count toward the call cap." : "",
    ].filter(Boolean).join(" "),
    funnel: emptyFunnel({
      eligibleGames: indexed.games.length,
      newsSearchesAttempted: searchesAttempted,
      newsSearchesCompleted: searchesCompleted,
      newsSearchesTimedOut: searchesTimedOut,
      newsItemsDiscovered: rawNewsItems,
      newsItemsDeduplicated: deduped.length,
      newsItemsRetained: limited.length,
      affectedPlayers: new Set(combined.map((row) => `${row.sport}:${row.player}`)).size,
      propsMatched: combined.filter((row) => row.projectionId).length,
      halfPointProps: combined.filter((row) => row.thresholdType === "half_point").length,
      integerProps: combined.filter((row) => row.thresholdType === "integer").length,
      eligibleSportsbookRequests: oddsRequests,
      cacheHits: priced.cacheHits + market.cacheHits,
      providerRequestsAttempted: oddsRequests,
      providerRequestsCompleted: Math.max(0, oddsRequests - priced.providerErrors - market.providerErrors),
      providerErrors: priced.providerErrors + market.providerErrors,
      creditsConsumed: oddsCredits,
      candidatesPriced: combined.filter((row) => row.marketProbability != null || row.pricingMethod === "conditional_two_way" || row.pricingMethod === "adjacent_half_points").length,
      candidatesUnpriced: combined.filter((row) => row.marketProbability == null && row.pricingMethod !== "adjacent_half_points").length,
      storiesGenerated: stories.length,
      supportedOpportunities: stories.filter((row) => row.verdict === "supported_opportunity").length,
    }),
    stories,
    rejected,
    discoveryMode,
    propsScanned: indexed.props.length,
    marketGroupsConsidered: market.groupsConsidered,
    marketGroupsRequested: market.groupsRequested,
    shortlist,
    tierA: combined.filter((row) => row.tier === "A").length,
    tierB: combined.filter((row) => row.tier === "B").length,
    tierC: combined.filter((row) => row.tier === "C").length,
    lanes: {
      news: combined.filter((row) => row.discoveryMethod === "NEWS").length,
      market: combined.filter((row) => row.discoveryMethod === "MARKET").length,
      both: combined.filter((row) => row.discoveryMethod === "BOTH").length,
    },
  };
  if (deps.write !== false) writeNewsReport(report, limited, root);
  return report;
}

function dedupeById(events: NewsEvent[]): NewsEvent[] {
  const seen = new Set<string>();
  const unique: NewsEvent[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    unique.push(event);
  }
  return unique;
}

function capEvents(events: NewsEvent[], max: number): NewsEvent[] {
  const buckets = new Map<string, NewsEvent[]>();
  for (const event of events) {
    const list = buckets.get(event.sport) ?? [];
    list.push(event);
    buckets.set(event.sport, list);
  }
  const chosen: NewsEvent[] = [];
  let added = true;
  while (chosen.length < max && added) {
    added = false;
    for (const sport of Array.from(buckets.keys())) {
      const next = buckets.get(sport)?.shift();
      if (!next) continue;
      chosen.push(next);
      added = true;
      if (chosen.length >= max) break;
    }
  }
  return chosen;
}

async function priceCandidates(
  pending: Candidate[],
  events: NewsEvent[],
  props: IndexedProp[],
  now: string,
  maxOdds: number,
  fetchOddsImpl: typeof fetchOdds
): Promise<{ candidates: Candidate[]; requests: number; credits: number; truncated: boolean; cacheHits: number; providerErrors: number }> {
  const byEvent = new Map(events.map((event) => [event.id, event]));
  const propById = new Map(props.map((prop) => [prop.projectionId, prop]));
  const groups = new Map<string, { sportKey: string; prop: IndexedProp; rows: Candidate[] }>();
  const done: Candidate[] = [];
  for (const row of pending) {
    const event = byEvent.get(row.eventId);
    const prop = row.projectionId ? propById.get(row.projectionId) : undefined;
    if (!event || !prop) {
      done.push(row);
      continue;
    }
    const early = decideVerdict({ now, event, prop, quotes: null });
    if (early.verdict === "expired") {
      done.push(toCandidate(event, prop.player, prop, early));
      continue;
    }
    const sportKey = prop.oddsSportKey || sportKeyForLeague(prop.sport);
    if (!sportKey) {
      done.push(toCandidate(event, prop.player, prop, { ...early, verdict: "insufficient_data", reason: "No Odds API sport key." }));
      continue;
    }
    const key = `${sportKey}:${prop.gameId}`;
    const group = groups.get(key) ?? { sportKey, prop, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }

  let credits = 0;
  let requests = 0;
  let cacheHits = 0;
  let providerErrors = 0;
  let truncated = false;
  const eventsListed = new Set<string>();
  const oddsEvents = new Map<string, { id: string; home_team: string; away_team: string }[]>();
  for (const group of Array.from(groups.values())) {
    if (eventsListed.has(group.sportKey)) continue;
    if (exceedsCreditBudget(credits, 1, maxOdds)) {
      truncated = true;
      break;
    }
    eventsListed.add(group.sportKey);
    let listed;
    try {
      listed = await fetchOddsImpl(`/sports/${group.sportKey}/events`, `events_${group.sportKey}`);
    } catch {
      providerErrors += 1;
      truncated = true;
      break;
    }
    requests += 1;
    if (listed.fromCache) cacheHits += 1;
    if (!listed.fromCache) credits += listed.lastCost ?? 1;
    oddsEvents.set(group.sportKey, parseEvents(listed.json));
  }

  const quotesByGroup = new Map<string, ReturnType<typeof parseEventOdds>>();
  const groupErrors = new Map<string, string>();
  for (const [key, group] of Array.from(groups.entries())) {
    const markets = new Set<string>();
    for (const row of group.rows) {
      if (!row.market) continue;
      markets.add(row.market);
      const prop = row.projectionId ? propById.get(row.projectionId) : undefined;
      if (prop && !isHalfPointLine(prop.line)) {
        const alt = alternateMarket(prop.sport, prop.market);
        if (alt) markets.add(alt);
      }
    }
    const marketList = Array.from(markets);
    const matched = (oddsEvents.get(group.sportKey) ?? []).find((game) =>
      eventMatchesTeams({ team: group.prop.team, opponent: group.prop.opponent, home: game.home_team, away: game.away_team })
    );
    if (!matched || !marketList.length) {
      if (marketList.length && !truncated) groupErrors.set(key, "Event not available: no Odds API game matched these teams.");
      continue;
    }
    if (truncated || exceedsCreditBudget(credits, marketList.length, maxOdds)) {
      truncated = true;
      continue;
    }
    const query = marketList.join(",");
    let response: OddsResponse;
    try {
      response = await fetchOddsImpl(
        `/sports/${group.sportKey}/events/${matched.id}/odds?regions=us&oddsFormat=american&markets=${encodeURIComponent(query)}`,
        `odds_${matched.id}_${query}`
      );
    } catch (err) {
      providerErrors += 1;
      groupErrors.set(key, err instanceof Error ? err.message : "Odds request failed.");
      continue;
    }
    requests += 1;
    if (response.fromCache) cacheHits += 1;
    if (!response.fromCache) credits += response.lastCost ?? marketList.length;
    quotesByGroup.set(key, parseEventOdds(response.json));
  }

  for (const [key, group] of Array.from(groups.entries())) {
    const outcomes = quotesByGroup.get(key) ?? [];
    const blocked = !quotesByGroup.has(key);
    for (const row of group.rows) {
      const event = byEvent.get(row.eventId)!;
      const prop = propById.get(row.projectionId!)!;
      const quotes = blocked ? null : quotesAtPoint(outcomes, prop.player, prop.market, prop.line);
      const adjacentLow = blocked || isHalfPointLine(prop.line) ? null : quotesAtPoint(outcomes, prop.player, prop.market, prop.line - 0.5);
      const adjacentHigh = blocked || isHalfPointLine(prop.line) ? null : quotesAtPoint(outcomes, prop.player, prop.market, prop.line + 0.5);
      done.push(toCandidate(event, prop.player, prop, decideVerdict({
        now,
        event,
        prop,
        quotes,
        adjacentLow,
        adjacentHigh,
        budgetExhausted: blocked && truncated && !groupErrors.has(key),
        providerError: groupErrors.get(key) ?? null,
      })));
    }
  }
  return { candidates: done, requests, credits, truncated, cacheHits, providerErrors };
}

export function formatNewsSummary(report: NewsReport): string {
  const lines = [
    `PrizePicks research (${report.discoveryMode ?? "news"}, ${report.mode})`,
    `Sports: ${report.sportsChecked.join(", ")}`,
    `Eligible games: ${report.eligibleGames}`,
    `Props scanned: ${report.propsScanned ?? 0}`,
    `Unique news events: ${report.uniqueEvents}`,
    `Props matched: ${report.propsMatched}`,
    `Grok calls: ${report.grokCalls}`,
    `Odds credits: ${report.oddsCredits}`,
    `Tiers A/B/C: ${report.tierA ?? 0}/${report.tierB ?? 0}/${report.tierC ?? 0}`,
    `Lanes news/market/both: ${report.lanes?.news ?? 0}/${report.lanes?.market ?? 0}/${report.lanes?.both ?? 0}`,
    report.budgetNote,
  ];
  for (const row of report.shortlist ?? []) {
    lines.push(`Shortlist ${row.tier} ${row.sport} ${row.player} ${row.line} ${row.stat}: ${row.marketProbability ?? "unpriced"}% ${row.pricingSide ?? ""} — ${row.discoveryMethod}`);
  }
  for (const story of report.stories) {
    lines.push(`${story.sport} ${story.player}: ${story.verdict.replaceAll("_", " ")} — ${story.reason}`);
  }
  for (const row of report.rejected) {
    lines.push(`Rejected ${row.sport} ${row.player}: ${row.rejectionCode ?? row.verdict} — ${row.reason}`);
  }
  if (!report.stories.length && !report.rejected.length) lines.push(report.live ? "No research story cleared the evidence bar." : "Paid research was not run.");
  return lines.join("\n");
}

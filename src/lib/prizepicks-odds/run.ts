import fs from "fs";
import path from "path";
import { fetchPrizePicksProjections } from "@/lib/prizepicks/client";
import type { PrizePicksProjection } from "@/lib/prizepicks/types";
import { fetchOdds, parseEventOdds, parseEvents, type ParsedOutcome } from "./client";
import { agreedBookLine, fairFromBooks, priceSides, type BookQuote, type PointQuote } from "./consensus";
import { buildDailyReport, formatDailyReport } from "./daily";
import { alternateMarket, exceedsCreditBudget, marketForStat, normalizePlayerName, primaryMarketKey, resolveOddsSports, sportKeyForLeague } from "./markets";
import { publishDailyPicks, publishOddsBoard } from "./publish-page";
import { formatBacktest, readSettlements } from "./backtest";
import { gapSentence, selectBiggestGaps, type OddsLeg, DEFAULT_MAX_LEGS, DEFAULT_MIN_EDGE } from "./select";
import { readLatestSnapshot, writeSnapshot } from "./snapshots";
import { evaluateProp, propIdentity, type ScanPropInput } from "./evaluate";
import { dailyResearchPlan, grokSpendBlocked, researchShortlist, selectResearchTargets, usdPerResearch, type ResearchFinding } from "./research";
import { scoreSettlements } from "./scoring";
import { formatSettle, settleStoredSnapshots } from "./settle";
import { writeDailyArtifacts } from "./report-store";
import { eventMatchesTeams } from "./teams";

const RESULT_FILE = path.resolve(process.cwd(), "tmp/prizepicks-odds/latest.json");

export type OddsCliOptions = {
  count?: number;
  minEdge?: number;
  estimate?: boolean;
  json?: boolean;
  noPublish?: boolean;
  sports?: string[];
  mode?: "disagreement" | "daily" | "entries" | "backtest" | "recheck" | "settle";
  rank?: "probability" | "ev" | "entry" | "opportunity" | "confidence";
  countPerSport?: number;
  maxCredits?: number;
  research?: "none" | "grok" | "auto";
  maxGrokCandidates?: number;
  maxGrokSpend?: number;
  minProbability?: number;
  minBooks?: number;
  maxQuoteAgeMinutes?: number;
  maxDisagreement?: number;
  maxPicks?: number;
  verbose?: boolean;
};

type PlannedProp = PrizePicksProjection & { market: string; sportKey: string; league: string; oddsEventId?: string };

function logStep(message: string): void {
  console.error(`prizepicks-odds: ${message}`);
}

function leagueOf(projection: PrizePicksProjection): string {
  return projection.leagueName.trim().toUpperCase();
}

function quoteKey(player: string, market: string, point: number): string {
  return `${normalizePlayerName(player)}|${market}|${point}`;
}

function propKey(player: string, market: string): string {
  return `${normalizePlayerName(player)}|${market}`;
}

function quotesFromOutcomes(rows: ParsedOutcome[]): {
  byPoint: Map<string, BookQuote[]>;
  byProp: Map<string, PointQuote[]>;
} {
  const paired = new Map<string, Map<string, { over?: number; under?: number; lastUpdate?: string }>>();
  for (const row of rows) {
    const key = quoteKey(row.player, row.market, row.point);
    const books = paired.get(key) ?? new Map();
    const quote = books.get(row.book) ?? {};
    if (row.side === "over") quote.over = row.price;
    else quote.under = row.price;
    if (row.lastUpdate) quote.lastUpdate = row.lastUpdate;
    books.set(row.book, quote);
    paired.set(key, books);
  }
  const byPoint = new Map<string, BookQuote[]>();
  const byProp = new Map<string, PointQuote[]>();
  for (const [key, books] of paired) {
    const quotes: BookQuote[] = [];
    const point = Number(key.slice(key.lastIndexOf("|") + 1));
    const prop = key.slice(0, key.lastIndexOf("|"));
    for (const [book, quote] of books) {
      if (quote.over == null || quote.under == null) continue;
      quotes.push({ book, overPrice: quote.over, underPrice: quote.under, lastUpdate: quote.lastUpdate });
      const list = byProp.get(prop) ?? [];
      list.push({ book, overPrice: quote.over, underPrice: quote.under, point, lastUpdate: quote.lastUpdate });
      byProp.set(prop, list);
    }
    if (quotes.length) byPoint.set(key, quotes);
  }
  return { byPoint, byProp };
}

function legsFromProps(
  props: PlannedProp[],
  quotes: { byPoint: Map<string, BookQuote[]>; byProp: Map<string, PointQuote[]> }
): OddsLeg[] {
  const legs: OddsLeg[] = [];
  for (const prop of props) {
    const stat = prop.statDisplayName || prop.statType;
    const found = quotes.byPoint.get(quoteKey(prop.playerName, prop.market, prop.lineScore));
    const fair = found ? fairFromBooks(found) : null;
    if (fair) {
      for (const priced of priceSides({ fair, oddsType: prop.oddsType })) {
        const sideLabel = priced.side === "over" ? "Over" : "Under";
        legs.push({
          sport: prop.league,
          player: prop.playerName,
          stat,
          line: prop.lineScore,
          side: priced.side,
          edge: priced.edge,
          fairPct: priced.fairPct,
          ppPct: priced.ppPct,
          books: fair.books,
          oddsType: prop.oddsType,
          projectionId: prop.id,
          bookLine: `${prop.playerName} ${sideLabel} ${prop.lineScore} ${stat}`,
          gapKind: "price",
        });
      }
      continue;
    }
    if (prop.oddsType.trim().toLowerCase() !== "standard") continue;
    const agreed = agreedBookLine(quotes.byProp.get(propKey(prop.playerName, prop.market)) ?? []);
    if (!agreed) continue;
    const side = agreed.point > prop.lineScore ? "over" : "under";
    const sideLabel = side === "over" ? "Over" : "Under";
    legs.push({
      sport: prop.league,
      player: prop.playerName,
      stat,
      line: prop.lineScore,
      side,
      edge: Math.round(Math.abs(prop.lineScore - agreed.point) * 10) / 10,
      fairPct: 0,
      ppPct: 0,
      books: agreed.books,
      oddsType: prop.oddsType,
      projectionId: prop.id,
      bookLine: `${prop.playerName} ${sideLabel} ${prop.lineScore} ${stat}`,
      gapKind: "line",
      bookPoint: agreed.point,
    });
  }
  return legs;
}

export function formatOddsBoard(params: {
  legs: OddsLeg[];
  minEdge: number;
  creditsSpent: number;
  remaining: number | null;
  truncated: boolean;
}): string {
  const lines = [
    "SPORTSBOOK BOARD",
    `Biggest gaps vs PrizePicks, up to ${DEFAULT_MAX_LEGS}, any sport. Same-number floor +${params.minEdge}%.`,
    `Credits this run: ${params.creditsSpent}${params.remaining == null ? "" : ` · ${params.remaining} left this month`}`,
    "",
  ];
  if (!params.legs.length) {
    lines.push(`No prop was far enough from the sportsbook number to clear +${params.minEdge}%.`);
  } else {
    params.legs.forEach((leg, index) => {
      lines.push(`${index + 1}. ${leg.sport} ${leg.bookLine} (${leg.oddsType})`);
      lines.push(`   ${gapSentence(leg)}`);
    });
    lines.push("");
    lines.push(`${params.legs.length} prop${params.legs.length === 1 ? "" : "s"} cleared the bar.`);
  }
  if (params.truncated) {
    lines.push("Stopped because the Odds API monthly balance ran out.");
  }
  return lines.join("\n");
}

export async function runPrizePicksOddsCli(options: OddsCliOptions = {}): Promise<void> {
  const mode = options.mode ?? "disagreement";
  if (mode !== "disagreement" && mode !== "daily" && mode !== "entries" && mode !== "backtest" && mode !== "recheck" && mode !== "settle") {
    throw new Error("mode must be disagreement, daily, entries, backtest, recheck, or settle");
  }
  if (mode === "backtest") {
    console.log(formatBacktest());
    return;
  }
  if (mode === "settle") {
    logStep("settling completed snapshot props from ESPN box scores…");
    const settled = await settleStoredSnapshots();
    const text = formatSettle(settled);
    if (options.json) console.log(JSON.stringify(settled, null, 2));
    else console.log(text);
    return;
  }
  const minEdge = options.minEdge ?? DEFAULT_MIN_EDGE;
  const count = Math.min(DEFAULT_MAX_LEGS, Math.max(1, options.count ?? DEFAULT_MAX_LEGS));
  const sports = resolveOddsSports(options.sports);
  const wanted = new Set(sports);

  logStep("pulling PrizePicks board…");
  const board = await fetchPrizePicksProjections({ forceLive: true, disallowCacheFallback: false });
  const props: PlannedProp[] = [];
  for (const projection of board.projections) {
    if (projection.playerName.includes("+")) continue;
    const league = leagueOf(projection);
    if (!wanted.has(league)) continue;
    const sportKey = sportKeyForLeague(league);
    const market = marketForStat(league, projection.statDisplayName, projection.statType);
    if (!sportKey || !market) continue;
    props.push({ ...projection, market, sportKey, league });
  }

  const bySport = new Map<string, PlannedProp[]>();
  for (const prop of props) {
    const list = bySport.get(prop.sportKey) ?? [];
    list.push(prop);
    bySport.set(prop.sportKey, list);
  }
  logStep(`${props.length} comparable props across ${sports.join(", ")}`);

  if (options.estimate) {
    const games = new Set(props.map((prop) => `${prop.sportKey}:${prop.gameId}`)).size;
    const markets = new Set(props.map((prop) => prop.market)).size;
    const unit = usdPerResearch();
    const grokCap = options.maxGrokCandidates ?? 10;
    const grokLine =
      options.research === "grok"
        ? unit == null
          ? `Grok calls would be capped at ${grokCap}. Dollar cost is unavailable until XAI_USD_PER_RESEARCH is set. No xAI call is made.`
          : `Grok calls would be capped at ${grokCap}, about $${Math.round(grokCap * unit * 100) / 100} at the configured per-call price. No xAI call is made.`
        : "Grok research is off.";
    console.log(
      [
        `ESTIMATE ONLY — no sportsbook credits spent. Sports: ${sports.join(", ")}.`,
        `${games} PrizePicks games have a comparable prop. Listing those games costs about ${bySport.size} credits.`,
        "Prop lines are extra: one credit per market per game. Daily mode may add one credit per documented alternate market when the exact line is missing.",
        grokLine,
        "Run without --estimate after THE_ODDS_API_KEY is set.",
      ].join("\n")
    );
    return;
  }

  let spent = 0;
  let remaining: number | null = null;
  const matched: PlannedProp[] = [];
  const plans: Array<{ sportKey: string; eventId: string; markets: string[]; props: PlannedProp[] }> = [];

  for (const [sportKey, sportProps] of bySport) {
    if (remaining === 0 || exceedsCreditBudget(spent, 1, options.maxCredits)) break;
    logStep(`listing ${sportKey} games…`);
    const eventsResponse = await fetchOdds(`/sports/${sportKey}/events`, `events_${sportKey}`);
    if (!eventsResponse.fromCache) spent += eventsResponse.lastCost ?? 1;
    remaining = eventsResponse.remaining ?? remaining;
    const events = parseEvents(eventsResponse.json);
    const buckets = new Map<string, { markets: Set<string>; props: PlannedProp[] }>();
    for (const prop of sportProps) {
      const event = events.find((row) =>
        eventMatchesTeams({
          team: prop.team,
          opponent: prop.opponent,
          home: row.home_team,
          away: row.away_team,
        })
      );
      if (!event) continue;
      const bucket = buckets.get(event.id) ?? { markets: new Set<string>(), props: [] };
      bucket.markets.add(prop.market);
      bucket.props.push(prop);
      buckets.set(event.id, bucket);
    }
    for (const [eventId, bucket] of buckets) {
      plans.push({
        sportKey,
        eventId,
        markets: [...bucket.markets].slice(0, 6),
        props: bucket.props,
      });
    }
  }

  plans.sort((a, b) => b.props.length - a.props.length);
  let truncated = false;
  const allQuotes: { byPoint: Map<string, BookQuote[]>; byProp: Map<string, PointQuote[]> } = {
    byPoint: new Map(),
    byProp: new Map(),
  };
  for (const plan of plans) {
    if (remaining === 0 || exceedsCreditBudget(spent, plan.markets.length, options.maxCredits)) {
      truncated = true;
      continue;
    }
    const marketQuery = plan.markets.join(",");
    logStep(`${plan.sportKey} ${plan.eventId} · ${plan.markets.length} markets…`);
    const response = await fetchOdds(
      `/sports/${plan.sportKey}/events/${plan.eventId}/odds?regions=us&oddsFormat=american&markets=${encodeURIComponent(marketQuery)}`,
      `odds_${plan.eventId}_${marketQuery}`
    );
    if (!response.fromCache) spent += response.lastCost ?? plan.markets.length;
    remaining = response.remaining ?? remaining;
    const quotes = quotesFromOutcomes(parseEventOdds(response.json));
    for (const [key, value] of quotes.byPoint) allQuotes.byPoint.set(key, value);
    for (const [key, value] of quotes.byProp) allQuotes.byProp.set(key, value);
    matched.push(...plan.props.map((prop) => ({ ...prop, oddsEventId: plan.eventId })));
  }

  if (mode === "daily" || mode === "entries" || mode === "recheck") {
    const alternates = await fetchMissingAlternates(matched, allQuotes, {
      spent,
      remaining,
      maxCredits: options.maxCredits,
    });
    spent = alternates.spent;
    remaining = alternates.remaining;
    truncated = truncated || alternates.truncated;
  }

  if (mode === "daily" || mode === "entries" || mode === "recheck") {
    const generatedAt = new Date().toISOString();
    const inputs = matched.map((prop) => toScanInput(prop, allQuotes));
    const research = await maybeResearch(inputs, generatedAt, options, mode);
    const refreshed = await refreshLineupQuotes(inputs, research.findings, allQuotes, {
      spent,
      remaining,
      maxCredits: options.maxCredits,
    });
    spent = refreshed.spent;
    remaining = refreshed.remaining;
    const report = buildDailyReport({
      generatedAt,
      props: inputs,
      creditsSpent: spent,
      remaining,
      rank: mode === "entries" ? "entry" : options.rank ?? "probability",
      countPerSport: options.countPerSport ?? 5,
      entryCount: count,
      previous: readLatestSnapshot(),
      findings: research.findings,
      grokCalls: research.calls,
      grokCostUsd: research.estimatedUsd,
      historical: scoreSettlements(readSettlements()),
      thresholds: {
        minProbability: options.minProbability,
        minBooks: options.minBooks,
        maxQuoteAgeMinutes: options.maxQuoteAgeMinutes,
        maxDisagreement: options.maxDisagreement,
        maxPicks: options.maxPicks,
      },
      researchNote: research.note,
      scanTruncated: truncated,
    });
    writeSnapshot(report.snapshot);
    let pageUrl: string | undefined;
    let cardUrl: string | undefined;
    if (!options.noPublish && (mode === "daily" || mode === "recheck")) {
      logStep("publishing share page…");
      const published = await publishDailyPicks(report);
      pageUrl = published.cdnUrl;
      cardUrl = published.cardUrl;
    }
    const text = [
      mode === "recheck" ? "RECHECK" : "",
      formatDailyReport(report),
      pageUrl,
      cardUrl ? `Share image: ${cardUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    writeDailyArtifacts(report, text);
    if (options.json) {
      console.log(JSON.stringify({ picks: report.picks, exclusions: report.exclusions, researchNote: report.researchNote, creditsSpent: report.creditsSpent, pageUrl, cardUrl }, null, 2));
    } else console.log(text);
    return;
  }

  const legs = selectBiggestGaps(legsFromProps(matched, allQuotes), count, minEdge);
  const generatedAt = new Date().toISOString();
  let pageUrl: string | undefined;
  if (!options.noPublish) {
    logStep("publishing S3 page…");
    const published = await publishOddsBoard({
      generatedAt,
      minEdge,
      creditsSpent: spent,
      remaining,
      truncated,
      legs,
    });
    pageUrl = published.cdnUrl;
  }
  const text = [formatOddsBoard({ legs, minEdge, creditsSpent: spent, remaining, truncated }), pageUrl]
    .filter(Boolean)
    .join("\n");
  fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
  fs.writeFileSync(
    RESULT_FILE,
    `${JSON.stringify({ generatedAt, creditsSpent: spent, remaining, truncated, pageUrl, legs }, null, 2)}\n`
  );

  if (options.json) {
    console.log(JSON.stringify({ creditsSpent: spent, remaining, truncated, pageUrl, legs }, null, 2));
    return;
  }
  console.log(text);
}

function toScanInput(
  prop: PlannedProp,
  quotes: { byPoint: Map<string, BookQuote[]>; byProp: Map<string, PointQuote[]> }
): ScanPropInput {
  return {
    id: prop.id,
    playerName: prop.playerName,
    team: prop.team,
    opponent: prop.opponent,
    league: prop.league,
    stat: prop.statDisplayName || prop.statType,
    market: prop.market,
    line: prop.lineScore,
    oddsType: prop.oddsType,
    startTime: prop.startTime,
    gameId: prop.gameId,
    updatedAt: prop.updatedAt,
    quotes: quotes.byPoint.get(quoteKey(prop.playerName, prop.market, prop.lineScore)) ?? [],
    otherLines: quotes.byProp.get(propKey(prop.playerName, prop.market)) ?? [],
    oddsEventId: prop.oddsEventId,
    sportKey: prop.sportKey,
  };
}

function mergeQuotes(
  into: { byPoint: Map<string, BookQuote[]>; byProp: Map<string, PointQuote[]> },
  extra: { byPoint: Map<string, BookQuote[]>; byProp: Map<string, PointQuote[]> }
): void {
  for (const [key, rows] of extra.byPoint) {
    const current = into.byPoint.get(key) ?? [];
    const seen = new Set(current.map((quote) => quote.book));
    into.byPoint.set(key, [...current, ...rows.filter((quote) => !seen.has(quote.book))]);
  }
  for (const [key, rows] of extra.byProp) {
    const current = into.byProp.get(key) ?? [];
    const seen = new Set(current.map((quote) => `${quote.book}|${quote.point}`));
    into.byProp.set(
      key,
      [...current, ...rows.filter((quote) => !seen.has(`${quote.book}|${quote.point}`))]
    );
  }
}

async function fetchMissingAlternates(
  matched: PlannedProp[],
  quotes: { byPoint: Map<string, BookQuote[]>; byProp: Map<string, PointQuote[]> },
  budget: { spent: number; remaining: number | null; maxCredits?: number }
): Promise<{ spent: number; remaining: number | null; truncated: boolean }> {
  const groups = new Map<string, { sportKey: string; eventId: string; markets: Set<string> }>();
  for (const prop of matched) {
    if (!prop.oddsEventId) continue;
    if (quotes.byPoint.has(quoteKey(prop.playerName, prop.market, prop.lineScore))) continue;
    const alt = alternateMarket(prop.league, prop.market);
    if (!alt) continue;
    const key = `${prop.sportKey}:${prop.oddsEventId}`;
    const group = groups.get(key) ?? { sportKey: prop.sportKey, eventId: prop.oddsEventId, markets: new Set<string>() };
    group.markets.add(alt);
    groups.set(key, group);
  }
  let spent = budget.spent;
  let remaining = budget.remaining;
  let truncated = false;
  for (const group of groups.values()) {
    const markets = [...group.markets];
    if (remaining === 0 || exceedsCreditBudget(spent, markets.length, budget.maxCredits)) {
      truncated = true;
      continue;
    }
    const marketQuery = markets.join(",");
    logStep(`${group.sportKey} ${group.eventId} · ${markets.length} alternate markets…`);
    const response = await fetchOdds(
      `/sports/${group.sportKey}/events/${group.eventId}/odds?regions=us&oddsFormat=american&markets=${encodeURIComponent(marketQuery)}`,
      `odds_alt_${group.eventId}_${marketQuery}`
    );
    if (!response.fromCache) spent += response.lastCost ?? markets.length;
    remaining = response.remaining ?? remaining;
    const rows = parseEventOdds(response.json).map((row) => ({ ...row, market: primaryMarketKey(row.market) }));
    mergeQuotes(quotes, quotesFromOutcomes(rows));
  }
  return { spent, remaining, truncated };
}

async function maybeResearch(
  inputs: ScanPropInput[],
  generatedAt: string,
  options: OddsCliOptions,
  mode: string
): Promise<{ findings: Record<string, ResearchFinding>; calls: number; estimatedUsd: number | null; note: string }> {
  const plan = dailyResearchPlan({ mode, research: options.research, maxGrokSpend: options.maxGrokSpend });
  if (!plan.run) return { findings: {}, calls: 0, estimatedUsd: null, note: plan.note };
  const blocked = grokSpendBlocked(plan.maxSpend);
  if (blocked) {
    logStep(blocked);
    return { findings: {}, calls: 0, estimatedUsd: null, note: blocked };
  }
  const evaluated = inputs.map((input) => evaluateProp(input, generatedAt));
  const targets = selectResearchTargets(evaluated, options.countPerSport ?? 5, options.maxGrokCandidates ?? 10);
  logStep(`asking grok about ${targets.length} shortlisted props…`);
  const result = await researchShortlist(targets, {
    maxSpend: plan.maxSpend,
    fetchPage: async (url) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) return null;
      return (await response.text()).slice(0, 20_000);
    },
  });
  const note = result.calls
    ? `Research ran on ${targets.length} shortlisted props. ${result.cacheHits} came from cache.`
    : plan.note;
  return { findings: result.findings, calls: result.calls, estimatedUsd: result.estimatedUsd, note };
}

async function refreshLineupQuotes(
  inputs: ScanPropInput[],
  findings: Record<string, ResearchFinding>,
  quotes: { byPoint: Map<string, BookQuote[]>; byProp: Map<string, PointQuote[]> },
  budget: { spent: number; remaining: number | null; maxCredits?: number }
): Promise<{ spent: number; remaining: number | null }> {
  const groups = new Map<string, { sportKey: string; eventId: string; markets: Set<string> }>();
  for (const input of inputs) {
    const finding = findings[propIdentity(input)];
    if (finding?.status !== "completed" || !input.oddsEventId || !input.sportKey) continue;
    const lineup = finding.research.marketExplanation.evidence.some(
      (row) => row.verificationStatus === "verified" && /lineup/i.test(row.claim)
    );
    if (!lineup) continue;
    const key = `${input.sportKey}:${input.oddsEventId}`;
    const group = groups.get(key) ?? { sportKey: input.sportKey, eventId: input.oddsEventId, markets: new Set<string>() };
    group.markets.add(input.market);
    groups.set(key, group);
  }
  let spent = budget.spent;
  let remaining = budget.remaining;
  for (const group of groups.values()) {
    const markets = [...group.markets].slice(0, 6);
    if (remaining === 0 || exceedsCreditBudget(spent, markets.length, budget.maxCredits)) {
      logStep("lineup change noted; quote refresh skipped because the credit budget is spent");
      continue;
    }
    const marketQuery = markets.join(",");
    logStep(`refreshing ${group.eventId} after a lineup note…`);
    const response = await fetchOdds(
      `/sports/${group.sportKey}/events/${group.eventId}/odds?regions=us&oddsFormat=american&markets=${encodeURIComponent(marketQuery)}`,
      `odds_refresh_${group.eventId}_${marketQuery}_${Date.now()}`
    );
    if (!response.fromCache) spent += response.lastCost ?? markets.length;
    remaining = response.remaining ?? remaining;
    mergeQuotes(quotes, quotesFromOutcomes(parseEventOdds(response.json)));
  }
  for (const input of inputs) {
    input.quotes = quotes.byPoint.get(quoteKey(input.playerName, input.market, input.line)) ?? input.quotes;
    input.otherLines = quotes.byProp.get(propKey(input.playerName, input.market)) ?? input.otherLines;
  }
  return { spent, remaining };
}

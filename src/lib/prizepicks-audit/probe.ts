import type { OddsResponse } from "@/lib/prizepicks-odds/client";
import { parseEventOdds, parseEvents } from "@/lib/prizepicks-odds/client";
import { exceedsCreditBudget, marketForStat, normalizePlayerName } from "@/lib/prizepicks-odds/markets";
import { estimateAtLine, isHalfPointLine } from "@/lib/prizepicks-odds/probability";
import { eventMatchesTeams } from "@/lib/prizepicks-odds/teams";
import { PRIZEPICKS_LEAGUE_NAMES } from "@/lib/prizepicks/leagues";
import type { PrizePicksProjection } from "@/lib/prizepicks/types";
import { priceIntegerFromAdjacent } from "@/lib/prizepicks-news/integer-price";
import { classifyComparison } from "./compare";
import type { CategoryRecord, InefficiencyObservation } from "./types";

type FetchOdds = (pathAndQuery: string, cacheKey: string) => Promise<OddsResponse>;

export async function probeMarkets(args: {
  categories: CategoryRecord[];
  projections: PrizePicksProjection[];
  sportsListed: Map<string, string>;
  fetchOdds: FetchOdds;
  nowIso: string;
  maxCredits: number;
  maxCategories: number;
}): Promise<{ observations: InefficiencyObservation[]; returned: Map<string, string[]>; credits: number; requests: number; creditsByCategory: Map<string, number> }> {
  const returned = new Map<string, string[]>();
  const observations: InefficiencyObservation[] = [];
  const creditsByCategory = new Map<string, number>();
  const eventsBySport = new Map<string, ReturnType<typeof parseEvents>>();
  let credits = 0;
  let requests = 0;
  let probed = 0;
  for (const category of args.categories) {
    if (probed >= args.maxCategories) break;
    const sportKey = args.sportsListed.get(category.categoryId);
    if (!sportKey) continue;
    const leagueCode = PRIZEPICKS_LEAGUE_NAMES[category.categoryId] || category.displayName;
    const markets = Array.from(
      new Set(
        category.propFamilies
          .filter((family) => family.scope.kind === "match" && family.standardCount > 0)
          .map((family) => marketForStat(leagueCode, family.normalizedFamily, family.normalizedFamily))
          .filter((market): market is string => Boolean(market))
      )
    ).slice(0, 4);
    if (!markets.length) continue;
    if (!eventsBySport.has(sportKey)) {
      if (exceedsCreditBudget(credits, 1, args.maxCredits)) break;
      const listed = await args.fetchOdds(`/sports/${sportKey}/events`, `events_${sportKey}`);
      requests += 1;
      const listCost = listed.fromCache ? 0 : listed.lastCost ?? 1;
      credits += listCost;
      eventsBySport.set(sportKey, parseEvents(listed.json));
    }
    const props = args.projections.filter((projection) => projection.leagueId === category.categoryId && projection.oddsType === "standard" && Date.parse(projection.startTime) > Date.parse(args.nowIso));
    const game = props.find((projection) =>
      (eventsBySport.get(sportKey) ?? []).some((event) =>
        eventMatchesTeams({ team: projection.team, opponent: projection.opponent, home: event.home_team, away: event.away_team })
      )
    );
    const matched = game
      ? (eventsBySport.get(sportKey) ?? []).find((event) =>
          eventMatchesTeams({ team: game.team, opponent: game.opponent, home: event.home_team, away: event.away_team })
        )
      : undefined;
    if (!matched) {
      probed += 1;
      continue;
    }
    if (exceedsCreditBudget(credits, markets.length, args.maxCredits)) break;
    const query = markets.join(",");
    const response = await args.fetchOdds(
      `/sports/${sportKey}/events/${matched.id}/odds?regions=us&oddsFormat=american&markets=${encodeURIComponent(query)}`,
      `audit_${matched.id}_${query}`
    );
    requests += 1;
    const cost = response.fromCache ? 0 : response.lastCost ?? markets.length;
    credits += cost;
    creditsByCategory.set(category.categoryId, (creditsByCategory.get(category.categoryId) ?? 0) + cost);
    const outcomes = parseEventOdds(response.json);
    const seen = Array.from(new Set(outcomes.map((row) => row.market)));
    returned.set(category.categoryId, seen);
    probed += 1;
    const sample = props.filter((projection) => projection.gameId === game?.gameId).slice(0, 3);
    for (const projection of sample) {
      const family = category.propFamilies.find((row) => row.providerLabel === projection.statDisplayName);
      const market = marketForStat(leagueCode, family?.normalizedFamily ?? projection.statDisplayName, family?.normalizedFamily ?? projection.statDisplayName);
      if (!family || !market) continue;
      observations.push(observeProp(projection, category, family.normalizedFamily, family.scope.label, family.scope.kind === "match", market, outcomes, args.nowIso));
    }
  }
  return { observations, returned, credits, requests, creditsByCategory };
}

function observeProp(
  projection: PrizePicksProjection,
  category: CategoryRecord,
  family: string,
  scopeLabel: string,
  scopesMatch: boolean,
  market: string,
  outcomes: ReturnType<typeof parseEventOdds>,
  nowIso: string
): InefficiencyObservation {
  const grouped = quotesFor(outcomes, projection.playerName, market);
  const counts = Array.from(grouped.entries()).sort((a, b) => b[1].length - a[1].length);
  const top = counts[0];
  const atLine = grouped.get(projection.lineScore) ?? [];
  const bookLine = top ? top[0] : null;
  const estimate = isHalfPointLine(projection.lineScore) ? estimateAtLine(atLine, projection.lineScore) : null;
  const low = grouped.get(projection.lineScore - 0.5) ?? [];
  const high = grouped.get(projection.lineScore + 0.5) ?? [];
  const integer = Number.isInteger(projection.lineScore) ? priceIntegerFromAdjacent(projection.lineScore, low, high) : null;
  const integerPushKnown = Boolean(integer && "pLessWin" in integer);
  const compared = classifyComparison({
    promotional: projection.oddsType !== "standard" || projection.isPromo === true,
    scopesMatch,
    line: projection.lineScore,
    bookLine,
    books: estimate?.books ?? (atLine.length >= 2 ? atLine.length : top && top[1].length >= 2 ? top[1].length : null),
    bookRangePoints: estimate ? estimate.bookRange.high - estimate.bookRange.low : null,
    quotesFound: atLine.length >= 2 || Boolean(top && top[1].length >= 2),
    integerLine: Number.isInteger(projection.lineScore),
    integerPushKnown,
  });
  return {
    observedAt: nowIso,
    categoryId: category.categoryId,
    displayName: category.displayName,
    propFamily: family,
    scopeLabel,
    eventId: projection.gameId,
    player: projection.playerName,
    prizePicksLine: projection.lineScore,
    oddsType: projection.oddsType,
    sportsbookLine: bookLine,
    sportsbookPrices: atLine.length
      ? atLine.map((quote) => ({ book: quote.book, over: quote.overPrice, under: quote.underPrice }))
      : null,
    bookmakerCount: estimate?.books ?? (atLine.length || null),
    quoteTimestamp: atLine.find((quote) => quote.lastUpdate)?.lastUpdate ?? null,
    comparisonMethod: integerPushKnown ? "adjacent_half_points" : estimate ? "half_point_no_vig" : "threshold_only",
    comparison: compared.comparison,
    rejectionReason: compared.comparison === "VERIFIED_MARKET_DISCREPANCY" ? null : compared.reason,
    discrepancyPoints: compared.discrepancyPoints,
    direction: compared.direction,
    independentEventKey: `${category.categoryId}:${projection.gameId}`,
  };
}

function quotesFor(outcomes: ReturnType<typeof parseEventOdds>, player: string, market: string): Map<number, Array<{ book: string; overPrice: number; underPrice: number; lastUpdate?: string }>> {
  const want = normalizePlayerName(player);
  const paired = new Map<string, { over?: number; under?: number; lastUpdate?: string }>();
  for (const row of outcomes) {
    if (row.market !== market || normalizePlayerName(row.player) !== want) continue;
    const key = `${row.book}|${row.point}`;
    const quote = paired.get(key) ?? {};
    if (row.side === "over") quote.over = row.price;
    else quote.under = row.price;
    if (row.lastUpdate) quote.lastUpdate = row.lastUpdate;
    paired.set(key, quote);
  }
  const grouped = new Map<number, Array<{ book: string; overPrice: number; underPrice: number; lastUpdate?: string }>>();
  for (const [key, quote] of Array.from(paired.entries())) {
    if (quote.over == null || quote.under == null) continue;
    const point = Number(key.split("|")[1]);
    const list = grouped.get(point) ?? [];
    list.push({ book: key.split("|")[0]!, overPrice: quote.over, underPrice: quote.under, lastUpdate: quote.lastUpdate });
    grouped.set(point, list);
  }
  return grouped;
}

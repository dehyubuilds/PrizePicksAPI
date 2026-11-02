import {
  fetchOpenPolymarketMarkets,
  fetchPolymarketClobMidpoint,
  fetchPolymarketMarketsPage,
  fetchPolymarketSports,
  parsePolymarketOutcomePrices,
  parsePolymarketTokenIds,
  polymarketSportsMarketType,
} from "./client";
import { polymarketIntegrationEnabled } from "./config";
import type { PolymarketGammaMarketRow, PolymarketMarketSummary } from "./types";

const MAX_MARKETS = 200;

const SPORT_SERIES: Record<string, string[]> = {
  NBA: ["nba"],
  WNBA: ["wnba"],
  MLB: ["mlb"],
  NHL: ["nhl"],
  NFL: ["nfl"],
  MLS: ["mls"],
};

function sportTagsForMarket(row: PolymarketGammaMarketRow): string[] {
  const hay = [
    row.slug,
    row.question,
    row.description,
    polymarketSportsMarketType(row),
  ]
    .filter(Boolean)
    .join(" ");
  const tags: string[] = [];
  if (/\bnba\b/i.test(hay)) tags.push("NBA");
  if (/\bwnba\b/i.test(hay)) tags.push("WNBA");
  if (/\bmlb\b/i.test(hay)) tags.push("MLB");
  if (/\bnhl\b/i.test(hay)) tags.push("NHL");
  if (/\bnfl\b/i.test(hay)) tags.push("NFL");
  if (/\bmls\b/i.test(hay)) tags.push("MLS");
  return tags;
}

function marketHaystack(row: PolymarketGammaMarketRow): string {
  return [row.question, row.description, row.slug, polymarketSportsMarketType(row)]
    .filter(Boolean)
    .join(" ");
}

function hasStatKeyword(hay: string): boolean {
  return /\b(points?|rebounds?|assists?|yards?|strikeouts?|hits?|shots?|passes?|goals?|threes?|3.?pt|sog|receptions?|rush|rec\b|rbis?|saves?|home runs?)\b/i.test(
    hay
  );
}

function isPlayerPropMarket(row: PolymarketGammaMarketRow): boolean {
  const smt = polymarketSportsMarketType(row).toLowerCase();
  if (smt.includes("_player_")) return true;
  const hay = marketHaystack(row);
  if (!hasStatKeyword(hay)) return false;
  return (
    /\b[a-z]{2,}\s+[a-z]{2,}\b/i.test(hay) ||
    /\d+(?:\.\d+)?\s*\+/.test(hay) ||
    /\b(over|under|at least)\b/i.test(hay)
  );
}

function isActiveMarket(row: PolymarketGammaMarketRow, now = new Date()): boolean {
  if (row.closed === true || row.active === false) return false;
  if (row.enableOrderBook === false) return false;
  if (!row.endDate) return true;
  const end = new Date(row.endDate);
  return !Number.isNaN(end.getTime()) && end > now;
}

function toSummary(row: PolymarketGammaMarketRow): PolymarketMarketSummary {
  const tokens = parsePolymarketTokenIds(row);
  const prices = parsePolymarketOutcomePrices(row);
  return {
    conditionId: String(row.conditionId ?? row.id ?? "").trim(),
    slug: String(row.slug ?? "").trim(),
    question: String(row.question ?? "").trim(),
    description: String(row.description ?? "").trim(),
    sportsMarketType: polymarketSportsMarketType(row),
    yesTokenId: tokens.yesTokenId,
    noTokenId: tokens.noTokenId,
    yesPrice: prices.yesPrice,
    noPrice: prices.noPrice,
    volume: String(row.volumeNum ?? row.volume ?? "0"),
    gameStartTime: String(row.gameStartTime ?? "").trim(),
    endDate: String(row.endDate ?? "").trim(),
    sportTags: sportTagsForMarket(row),
  };
}

async function enrichPrices(markets: PolymarketMarketSummary[]): Promise<PolymarketMarketSummary[]> {
  const limited = markets.slice(0, 40);
  const enriched = await Promise.all(
    limited.map(async (market) => {
      if (market.yesPrice !== "0" && market.yesPrice !== "") return market;
      const mid = await fetchPolymarketClobMidpoint(market.yesTokenId);
      if (!mid) return market;
      const yes = Number.parseFloat(mid);
      const no = Number.isFinite(yes) ? String(Math.max(0, 1 - yes)) : market.noPrice;
      return { ...market, yesPrice: mid, noPrice: no };
    })
  );
  return [...enriched, ...markets.slice(40)];
}

export async function fetchPolymarketMarketsForEdgeScan(
  sports: string[]
): Promise<PolymarketMarketSummary[]> {
  if (!polymarketIntegrationEnabled()) return [];

  const sportList = sports.map((sport) => sport.trim()).filter(Boolean);
  const sportsMeta = await fetchPolymarketSports().catch(() => []);
  const seriesIds = new Set<string>();

  for (const sport of sportList) {
    const aliases = SPORT_SERIES[sport] ?? [sport.toLowerCase()];
    for (const row of sportsMeta) {
      const key = String(row.sport ?? "").trim().toLowerCase();
      if (aliases.includes(key) && row.series) seriesIds.add(String(row.series));
    }
  }

  const rows: PolymarketGammaMarketRow[] = [];
  if (seriesIds.size) {
    for (const seriesId of Array.from(seriesIds)) {
      const pageRows = await fetchPolymarketMarketsPage({
        limit: 80,
        offset: 0,
        active: true,
        closed: false,
        seriesId,
      }).catch(() => []);
      rows.push(...pageRows.filter((row) => isActiveMarket(row)));
    }
  }

  if (!rows.length) {
    const open = await fetchOpenPolymarketMarkets({ maxPages: 4, pageSize: 80 }).catch(() => []);
    rows.push(...open.filter((row) => isActiveMarket(row)));
  }

  let props = rows.filter(isPlayerPropMarket).map(toSummary);

  if (sportList.length) {
    const sportSet = new Set(sportList);
    const filtered = props.filter(
      (market) =>
        market.sportTags.length === 0 ||
        market.sportTags.some((tag) => sportSet.has(tag))
    );
    if (filtered.length) props = filtered;
  }

  props = props.slice(0, MAX_MARKETS);
  return enrichPrices(props);
}

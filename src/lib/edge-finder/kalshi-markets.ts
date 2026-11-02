import { fetchOpenKalshiMarkets } from "@/lib/kalshi/client";
import { fetchKalshiMarketsForSports, filterActiveKalshiMarkets } from "@/lib/kalshi/markets";
import { kalshiIntegrationEnabled } from "@/lib/kalshi/config";
import type { KalshiMarketApiRow, KalshiMarketSummary } from "@/lib/kalshi/types";

const MAX_MARKETS = 200;

function sportTagsForMarket(row: KalshiMarketApiRow): string[] {
  const hay = [row.ticker, row.event_ticker, row.title, row.yes_sub_title, row.no_sub_title]
    .filter(Boolean)
    .join(" ");
  const tags: string[] = [];
  if (/\bnba\b/i.test(hay)) tags.push("NBA");
  if (/\bwnba\b/i.test(hay)) tags.push("WNBA");
  if (/\bmlb\b/i.test(hay)) tags.push("MLB");
  if (/\bnhl\b/i.test(hay)) tags.push("NHL");
  if (/\bnfl\b/i.test(hay)) tags.push("NFL");
  if (/\bmls\b/i.test(hay)) tags.push("MLS");
  if (/\bworld cup\b|\bfifa\b|\bwcgame\b|\bkxwcgame\b/i.test(hay)) tags.push("World Cup");
  return tags;
}

function toKalshiSummary(row: KalshiMarketApiRow): KalshiMarketSummary {
  return {
    ticker: row.ticker!.trim(),
    eventTicker: (row.event_ticker ?? "").trim(),
    title: (row.title ?? row.yes_sub_title ?? row.ticker ?? "").trim(),
    yesSubTitle: (row.yes_sub_title ?? "").trim(),
    noSubTitle: (row.no_sub_title ?? "").trim(),
    yesBidDollars: (row.yes_bid_dollars ?? "0").trim(),
    yesAskDollars: (row.yes_ask_dollars ?? "0").trim(),
    volumeFp: (row.volume_fp ?? "0").trim(),
    closeTime: (row.close_time ?? "").trim(),
    rulesPrimary: (row.rules_primary ?? "").trim(),
    sportTags: sportTagsForMarket(row),
  };
}

function marketHaystack(row: KalshiMarketApiRow): string {
  return [row.ticker, row.title, row.yes_sub_title, row.no_sub_title, row.rules_primary]
    .filter(Boolean)
    .join(" ");
}

function hasStatKeyword(hay: string): boolean {
  return /\b(points?|rebounds?|assists?|yards?|strikeouts?|hits?|shots?|passes?|goals?|threes?|3.?pt|sog|receptions?|rush|rec\b|rbis?|saves?)\b/i.test(
    hay
  );
}

function hasPlayerPropShape(hay: string): boolean {
  const lower = hay.toLowerCase();
  return (
    /\b[a-z]{2,}\s+[a-z]{2,}\b/.test(lower) ||
    /\d+(?:\.\d+)?\s*\+/.test(lower) ||
    /\b(at least|over|under|record)\b/.test(lower) ||
    /player|prop|pts|rebounds?|assists?|passes?|shots?/i.test(hay)
  );
}

function isLikelyPlayerPropMarket(row: KalshiMarketApiRow): boolean {
  const hay = marketHaystack(row);
  if (!hasStatKeyword(hay)) return false;
  return hasPlayerPropShape(hay);
}

function mergeMarkets(primary: KalshiMarketSummary[], secondary: KalshiMarketSummary[]): KalshiMarketSummary[] {
  const seen = new Set<string>();
  const merged: KalshiMarketSummary[] = [];
  for (const market of [...primary, ...secondary]) {
    if (seen.has(market.ticker)) continue;
    seen.add(market.ticker);
    merged.push(market);
  }
  return merged;
}

export async function fetchKalshiMarketsForEdgeScan(sports: string[]): Promise<KalshiMarketSummary[]> {
  if (!kalshiIntegrationEnabled()) return [];

  const sportList = sports.map((sport) => sport.trim()).filter(Boolean);
  const sportMarkets = await fetchKalshiMarketsForSports(sportList);

  const rows = filterActiveKalshiMarkets((await fetchOpenKalshiMarkets({ limit: 250, maxPages: 4 })) ?? []);
  const playerProps = rows.filter(isLikelyPlayerPropMarket).map(toKalshiSummary);

  let combined = mergeMarkets(playerProps, sportMarkets);

  if (sportList.length) {
    const sportSet = new Set(sportList);
    const sportFiltered = combined.filter(
      (market) =>
        market.sportTags.length === 0 || market.sportTags.some((tag) => sportSet.has(tag))
    );
    if (sportFiltered.length) combined = sportFiltered;
  }

  return combined.slice(0, MAX_MARKETS);
}

import { fetchOpenKalshiMarkets } from "./client";
import { kalshiIntegrationEnabled } from "./config";
import type { KalshiMarketApiRow, KalshiMarketSummary } from "./types";

const SPORT_KEYWORDS: Array<{ tag: string; patterns: RegExp[] }> = [
  { tag: "NBA", patterns: [/\bnba\b/i, /KXNBAGAME/i] },
  { tag: "WNBA", patterns: [/\bwnba\b/i, /KXWNBAGAME/i] },
  { tag: "MLB", patterns: [/\bmlb\b/i, /\bbaseball\b/i, /KXMLBGAME/i] },
  { tag: "NHL", patterns: [/\bnhl\b/i, /\bhockey\b/i, /KXNHLGAME/i] },
  { tag: "NFL", patterns: [/\bnfl\b/i, /KXNFLGAME/i] },
  {
    tag: "CFB",
    patterns: [/\bcfb\b/i, /\bcollege football\b/i, /\bncaaf\b/i, /KXNCAAFGAME/i, /NCAAFGAME/i],
  },
  { tag: "MLS", patterns: [/\bmls\b/i, /KXMLSGAME/i] },
  {
    tag: "World Cup",
    patterns: [/\bworld cup\b/i, /\bfifa\b/i, /KXWCGAME/i, /WCGAME/i],
  },
  { tag: "College baseball", patterns: [/\bcollege baseball\b/i, /KXNCAABBGAME/i] },
];

const MAX_MARKETS_PER_SPORT = 5;
const MAX_TOTAL_MARKETS = 30;

function marketHaystack(row: KalshiMarketApiRow): string {
  return [
    row.ticker,
    row.event_ticker,
    row.title,
    row.yes_sub_title,
    row.no_sub_title,
  ]
    .filter(Boolean)
    .join(" ");
}

export function extractSportsKeywordsFromText(text: string): string[] {
  const found = new Set<string>();
  for (const { tag, patterns } of SPORT_KEYWORDS) {
    if (patterns.some((p) => p.test(text))) found.add(tag);
  }
  return Array.from(found);
}

export function extractSportsKeywordsFromTranscripts(
  transcripts: Array<{ title: string; transcript: { plainText?: string } }>
): string[] {
  const combined = transcripts
    .map(({ title, transcript }) => `${title}\n${transcript.plainText ?? ""}`)
    .join("\n\n");
  return extractSportsKeywordsFromText(combined);
}

function sportTagsForMarket(row: KalshiMarketApiRow): string[] {
  const haystack = marketHaystack(row);
  return SPORT_KEYWORDS.filter(({ patterns }) => patterns.some((p) => p.test(haystack))).map(
    ({ tag }) => tag
  );
}

export function filterActiveKalshiMarkets(
  rows: KalshiMarketApiRow[],
  now = new Date()
): KalshiMarketApiRow[] {
  return rows.filter((row) => {
    if (!row.ticker?.trim()) return false;
    if (row.status && row.status !== "open" && row.status !== "active") return false;
    if (!row.close_time) return true;
    const close = new Date(row.close_time);
    return !Number.isNaN(close.getTime()) && close > now;
  });
}

function parseVolume(row: KalshiMarketApiRow): number {
  const raw = row.volume_fp ?? "0";
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function toSummary(row: KalshiMarketApiRow, sportTags: string[]): KalshiMarketSummary {
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
    sportTags,
  };
}

function selectMarketsForSports(
  rows: KalshiMarketApiRow[],
  sports: string[]
): KalshiMarketSummary[] {
  const active = filterActiveKalshiMarkets(rows);
  const withTags = active
    .map((row) => ({ row, sportTags: sportTagsForMarket(row) }))
    .filter(({ sportTags }) => sportTags.length > 0);

  const targetSports = sports.length
    ? sports
    : Array.from(new Set(withTags.flatMap((x) => x.sportTags)));
  const selected: KalshiMarketSummary[] = [];
  const seenTickers = new Set<string>();

  for (const sport of targetSports) {
    const candidates = withTags
      .filter(({ sportTags }) => sportTags.includes(sport))
      .sort((a, b) => parseVolume(b.row) - parseVolume(a.row))
      .slice(0, MAX_MARKETS_PER_SPORT);

    for (const { row, sportTags } of candidates) {
      const ticker = row.ticker!.trim();
      if (seenTickers.has(ticker)) continue;
      seenTickers.add(ticker);
      selected.push(toSummary(row, sportTags));
      if (selected.length >= MAX_TOTAL_MARKETS) return selected;
    }
  }

  if (selected.length > 0) return selected;

  return active
    .filter((row) => /SPORT|GAME|WCGAME|NBAGAME|MLBGAME/i.test(marketHaystack(row)))
    .sort((a, b) => parseVolume(b) - parseVolume(a))
    .slice(0, MAX_TOTAL_MARKETS)
    .map((row) => toSummary(row, sportTagsForMarket(row)));
}

export function formatKalshiMarketsCorpus(markets: KalshiMarketSummary[]): string {
  if (!markets.length) {
    return "=== KALSHI MARKETS ===\nNo open Kalshi sports markets matched today's corpus.";
  }

  const blocks = markets.map((m) => {
    const implied = Math.round(Number.parseFloat(m.yesBidDollars) * 100);
    const impliedLabel = Number.isFinite(implied) ? `${implied}% implied YES` : "price n/a";
    return [
      `Ticker: ${m.ticker}`,
      m.eventTicker ? `Event: ${m.eventTicker}` : null,
      `Market: ${m.title}`,
      m.yesSubTitle ? `YES: ${m.yesSubTitle} @ $${m.yesBidDollars} (${impliedLabel})` : null,
      m.noSubTitle ? `NO: ${m.noSubTitle}` : null,
      `Volume: ${m.volumeFp} contracts`,
      m.closeTime ? `Closes: ${m.closeTime}` : null,
      m.rulesPrimary ? `Rules: ${m.rulesPrimary.slice(0, 400)}` : null,
      m.sportTags.length ? `Sports: ${m.sportTags.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return `=== KALSHI MARKETS (open, for cross-reference) ===\n${blocks.join("\n\n")}`;
}

/** Fetch relevant open Kalshi markets for sport tags (e.g. from PrizePicks leagues). Never throws. */
export async function fetchKalshiMarketsForSports(sports: string[]): Promise<KalshiMarketSummary[]> {
  if (!kalshiIntegrationEnabled()) return [];

  try {
    const rows = (await fetchOpenKalshiMarkets({ limit: 200, maxPages: 3 })) ?? [];
    return selectMarketsForSports(rows, sports);
  } catch (err) {
    console.error("[kalshi] fetch markets for sports failed", err);
    return [];
  }
}

/** Fetch relevant open Kalshi markets for today's transcript corpus. Never throws. */
export async function fetchKalshiMarketsForPicks(
  transcripts: Array<{ title: string; transcript: { plainText?: string } }>
): Promise<KalshiMarketSummary[]> {
  if (!kalshiIntegrationEnabled()) return [];

  try {
    const sports = extractSportsKeywordsFromTranscripts(transcripts);
    return fetchKalshiMarketsForSports(sports);
  } catch (err) {
    console.error("[kalshi] fetch markets failed", err);
    return [];
  }
}

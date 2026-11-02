import { polymarketClobBaseUrl, polymarketGammaBaseUrl } from "./config";
import type {
  PolymarketClobPriceResponse,
  PolymarketGammaMarketRow,
  PolymarketSportsRow,
} from "./types";

const DEFAULT_TIMEOUT_MS = 25_000;

async function polymarketGet<T>(baseUrl: string, path: string, options?: { timeoutMs?: number }): Promise<T> {
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ac.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Polymarket API ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`
      );
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((value) => String(value));
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map((value) => String(value)) : [];
  } catch {
    return [];
  }
}

export function parsePolymarketTokenIds(row: PolymarketGammaMarketRow): {
  yesTokenId: string;
  noTokenId: string;
} {
  const tokens = parseJsonArray(row.clobTokenIds);
  return {
    yesTokenId: tokens[0]?.trim() ?? "",
    noTokenId: tokens[1]?.trim() ?? "",
  };
}

export function parsePolymarketOutcomePrices(row: PolymarketGammaMarketRow): {
  yesPrice: string;
  noPrice: string;
} {
  const prices = parseJsonArray(row.outcomePrices);
  return {
    yesPrice: prices[0]?.trim() || "0",
    noPrice: prices[1]?.trim() || "0",
  };
}

export function polymarketSportsMarketType(row: PolymarketGammaMarketRow): string {
  return String(
    row.sportsMarketType ?? row.marketSportType ?? row.sports_market_type ?? ""
  ).trim();
}

export async function fetchPolymarketSports(): Promise<PolymarketSportsRow[]> {
  const data = await polymarketGet<PolymarketSportsRow[]>(
    polymarketGammaBaseUrl(),
    "/sports"
  );
  return Array.isArray(data) ? data : [];
}

export async function fetchPolymarketMarketsPage(params?: {
  limit?: number;
  offset?: number;
  active?: boolean;
  closed?: boolean;
  seriesId?: string;
}): Promise<PolymarketGammaMarketRow[]> {
  const limit = Math.min(100, Math.max(1, params?.limit ?? 50));
  const offset = Math.max(0, params?.offset ?? 0);
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (params?.active !== false) query.set("active", "true");
  if (params?.closed === false) query.set("closed", "false");
  if (params?.seriesId) query.set("series_id", params.seriesId);

  const data = await polymarketGet<PolymarketGammaMarketRow[]>(
    polymarketGammaBaseUrl(),
    `/markets?${query.toString()}`
  );
  return Array.isArray(data) ? data : [];
}

export async function fetchOpenPolymarketMarkets(params?: {
  maxPages?: number;
  pageSize?: number;
}): Promise<PolymarketGammaMarketRow[]> {
  const pageSize = Math.min(100, Math.max(1, params?.pageSize ?? 50));
  const maxPages = Math.min(8, Math.max(1, params?.maxPages ?? 4));
  const markets: PolymarketGammaMarketRow[] = [];

  for (let page = 0; page < maxPages; page += 1) {
    const rows = await fetchPolymarketMarketsPage({
      limit: pageSize,
      offset: page * pageSize,
      active: true,
      closed: false,
    });
    if (!rows.length) break;
    markets.push(...rows);
    if (rows.length < pageSize) break;
  }

  return markets;
}

export async function fetchPolymarketClobPrice(tokenId: string): Promise<string | null> {
  const safe = tokenId.trim();
  if (!safe) return null;
  try {
    const data = await polymarketGet<PolymarketClobPriceResponse>(
      polymarketClobBaseUrl(),
      `/price?token_id=${encodeURIComponent(safe)}&side=BUY`
    );
    const price = String(data.price ?? "").trim();
    return price || null;
  } catch {
    return null;
  }
}

export async function fetchPolymarketClobMidpoint(tokenId: string): Promise<string | null> {
  const safe = tokenId.trim();
  if (!safe) return null;
  try {
    const data = await polymarketGet<{ mid?: string }>(
      polymarketClobBaseUrl(),
      `/midpoint?token_id=${encodeURIComponent(safe)}`
    );
    const mid = String(data.mid ?? "").trim();
    return mid || null;
  } catch {
    return null;
  }
}

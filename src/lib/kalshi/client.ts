import { kalshiApiBaseUrl } from "./config";
import { kalshiAuthHeaders } from "./auth";
import type { KalshiEventsApiResponse, KalshiMarketsApiResponse } from "./types";

const DEFAULT_TIMEOUT_MS = 25_000;

/** Official Kalshi docs: sign the path from root with no query string. */
export function kalshiTradeSignPath(pathWithQuery: string): string {
  const normalized = pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`;
  const withoutQuery = normalized.split("?")[0] || "/";
  if (withoutQuery.startsWith("/trade-api/")) return withoutQuery;
  return `/trade-api/v2${withoutQuery}`;
}

function tradeApiSignPath(pathWithQuery: string): string {
  return kalshiTradeSignPath(pathWithQuery);
}

export async function kalshiGet<T = unknown>(
  pathWithQuery: string,
  options?: { timeoutMs?: number }
): Promise<T> {
  const base = kalshiApiBaseUrl();
  const relative = pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`;
  const url = `${base}${relative}`;
  const signPath = tradeApiSignPath(relative);
  const authHeaders = kalshiAuthHeaders("GET", signPath) ?? {};

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...authHeaders,
      },
      signal: ac.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Kalshi API ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function kalshiPost<T = unknown>(
  pathWithQuery: string,
  body: unknown,
  options?: { timeoutMs?: number }
): Promise<T> {
  const base = kalshiApiBaseUrl();
  const relative = pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`;
  const url = `${base}${relative}`;
  const signPath = tradeApiSignPath(relative);
  const authHeaders = kalshiAuthHeaders("POST", signPath);
  if (!authHeaders) {
    throw new Error("Kalshi API keys missing. Set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY.");
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Kalshi API ${res.status}${detail ? `: ${detail.slice(0, 400)}` : ""}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function kalshiDelete<T = unknown>(
  pathWithQuery: string,
  options?: { timeoutMs?: number }
): Promise<T> {
  const base = kalshiApiBaseUrl();
  const relative = pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`;
  const url = `${base}${relative}`;
  const signPath = tradeApiSignPath(relative);
  const authHeaders = kalshiAuthHeaders("DELETE", signPath);
  if (!authHeaders) {
    throw new Error("Kalshi API keys missing. Set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY.");
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        ...authHeaders,
      },
      signal: ac.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Kalshi API ${res.status}${detail ? `: ${detail.slice(0, 400)}` : ""}`);
    }
    if (res.status === 204) return {} as T;
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchOpenKalshiMarkets(params?: {
  limit?: number;
  maxPages?: number;
}): Promise<KalshiMarketsApiResponse["markets"]> {
  const limit = Math.min(1000, Math.max(1, params?.limit ?? 200));
  const maxPages = Math.min(20, Math.max(1, params?.maxPages ?? 3));
  const markets: NonNullable<KalshiMarketsApiResponse["markets"]> = [];
  let cursor: string | null | undefined = undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const query = new URLSearchParams({ status: "open", limit: String(limit) });
    if (cursor) query.set("cursor", cursor);
    const data = await kalshiGet<KalshiMarketsApiResponse>(`/markets?${query.toString()}`);
    if (data.markets?.length) markets.push(...data.markets);
    cursor = data.cursor;
    if (!cursor) break;
  }

  return markets;
}

export async function fetchOpenKalshiEvents(params?: {
  limit?: number;
  maxPages?: number;
}): Promise<NonNullable<KalshiEventsApiResponse["events"]>> {
  const limit = Math.min(200, Math.max(1, params?.limit ?? 200));
  const maxPages = Math.min(8, Math.max(1, params?.maxPages ?? 3));
  const events: NonNullable<KalshiEventsApiResponse["events"]> = [];
  let cursor: string | null | undefined = undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const query = new URLSearchParams({ status: "open", limit: String(limit) });
    if (cursor) query.set("cursor", cursor);
    const data = await kalshiGet<KalshiEventsApiResponse>(`/events?${query.toString()}`);
    if (data.events?.length) events.push(...data.events);
    cursor = data.cursor;
    if (!cursor) break;
  }

  return events;
}

export async function fetchOpenKalshiMarketsBySeries(
  seriesTicker: string,
  params?: { limit?: number; maxPages?: number }
): Promise<NonNullable<KalshiMarketsApiResponse["markets"]>> {
  const limit = Math.min(200, Math.max(1, params?.limit ?? 200));
  const maxPages = Math.min(4, Math.max(1, params?.maxPages ?? 2));
  const markets: NonNullable<KalshiMarketsApiResponse["markets"]> = [];
  let cursor: string | null | undefined = undefined;
  const series = seriesTicker.trim();
  if (!series) return markets;

  for (let page = 0; page < maxPages; page += 1) {
    const query = new URLSearchParams({
      status: "open",
      limit: String(limit),
      series_ticker: series,
    });
    if (cursor) query.set("cursor", cursor);
    const data = await kalshiGet<KalshiMarketsApiResponse>(`/markets?${query.toString()}`);
    if (data.markets?.length) markets.push(...data.markets);
    cursor = data.cursor;
    if (!cursor) break;
  }

  return markets;
}

export type KalshiBalance = {
  cashDollars: number;
  portfolioValueCents: number;
};

export async function fetchKalshiCashBalance(): Promise<KalshiBalance> {
  const data = await kalshiGet<{
    balance?: number;
    balance_dollars?: string;
    portfolio_value?: number;
  }>("/portfolio/balance");
  const fromDollars = Number.parseFloat(data.balance_dollars ?? "");
  const cashDollars = Number.isFinite(fromDollars)
    ? fromDollars
    : (Number(data.balance) || 0) / 100;
  return {
    cashDollars,
    portfolioValueCents: Number(data.portfolio_value) || 0,
  };
}

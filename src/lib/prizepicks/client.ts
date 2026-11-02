import { readPrizePicksCache, writePrizePicksCache } from "./cache";
import { loadPrizepicksBrowserCookie } from "./browser-cookie";
import { prizepicksApiBaseUrl } from "./config";
import { httpGetText } from "./http-get";
import {
  inferLeagueIdForProjection,
  leagueNameForId,
  projectionNeedsLeagueId,
} from "./leagues";
import { nextPrizePicksProxyUrl, prizepicksProxyConfigured } from "./proxy";
import type { PrizePicksFetchResult, PrizePicksProjection } from "./types";

type JsonApiRow = {
  type?: string;
  id?: string;
  attributes?: Record<string, unknown>;
  relationships?: {
    new_player?: { data?: { id?: string } };
    league?: { data?: { id?: string } };
  };
};

type JsonApiResponse = {
  data?: JsonApiRow[];
  included?: JsonApiRow[];
  error?: string;
};

/** Default UA. Override with PRIZEPICKS_USER_AGENT — must match the browser that minted the cookie. */
const DEFAULT_PRIZEPICKS_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function prizepicksUserAgent(): string {
  return process.env.PRIZEPICKS_USER_AGENT?.trim() || DEFAULT_PRIZEPICKS_USER_AGENT;
}

const RETRYABLE_STATUS = new Set([429, 502, 503]);
const MAX_ATTEMPTS = 2;
const RETRY_DELAYS_MS = [0, 8000];

export type FetchPrizePicksOptions = {
  /** Skip live API; return recent S3 cache only (regenerate/publish). */
  preferCache?: boolean;
  /** Always hit live API (admin Test button). */
  forceLive?: boolean;
  /** With forceLive: do not fall back to S3 cache when the live API fails. */
  disallowCacheFallback?: boolean;
};

function chromeMajorFromUserAgent(ua: string): string | null {
  const match = ua.match(/Chrome\/(\d+)/);
  return match?.[1] ?? null;
}

function browserHeaders(cookie: string | null): Record<string, string> {
  const ua = prizepicksUserAgent();
  const major = chromeMajorFromUserAgent(ua);
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://app.prizepicks.com/",
    Origin: "https://app.prizepicks.com",
    "User-Agent": ua,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
  };
  if (major) {
    headers["sec-ch-ua"] = `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not-A.Brand";v="24"`;
    headers["sec-ch-ua-mobile"] = "?0";
    headers["sec-ch-ua-platform"] = '"macOS"';
  }
  if (cookie) headers.Cookie = cookie;
  return headers;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBotBlockBody(body: string): boolean {
  return /appId|blockScript|PerimeterX|px-captcha|Access to this page has been denied|captcha-delivery\.com|datadome/i.test(
    body
  );
}

function formatHttpError(
  status: number,
  body: string,
  data: JsonApiResponse,
  hasCookie: boolean
): string {
  if (status === 429) {
    return prizepicksProxyConfigured()
      ? "PrizePicks rate-limited (429) even through proxy. Wait a minute and retry."
      : "PrizePicks rate-limited (429). Wait a minute, then Test API once.";
  }
  if (status === 403 || isBotBlockBody(body)) {
    const proxyHint = prizepicksProxyConfigured()
      ? " Still blocked through proxy — refresh cookie and retry."
      : " PrizePicks ties cookies to your browser IP (DataDome/Cloudflare). Add PRIZEPICKS_PROXY_LIST (US residential proxy) on Netlify, or requests from the server will keep getting 403.";
    return hasCookie
      ? `PrizePicks bot protection blocked this request (403). Update PRIZEPICKS_BROWSER_COOKIE on Netlify and redeploy.${proxyHint}`
      : `PrizePicks bot protection blocked this request (403). Set PRIZEPICKS_BROWSER_COOKIE on Netlify and redeploy.${proxyHint}`;
  }
  const detail = data.error ?? (body.slice(0, 120) || `HTTP ${status}`);
  return `PrizePicks API error (${status}): ${detail}`;
}

export class PrizePicksApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number
  ) {
    super(message);
    this.name = "PrizePicksApiError";
  }
}

async function prizepicksGet(path: string, cookie: string | null): Promise<JsonApiResponse> {
  const url = `${prizepicksApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  let lastError: PrizePicksApiError | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAYS_MS[attempt] ?? 8000);
    }

    const proxyUrl = nextPrizePicksProxyUrl();
    let status = 0;
    let body = "";
    try {
      const res = await httpGetText(url, browserHeaders(cookie), proxyUrl);
      status = res.status;
      body = res.body;
    } catch (err) {
      lastError = new PrizePicksApiError(
        err instanceof Error ? err.message : "PrizePicks request failed",
        502
      );
      continue;
    }

    let data: JsonApiResponse = {};
    try {
      data = JSON.parse(body) as JsonApiResponse;
    } catch {
      const message = formatHttpError(status || 403, body, data, Boolean(cookie));
      lastError = new PrizePicksApiError(message, status || 403);
      if (RETRYABLE_STATUS.has(status) && attempt < MAX_ATTEMPTS - 1) continue;
      throw lastError;
    }

    if (status >= 200 && status < 300 && !data.error) {
      return data;
    }

    const message = formatHttpError(status, body, data, Boolean(cookie));
    lastError = new PrizePicksApiError(message, status);
    if (RETRYABLE_STATUS.has(status) && attempt < MAX_ATTEMPTS - 1) continue;
    throw lastError;
  }

  throw lastError ?? new PrizePicksApiError("PrizePicks API request failed after retries.");
}

function mapProjection(
  row: JsonApiRow,
  included: JsonApiRow[],
  leagueId?: string
): PrizePicksProjection | null {
  const attrs = row.attributes ?? {};
  const playerRelId = row.relationships?.new_player?.data?.id;
  const playerRow = included.find((i) => i.type === "new_player" && i.id === playerRelId);
  const playerAttrs = playerRow?.attributes ?? {};
  const playerName = String(playerAttrs.name ?? playerAttrs.display_name ?? "").trim();
  const team = String(playerAttrs.market ?? playerAttrs.team ?? "").trim();
  const lineScore = Number(attrs.line_score);
  if (!playerName || !Number.isFinite(lineScore)) return null;

  const statDisplayName = String(attrs.stat_display_name ?? attrs.stat_type ?? "Stat").trim();
  const resolvedLeagueId =
    leagueId?.trim() ||
    String(attrs.league_id ?? "").trim() ||
    String(row.relationships?.league?.data?.id ?? "").trim();

  return {
    id: String(row.id ?? "").trim(),
    playerName,
    team,
    opponent: String(attrs.description ?? attrs.opponent ?? "").trim(),
    leagueId: resolvedLeagueId,
    leagueName: leagueNameForId(resolvedLeagueId),
    statDisplayName,
    statType: String(attrs.stat_type ?? "").trim(),
    lineScore,
    oddsType: String(attrs.odds_type ?? "standard").trim(),
    startTime: String(attrs.start_time ?? attrs.board_time ?? "").trim(),
    gameId: String(attrs.game_id ?? "").trim(),
    status: String(attrs.status ?? "").trim(),
    boardTime: String(attrs.board_time ?? "").trim() || undefined,
    updatedAt: String(attrs.updated_at ?? "").trim() || undefined,
    rank: Number.isFinite(Number(attrs.rank)) ? Number(attrs.rank) : undefined,
    isPromo: attrs.is_promo === true,
  };
}

function parseProjectionsResponse(
  data: JsonApiResponse,
  leagueId?: string
): PrizePicksProjection[] {
  const included = data.included ?? [];
  const rows = data.data ?? [];
  return rows
    .map((row) => mapProjection(row, included, leagueId))
    .filter((p): p is PrizePicksProjection => Boolean(p?.id));
}

function dedupeProjections(all: PrizePicksProjection[]): PrizePicksProjection[] {
  const seen = new Set<string>();
  return all.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return p.status !== "inactive";
  });
}

const LEAGUE_PROJECTIONS_PER_PAGE = 250;
const LEAGUE_PROJECTIONS_MAX_PAGES = 8;
const LEAGUE_FETCH_DELAY_MS = 800;

function projectionsNeedLeagueBackfill(projections: PrizePicksProjection[]): boolean {
  return projections.some(projectionNeedsLeagueId);
}

function withResolvedLeague(projection: PrizePicksProjection): PrizePicksProjection {
  const leagueId = projection.leagueId.trim() || inferLeagueIdForProjection(projection);
  if (!leagueId) return projection;
  return {
    ...projection,
    leagueId,
    leagueName: leagueNameForId(leagueId),
  };
}

function mergeLeagueTaggedProjections(
  bulk: PrizePicksProjection[],
  scoped: PrizePicksProjection[]
): PrizePicksProjection[] {
  if (!scoped.length) return bulk.map(withResolvedLeague);
  const byId = new Map<string, PrizePicksProjection>();
  for (const projection of bulk) {
    byId.set(projection.id, projection);
  }
  for (const projection of scoped) {
    const existing = byId.get(projection.id);
    byId.set(
      projection.id,
      existing
        ? {
            ...existing,
            leagueId: projection.leagueId,
            leagueName: projection.leagueName,
          }
        : projection
    );
  }
  return Array.from(byId.values()).map(withResolvedLeague);
}

async function fetchProjectionsForLeague(
  leagueId: string,
  cookie: string | null
): Promise<PrizePicksProjection[]> {
  const all: PrizePicksProjection[] = [];
  for (let page = 1; page <= LEAGUE_PROJECTIONS_MAX_PAGES; page++) {
    const res = await prizepicksGet(
      `/projections?league_id=${encodeURIComponent(leagueId)}&per_page=${LEAGUE_PROJECTIONS_PER_PAGE}&page=${page}&single_stat=true&include_new_player_attributes=true`,
      cookie
    );
    const rows = parseProjectionsResponse(res, leagueId);
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < LEAGUE_PROJECTIONS_PER_PAGE) break;
    await sleep(400);
  }
  return all;
}

async function fetchLeagueScopedProjections(
  cookie: string | null
): Promise<PrizePicksProjection[]> {
  const leaguesRes = await prizepicksGet("/leagues", cookie).catch(() => ({ data: [] }));
  const leagueRows = (leaguesRes.data ?? []).filter(
    (league) =>
      league.attributes?.active === true && Number(league.attributes?.projections_count ?? 0) > 0
  );
  const all: PrizePicksProjection[] = [];
  let lastError: PrizePicksApiError | null = null;

  for (const league of leagueRows) {
    const leagueId = String(league.id ?? "").trim();
    if (!leagueId) continue;
    try {
      all.push(...(await fetchProjectionsForLeague(leagueId, cookie)));
    } catch (err) {
      if (err instanceof PrizePicksApiError) lastError = err;
    }
    await sleep(LEAGUE_FETCH_DELAY_MS);
  }

  if (!all.length && lastError) throw lastError;
  return all;
}

async function fetchLiveProjections(): Promise<PrizePicksProjection[]> {
  const cookie = await loadPrizepicksBrowserCookie();
  let all: PrizePicksProjection[] = [];
  let lastError: PrizePicksApiError | null = null;

  try {
    const bulk = await prizepicksGet(
      "/projections?per_page=250&single_stat=true&include_new_player_attributes=true",
      cookie
    );
    all = parseProjectionsResponse(bulk);
    if (!all.length && (bulk.data?.length ?? 0) > 0) {
      lastError = new PrizePicksApiError(
        "PrizePicks returned projections but none could be parsed (missing player data)."
      );
    }
  } catch (err) {
    if (err instanceof PrizePicksApiError) {
      lastError = err;
      if (err.statusCode !== 429) throw err;
    } else {
      throw err;
    }
  }

  if (all.length === 0 || projectionsNeedLeagueBackfill(all)) {
    try {
      const scoped = await fetchLeagueScopedProjections(cookie);
      all = mergeLeagueTaggedProjections(all, scoped);
    } catch (err) {
      if (all.length === 0) {
        if (err instanceof PrizePicksApiError) throw err;
        throw err;
      }
      if (err instanceof PrizePicksApiError) lastError = err;
    }
  } else {
    all = all.map(withResolvedLeague);
  }

  const projections = dedupeProjections(all);
  if (!projections.length && lastError) throw lastError;
  return projections;
}

/** Single-league fetch (e.g. CFB league_id 15) — used by CLI and targeted scans. */
export async function fetchPrizePicksProjectionsForLeagueId(
  leagueId: string,
  options: FetchPrizePicksOptions = {}
): Promise<PrizePicksFetchResult> {
  const forceLive = options.forceLive === true;
  const disallowCacheFallback = options.disallowCacheFallback === true;

  if (!forceLive && options.preferCache !== true) {
    const cached = await readPrizePicksCache();
    const fromLeague = cached?.projections.filter((p) => p.leagueId === leagueId) ?? [];
    if (fromLeague.length) {
      return {
        projections: fromLeague,
        fetchedAt: cached!.fetchedAt,
        leagueCount: 1,
        fromCache: true,
      };
    }
  }

  try {
    const cookie = await loadPrizepicksBrowserCookie();
    const projections = dedupeProjections(await fetchProjectionsForLeague(leagueId, cookie));
    if (!projections.length) {
      throw new PrizePicksApiError(`PrizePicks returned zero props for league ${leagueId}.`);
    }
    const result: PrizePicksFetchResult = {
      projections,
      fetchedAt: new Date().toISOString(),
      leagueCount: 1,
      fromCache: false,
    };
    return result;
  } catch (liveErr) {
    if (disallowCacheFallback) throw liveErr;
    const cached = await readPrizePicksCache();
    const fromLeague = cached?.projections.filter((p) => p.leagueId === leagueId) ?? [];
    if (fromLeague.length) {
      return {
        projections: fromLeague,
        fetchedAt: cached!.fetchedAt,
        leagueCount: 1,
        fromCache: true,
      };
    }
    throw liveErr;
  }
}

/** Fetch PrizePicks props. Regenerate uses cache first; Test API forces a live fetch. */
export async function fetchPrizePicksProjections(
  options: FetchPrizePicksOptions = {}
): Promise<PrizePicksFetchResult> {
  const preferCache = options.preferCache === true;
  const forceLive = options.forceLive === true;
  const disallowCacheFallback = options.disallowCacheFallback === true;

  if (!forceLive) {
    const cached = await readPrizePicksCache();
    if (cached?.projections.length) {
      return { ...cached, fromCache: true };
    }
  }

  try {
    const projections = await fetchLiveProjections();
    if (!projections.length) {
      throw new PrizePicksApiError(
        "PrizePicks returned zero live props (API responded but boards look empty)."
      );
    }
    const result: PrizePicksFetchResult = {
      projections,
      fetchedAt: new Date().toISOString(),
      leagueCount: new Set(projections.map((p) => p.leagueId)).size,
      fromCache: false,
    };
    await writePrizePicksCache(result).catch(() => {});
    return result;
  } catch (liveErr) {
    if (disallowCacheFallback) throw liveErr;
    const cached = await readPrizePicksCache();
    if (cached?.projections.length) {
      return { ...cached, fromCache: true };
    }
    throw liveErr;
  }
}

export type PrizePicksLeagueCatalogEntry = {
  id: string;
  name: string;
  providerSport: string | null;
  projectionsCount: number | null;
  active: boolean | null;
};

/** Read-only league list. Names come from PrizePicks, not from the hardcoded sport map. */
export async function fetchPrizePicksLeagueCatalog(): Promise<PrizePicksLeagueCatalogEntry[]> {
  const cookie = await loadPrizepicksBrowserCookie();
  const res = await prizepicksGet("/leagues", cookie);
  return (res.data ?? []).flatMap((row) => {
    const id = String(row.id ?? "").trim();
    if (!id) return [];
    const attrs = row.attributes ?? {};
    const name = String(attrs.name ?? attrs.display_name ?? "").trim();
    const sport = String(attrs.sport ?? attrs.sport_name ?? "").trim();
    const count = Number(attrs.projections_count);
    return [
      {
        id,
        name,
        providerSport: sport || null,
        projectionsCount: Number.isFinite(count) ? count : null,
        active: typeof attrs.active === "boolean" ? attrs.active : null,
      },
    ];
  });
}

export function formatPrizePicksLine(projection: PrizePicksProjection, side: "over" | "under"): string {
  const sideLabel = side === "over" ? "Over" : "Under";
  const odds =
    projection.oddsType && projection.oddsType !== "standard"
      ? ` (${projection.oddsType})`
      : "";
  return `${projection.playerName} ${sideLabel} ${projection.lineScore} ${projection.statDisplayName}${odds}`;
}

export function sportKeywordsFromProjections(projections: PrizePicksProjection[]): string[] {
  const tags = new Set<string>();
  for (const p of projections) {
    if (p.leagueName) tags.add(p.leagueName);
  }
  return Array.from(tags);
}

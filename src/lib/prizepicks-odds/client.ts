import fs from "fs";
import path from "path";

const API = "https://api.the-odds-api.com/v4";
export const ODDS_CACHE_DIR = path.resolve(process.cwd(), "tmp/prizepicks-odds/cache");

export type OddsResponse = {
  json: unknown;
  remaining: number | null;
  used: number | null;
  lastCost: number | null;
  fromCache: boolean;
};

export function oddsApiKey(): string {
  return process.env.THE_ODDS_API_KEY?.trim() || "";
}

export function readQuotaHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export async function fetchOdds(
  pathAndQuery: string,
  cacheKey: string,
  options: { cacheDir?: string; nowMs?: number; maxAgeMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<OddsResponse> {
  const key = oddsApiKey();
  if (!key) {
    throw new Error("Set THE_ODDS_API_KEY in .env.local. Free key: https://the-odds-api.com/");
  }
  const cacheDir = options.cacheDir ?? ODDS_CACHE_DIR;
  const maxAgeMs = options.maxAgeMs ?? 12 * 60 * 60 * 1000;
  const nowMs = options.nowMs ?? Date.now();
  const file = path.join(cacheDir, `${cacheKey.replace(/[^a-z0-9_-]+/gi, "_")}.json`);
  if (fs.existsSync(file)) {
    try {
      const cached = JSON.parse(fs.readFileSync(file, "utf8")) as OddsResponse & { savedAt?: number };
      if (cached.savedAt && nowMs - cached.savedAt < maxAgeMs) {
        return { ...cached, fromCache: true };
      }
    } catch {
      // refetch
    }
  }

  const join = pathAndQuery.includes("?") ? "&" : "?";
  const url = `${API}${pathAndQuery}${join}apiKey=${encodeURIComponent(key)}`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(url);
  const json = (await res.json().catch(() => ({}))) as unknown;
  if (!res.ok) {
    const message =
      json && typeof json === "object" && "message" in json
        ? String((json as { message?: string }).message)
        : res.statusText;
    throw new Error(`Odds API ${res.status}: ${message}`);
  }
  const payload: OddsResponse & { savedAt: number } = {
    json,
    remaining: readQuotaHeader(res.headers, "x-requests-remaining"),
    used: readQuotaHeader(res.headers, "x-requests-used"),
    lastCost: readQuotaHeader(res.headers, "x-requests-last"),
    fromCache: false,
    savedAt: nowMs,
  };
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload)}\n`);
  return payload;
}

export type OddsEvent = {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
};

export function parseEvents(json: unknown): OddsEvent[] {
  if (!Array.isArray(json)) return [];
  return json
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const event = row as Record<string, unknown>;
      const id = String(event.id ?? "");
      const home = String(event.home_team ?? "");
      const away = String(event.away_team ?? "");
      if (!id || !home || !away) return null;
      return {
        id,
        home_team: home,
        away_team: away,
        commence_time: String(event.commence_time ?? ""),
      };
    })
    .filter((row): row is OddsEvent => Boolean(row));
}

export type ParsedOutcome = {
  book: string;
  market: string;
  player: string;
  side: "over" | "under";
  point: number;
  price: number;
  lastUpdate?: string;
};

export function parseEventOdds(json: unknown): ParsedOutcome[] {
  if (!json || typeof json !== "object") return [];
  const bookmakers = (json as { bookmakers?: unknown }).bookmakers;
  if (!Array.isArray(bookmakers)) return [];
  const rows: ParsedOutcome[] = [];
  for (const book of bookmakers) {
    if (!book || typeof book !== "object") continue;
    const bookKey = String((book as { key?: string }).key ?? "");
    const markets = (book as { markets?: unknown }).markets;
    if (!bookKey || !Array.isArray(markets)) continue;
    for (const market of markets) {
      if (!market || typeof market !== "object") continue;
      const marketKey = String((market as { key?: string }).key ?? "");
      const lastUpdate = String((market as { last_update?: string }).last_update ?? "").trim() || undefined;
      const outcomes = (market as { outcomes?: unknown }).outcomes;
      if (!marketKey || !Array.isArray(outcomes)) continue;
      for (const outcome of outcomes) {
        if (!outcome || typeof outcome !== "object") continue;
        const row = outcome as { name?: string; description?: string; price?: number; point?: number };
        const side = String(row.name ?? "").toLowerCase();
        if (side !== "over" && side !== "under") continue;
        if (!row.description || !Number.isFinite(row.price) || !Number.isFinite(row.point)) continue;
        rows.push({
          book: bookKey,
          market: marketKey,
          player: row.description,
          side,
          point: Number(row.point),
          price: Number(row.price),
          lastUpdate,
        });
      }
    }
  }
  return rows;
}

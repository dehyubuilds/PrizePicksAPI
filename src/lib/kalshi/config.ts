export function kalshiIntegrationEnabled(): boolean {
  const raw = process.env.KALSHI_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return true;
}

/** Production Kalshi trade API (override for demo: https://demo-api.kalshi.co/trade-api/v2). */
export function kalshiApiBaseUrl(): string {
  return (
    process.env.KALSHI_API_BASE_URL?.trim().replace(/\/$/, "") ||
    "https://api.elections.kalshi.com/trade-api/v2"
  );
}

export function kalshiApiKeyId(): string | null {
  return process.env.KALSHI_API_KEY_ID?.trim() || null;
}

export function kalshiPrivateKeyPem(): string | null {
  const raw = process.env.KALSHI_PRIVATE_KEY?.trim();
  if (!raw) return null;
  return raw.replace(/\\n/g, "\n");
}

export function kalshiAuthConfigured(): boolean {
  return Boolean(kalshiApiKeyId() && kalshiPrivateKeyPem());
}

/** Kalshi web pages are /markets/{series}/{slug}/{event}, not /markets/{marketTicker}. */
export function deriveKalshiEventTicker(ticker: string, eventTicker?: string): string {
  const fromApi = eventTicker?.trim();
  if (fromApi) return fromApi;
  const safe = ticker.trim();
  const game = safe.match(/^(KX?[A-Z0-9]+GAME-\d{2}[A-Z]{3}\d{2}[A-Z0-9]+)-[A-Z0-9]+$/i);
  return game?.[1] ?? safe;
}

export function kalshiMarketPageUrl(ticker: string, eventTicker?: string): string {
  const template = process.env.KALSHI_MARKET_URL_TEMPLATE?.trim();
  const safe = ticker.trim();
  if (!safe) return "https://kalshi.com";
  const event = deriveKalshiEventTicker(safe, eventTicker);
  const series = (event.split("-")[0] || safe.split("-")[0] || safe).toLowerCase();
  const eventPath = event.toLowerCase();
  if (template?.includes("{ticker}") || template?.includes("{event}") || template?.includes("{series}")) {
    return template
      .split("{ticker}").join(encodeURIComponent(safe))
      .split("{series}").join(encodeURIComponent(series))
      .split("{event}").join(encodeURIComponent(eventPath));
  }
  const url = `https://kalshi.com/markets/${encodeURIComponent(series)}/x/${encodeURIComponent(eventPath)}`;
  if (safe.toUpperCase() === event.toUpperCase()) return url;
  return `${url}?op_market_ticker=${encodeURIComponent(safe.toUpperCase())}`;
}

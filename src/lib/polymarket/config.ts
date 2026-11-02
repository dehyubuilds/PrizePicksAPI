export function polymarketIntegrationEnabled(): boolean {
  const raw = process.env.POLYMARKET_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return raw === "true" || raw === "1" || raw === "yes";
}

export function polymarketGammaBaseUrl(): string {
  return (
    process.env.POLYMARKET_GAMMA_BASE_URL?.trim().replace(/\/$/, "") ||
    "https://gamma-api.polymarket.com"
  );
}

export function polymarketClobBaseUrl(): string {
  return (
    process.env.POLYMARKET_CLOB_BASE_URL?.trim().replace(/\/$/, "") ||
    "https://clob.polymarket.com"
  );
}

export function polymarketMarketPageUrl(slug: string): string {
  const safe = slug.trim();
  if (!safe) return "https://polymarket.com";
  return `https://polymarket.com/event/${encodeURIComponent(safe)}`;
}

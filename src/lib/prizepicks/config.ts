export function prizepicksIntegrationEnabled(): boolean {
  const raw = process.env.PRIZEPICKS_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function prizepicksApiBaseUrl(): string {
  return (
    process.env.PRIZEPICKS_API_BASE_URL?.trim().replace(/\/$/, "") ||
    "https://api.prizepicks.com"
  );
}

/** Sync env-only cookie (Netlify parts 1–3). */
export { prizepicksBrowserCookieFromEnv as prizepicksBrowserCookie } from "./browser-cookie";

/** Comma-separated proxy URLs (http://user:pass@host:port) for Cloudflare-heavy regions. */
export function prizepicksProxyList(): string[] {
  const raw = process.env.PRIZEPICKS_PROXY_LIST?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

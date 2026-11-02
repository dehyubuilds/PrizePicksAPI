import { config } from "./config";

/**
 * Canonical public origin for share/copy links, Stripe return URLs, and marketing.
 * Client-safe — no secrets. Mirrors `config.app.baseUrl` (no circular import: config does not import this module).
 */
export const PUBLIC_SITE_ORIGIN = config.app.baseUrl.replace(/\/$/, "");

/** Site-wide share / OG title — brand is already in the OG image. */
export const DROPFLOW_SITE_SHARE_TITLE = "Discover & sell original tracks";

/**
 * Native share sheet title. Omits redundant “Dropflow” when the OG image already shows the brand.
 */
export function shareTitleLine(appOrProductName: string): string {
  const name = appOrProductName.trim();
  const brand = config.app.name.trim() || "Dropflow";
  if (!name || name.toLowerCase() === brand.toLowerCase()) {
    return DROPFLOW_SITE_SHARE_TITLE;
  }
  return name;
}

export function absolutePublicUrl(path: string): string {
  const base = config.app.baseUrl.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

/** Buyer library tab — always on the canonical Dropflow site (not a Netlify preview host). */
export function dropflowMyTracksUrl(): string {
  return absolutePublicUrl("/?mode=my-tracks");
}

/**
 * Stripe success/cancel URLs: keep path + query from the client but force canonical origin
 * so preview deploys never strand buyers on *.netlify.app after checkout.
 */
function checkoutPathFromInput(value: string): string {
  const t = value.trim();
  if (!t) return "";
  if (t.startsWith("/")) return t;
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      return `${u.pathname}${u.search}`;
    } catch {
      return "";
    }
  }
  return t.startsWith("/") ? t : `/${t}`;
}

export function resolveCanonicalCheckoutUrl(
  input: string | undefined | null,
  fallbackPath: string
): string {
  const base = config.app.baseUrl.replace(/\/$/, "");
  const fallback = checkoutPathFromInput(fallbackPath) || "/";
  const raw = (input ?? "").trim();
  if (!raw) return `${base}${fallback}`;
  const path = checkoutPathFromInput(raw);
  return path ? `${base}${path}` : `${base}${fallback}`;
}

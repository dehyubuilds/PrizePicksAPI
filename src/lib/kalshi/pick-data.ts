import { kalshiMarketPageUrl } from "./config";
import type { KalshiPickData, KalshiPickSide } from "./types";
import { escapeHtml } from "@/lib/playlist-insights/picks-html";

function parseSide(raw: unknown): KalshiPickSide | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "yes" || value === "no") return value;
  return null;
}

function parseImpliedProbability(raw: unknown, currentPrice?: string): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.min(100, Math.round(raw)));
  }
  if (currentPrice) {
    const n = Number.parseFloat(currentPrice);
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(n * 100)));
  }
  return undefined;
}

/** Normalize GPT Kalshi payload; invalid rows become available=false. */
export function parseKalshiPickData(raw: unknown): KalshiPickData {
  if (!raw || typeof raw !== "object") {
    return { available: false };
  }
  const row = raw as Record<string, unknown>;
  const available = row.available === true;
  if (!available) {
    return { available: false };
  }

  const ticker = String(row.ticker ?? "").trim();
  const marketTitle = String(row.marketTitle ?? "").trim();
  const pickedSide = parseSide(row.pickedSide);
  const currentPrice = String(row.currentPrice ?? "").trim();
  const volume = String(row.volume ?? "").trim();
  const closeTime = String(row.closeTime ?? "").trim();
  const settlementRules = String(row.settlementRules ?? "").trim().slice(0, 500);
  const impliedProbability = parseImpliedProbability(row.impliedProbability, currentPrice);
  const marketUrl = ticker ? kalshiMarketPageUrl(ticker) : undefined;

  if (!ticker || !pickedSide) {
    return { available: false };
  }

  return {
    available: true,
    ticker,
    marketTitle: marketTitle || undefined,
    pickedSide,
    currentPrice: currentPrice || undefined,
    impliedProbability,
    volume: volume || undefined,
    closeTime: closeTime || undefined,
    settlementRules: settlementRules || undefined,
    marketUrl,
  };
}

function kalshiMarketLabel(kalshi: KalshiPickData): string {
  return kalshi.marketTitle?.trim() || kalshi.ticker?.trim() || "Related market";
}

function formatKalshiPriceLabel(kalshi: KalshiPickData): string | null {
  const price = kalshi.currentPrice?.trim();
  if (price) {
    const n = Number.parseFloat(price);
    if (Number.isFinite(n)) {
      const cents = Math.round(n * 100);
      const implied =
        typeof kalshi.impliedProbability === "number"
          ? kalshi.impliedProbability
          : Math.max(0, Math.min(100, Math.round(n * 100)));
      return `${cents}¢ per share (~${implied}% implied chance)`;
    }
    return `$${price} per share`;
  }
  if (typeof kalshi.impliedProbability === "number") {
    return `~${kalshi.impliedProbability}% implied chance`;
  }
  return null;
}

function formatKalshiAlignmentLine(kalshi: KalshiPickData): string {
  const side = kalshi.pickedSide ?? "yes";
  const sidePhrase =
    side === "yes"
      ? "Yes — the crowd leans toward this happening"
      : "No — the crowd leans toward this not happening";
  const priceLabel = formatKalshiPriceLabel(kalshi);
  return priceLabel ? `Our pick aligns with ${sidePhrase} · ${priceLabel}` : `Our pick aligns with ${sidePhrase}`;
}

/** Plain-text Kalshi hint for admin panels and status toasts. */
export function formatKalshiAdminHint(kalshi?: KalshiPickData, compact = false): string {
  if (!kalshi?.available || !kalshi.ticker) {
    return "Kalshi: no matching prediction market for this pick.";
  }

  const title = kalshiMarketLabel(kalshi);
  const priceLabel = formatKalshiPriceLabel(kalshi);
  const side = kalshi.pickedSide ?? "yes";
  const sideWord = side === "yes" ? "Yes" : "No";

  if (compact) {
    const titleShort = title.length > 72 ? `${title.slice(0, 71)}…` : title;
    const priceBit = priceLabel ? ` · ${priceLabel}` : "";
    return `Kalshi: pick aligns with ${sideWord} on “${titleShort}”${priceBit}`;
  }

  const parts = [
    `Kalshi cross-check: “${title}”.`,
    `Our pick aligns with ${sideWord} (${side === "yes" ? "traders lean this will happen" : "traders lean this will not happen"}).`,
  ];
  if (priceLabel) parts.push(`Market price: ${priceLabel}.`);
  return parts.join(" ");
}

export function formatKalshiDiscordLine(kalshi?: KalshiPickData): string | null {
  if (!kalshi?.available || !kalshi.ticker) return null;
  const title = kalshiMarketLabel(kalshi);
  const url = kalshi.marketUrl ?? kalshiMarketPageUrl(kalshi.ticker);
  const alignment = formatKalshiAlignmentLine(kalshi);
  return `**Kalshi cross-check** — [${title}](${url})\n${alignment}`;
}

export function renderKalshiBadgeHtml(kalshi?: KalshiPickData): string {
  if (!kalshi?.available || !kalshi.ticker) return "";
  const title = escapeHtml(kalshiMarketLabel(kalshi));
  const url = escapeHtml(kalshi.marketUrl ?? kalshiMarketPageUrl(kalshi.ticker));
  const alignment = escapeHtml(formatKalshiAlignmentLine(kalshi));
  const settlement = kalshi.settlementRules?.trim()
    ? `<p class="kalshi-settlement">${escapeHtml(kalshi.settlementRules)}</p>`
    : "";
  return `<div class="kalshi-badge">
      <p class="kalshi-label">Kalshi prediction market · cross-check</p>
      <p class="kalshi-title"><a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a></p>
      <p class="kalshi-pick">${alignment}</p>
      <p class="kalshi-explainer">Kalshi is a regulated prediction market. People trade Yes/No shares on real events; the share price (1–99¢) reflects the crowd’s estimated probability.</p>
      ${settlement}
      <p class="kalshi-note">Market data for education only — not financial advice. See Kalshi for official rules.</p>
    </div>`;
}

export const KALSHI_GPT_INSTRUCTIONS = `
Kalshi prediction market data may appear below the transcripts. When Kalshi markets are present:
- Prefer picks that map to a listed Kalshi market when the transcript supports it.
- Include a "kalshi" object on each pick (free pick and every premium pick).
- If a matching Kalshi market exists: set kalshi.available=true and include ticker (exact from data), marketTitle, pickedSide ("yes" or "no"), currentPrice (yes_bid_dollars for YES picks, no_bid for NO picks), impliedProbability (0-100), volume, closeTime, and a one-sentence settlementRules summary from the rules text.
- If no suitable Kalshi market exists: set kalshi.available=false and omit other kalshi fields.
- Do not invent tickers or prices not present in the Kalshi section.
- Keep pickCard plain text without URLs or Kalshi prices (Kalshi details go in kalshi object and on the web page only).`;

export const KALSHI_JSON_SCHEMA_SNIPPET = `
  "kalshi": {
    "available": boolean,
    "ticker": string,
    "marketTitle": string,
    "pickedSide": "yes" | "no",
    "currentPrice": string,
    "impliedProbability": number,
    "volume": string,
    "closeTime": string,
    "settlementRules": string
  }`;

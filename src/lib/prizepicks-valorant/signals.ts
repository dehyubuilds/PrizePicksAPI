import type { EvidenceStatus, IntelItem } from "./types";

const STALE_MS = 36 * 60 * 60 * 1000;
const OFFICIAL_HOST = /(^|\.)valorantesports\.com$|(^|\.)riotgames\.com$/i;

export function classifyEvidence(input: {
  url: string | null;
  publishedAt: string | null;
  nowIso: string;
  supportingUrls: string[];
  contradicted: boolean;
}): EvidenceStatus {
  if (input.contradicted) return "CONTRADICTED";
  const published = Date.parse(input.publishedAt ?? "");
  const now = Date.parse(input.nowIso);
  if (Number.isFinite(published) && Number.isFinite(now) && now - published > STALE_MS) return "STALE";
  if (!input.url) return "UNVERIFIED";
  let host = "";
  try {
    host = new URL(input.url).hostname;
  } catch {
    return "UNVERIFIED";
  }
  if (OFFICIAL_HOST.test(host)) return "CONFIRMED";
  const independent = input.supportingUrls.filter((url) => url && url !== input.url);
  if (independent.length >= 1) return "CORROBORATED";
  return "UNVERIFIED";
}

export type RawSignal = {
  url?: string | null;
  author?: string | null;
  handle?: string | null;
  publishedAt?: string | null;
  player?: string | null;
  team?: string | null;
  claim?: string;
  contradicted?: boolean;
  supportingUrls?: string[];
  kind?: string;
};

/** A roster or role claim does not change the kill number unless a measured effect is supplied by history. */
export function interpretSignal(raw: RawSignal, matchId: string, nowIso: string): IntelItem {
  const supportingUrls = (raw.supportingUrls ?? []).map((url) => url.trim()).filter(Boolean);
  const status = classifyEvidence({
    url: raw.url ?? null,
    publishedAt: raw.publishedAt ?? null,
    nowIso,
    supportingUrls,
    contradicted: raw.contradicted === true,
  });
  const role = /roster|substitut|lineup|agent|role|map pool|patch/i.test(`${raw.kind ?? ""} ${raw.claim ?? ""}`);
  const usable = status === "CONFIRMED" || status === "CORROBORATED";
  return {
    matchId,
    url: raw.url?.trim() || null,
    author: raw.author?.trim() || null,
    handle: raw.handle?.trim()?.replace(/^@/, "") || null,
    publishedAt: raw.publishedAt ?? null,
    retrievedAt: nowIso,
    player: raw.player?.trim() || null,
    team: raw.team?.trim() || null,
    claim: raw.claim?.trim() || "",
    status,
    supportingUrls,
    effect: usable && role ? "ROLE_CHANGE_RISK" : status === "UNVERIFIED" || status === "STALE" ? "MODEL_UNCERTAINTY_INCREASED" : "none",
    measuredKillDelta: null,
  };
}

export function acceptHandle(handle: string | null, url: string | null): string | null {
  if (!handle || !url) return null;
  try {
    const host = new URL(url).hostname;
    if (!/(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(host)) return null;
  } catch {
    return null;
  }
  const cleaned = handle.trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{2,15}$/.test(cleaned)) return null;
  return cleaned;
}

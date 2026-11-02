import { newestSourceMs } from "./validate";
import type { IntelligenceSource, MarketAwareness, NormalizedMarket } from "./types";

const NEW_MS = 2 * 60 * 60 * 1000;
const STALE_MS = 8 * 60 * 60 * 1000;

export function classifyMarketAwareness(params: {
  sources: IntelligenceSource[];
  market?: NormalizedMarket;
  seenBefore?: boolean;
  nowMs?: number;
}): MarketAwareness {
  const nowMs = params.nowMs ?? Date.now();
  if (!params.sources.length) return "SPECULATIVE";
  const newest = newestSourceMs(params.sources, nowMs);
  if (newest === null) return "SPECULATIVE";
  const age = nowMs - newest;
  if (params.seenBefore) return "BROADLY_KNOWN";
  if (age <= NEW_MS) return "NEWLY_EMERGED";
  if (age <= STALE_MS) return "POSSIBLY_UNDER_REFLECTED";

  const boardMs = params.market?.raw.updatedAt
    ? new Date(params.market.raw.updatedAt).getTime()
    : params.market?.raw.boardTime
      ? new Date(params.market.raw.boardTime).getTime()
      : NaN;
  if (Number.isFinite(boardMs) && newest < boardMs) return "BROADLY_KNOWN";
  return "BROADLY_KNOWN";
}

export function freshnessMinutes(sources: IntelligenceSource[], nowMs = Date.now()): number {
  const newest = newestSourceMs(sources, nowMs);
  if (newest === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.round((nowMs - newest) / 60_000));
}

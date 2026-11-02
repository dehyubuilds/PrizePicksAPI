import { pickLineForProjection } from "@/lib/edge-finder/match-markets";
import type { EdgeScanPick } from "@/lib/edge-finder/types";
import { fetchPrizePicksProjections } from "@/lib/prizepicks";
import type { PrizePicksProjection } from "@/lib/prizepicks/types";
import { filterPostableEdgePicks, sortPostableEdgePicks } from "./select-postable-pick";

import { PRIZEPICKS_APP_BASE_URL } from "@/lib/prizepicks/board-url";

export const PRIZEPICKS_APP_URL = `${PRIZEPICKS_APP_BASE_URL}/`;

/** Reject props starting within this window — avoids tip-off lock between tweet and tap. */
export const START_TIME_BUFFER_MS = 15 * 60 * 1000;

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function linesEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}

function isStandardOddsType(oddsType: string): boolean {
  return oddsType.trim().toLowerCase() === "standard";
}

/** Any PrizePicks row still enterable before tip-off (with start buffer). */
export function isPlayablePrizePicksProjection(
  projection: PrizePicksProjection,
  nowMs = Date.now()
): boolean {
  if (projection.status.trim().toLowerCase() === "inactive") return false;
  if (projection.status.trim().toLowerCase() !== "pre_game") return false;
  const startMs = new Date(projection.startTime).getTime();
  if (!Number.isFinite(startMs) || startMs <= nowMs + START_TIME_BUFFER_MS) return false;
  return true;
}

export function boardGroupKey(projection: Pick<
  PrizePicksProjection,
  "playerName" | "statType" | "gameId"
>): string {
  return [
    normalizeToken(projection.playerName),
    normalizeToken(projection.statType),
    normalizeToken(projection.gameId),
  ].join("|");
}

/** @deprecated Use boardGroupKey */
export const demonBoardGroupKey = boardGroupKey;

/**
 * Canonical board line per slot: lowest playable **standard** line.
 * Slots without a standard line are omitted (automation skips them).
 */
export function canonicalLiveLinesByBoardSlot(
  projections: PrizePicksProjection[],
  nowMs = Date.now()
): Map<string, PrizePicksProjection> {
  const grouped = new Map<string, PrizePicksProjection[]>();
  for (const projection of projections) {
    if (!isPlayablePrizePicksProjection(projection, nowMs)) continue;
    if (!isStandardOddsType(projection.oddsType)) continue;
    const key = boardGroupKey(projection);
    const rows = grouped.get(key) ?? [];
    rows.push(projection);
    grouped.set(key, rows);
  }

  const canonical = new Map<string, PrizePicksProjection>();
  for (const [key, rows] of Array.from(grouped.entries())) {
    const lowest = rows.reduce((best: PrizePicksProjection, row: PrizePicksProjection) =>
      row.lineScore < best.lineScore ? row : best
    );
    canonical.set(key, lowest);
  }
  return canonical;
}

/** @deprecated Use canonicalLiveLinesByBoardSlot */
export const canonicalLiveDemonsByBoardSlot = canonicalLiveLinesByBoardSlot;

export function projectionCompositeKey(
  projection: Pick<
    PrizePicksProjection,
    "playerName" | "statType" | "statDisplayName" | "lineScore" | "gameId" | "oddsType"
  >
): string {
  return [
    normalizeToken(projection.playerName),
    normalizeToken(projection.statType),
    normalizeToken(projection.statDisplayName),
    projection.lineScore.toFixed(1),
    normalizeToken(projection.gameId),
    normalizeToken(projection.oddsType),
  ].join("|");
}

/** @deprecated Use projectionCompositeKey */
export const demonCompositeKey = projectionCompositeKey;

export function edgePickMatchesLiveProjection(
  pick: EdgeScanPick,
  live: PrizePicksProjection
): boolean {
  if (pick.prizepicksProjectionId !== live.id) return false;
  if (!linesEqual(pick.lineScore, live.lineScore)) return false;
  if (normalizeToken(pick.playerName) !== normalizeToken(live.playerName)) return false;
  if (normalizeToken(pick.statType) !== normalizeToken(live.statType)) return false;
  if (normalizeToken(pick.statDisplayName) !== normalizeToken(live.statDisplayName)) return false;
  if (normalizeToken(pick.oddsType) !== normalizeToken(live.oddsType)) return false;
  if (normalizeToken(pick.projection?.gameId ?? "") !== normalizeToken(live.gameId)) return false;
  return isPlayablePrizePicksProjection(live);
}

export function refreshEdgePickFromLive(
  pick: EdgeScanPick,
  live: PrizePicksProjection
): EdgeScanPick {
  return {
    ...pick,
    id: `${live.id}:${pick.side}`,
    prizepicksProjectionId: live.id,
    playerName: live.playerName,
    sport: live.leagueName,
    team: live.team,
    opponent: live.opponent,
    statDisplayName: live.statDisplayName,
    statType: live.statType,
    lineScore: live.lineScore,
    oddsType: live.oddsType,
    startTime: live.startTime,
    pickLine: pickLineForProjection(live, pick.side),
    projection: live,
  };
}

export function resolveExactLivePickForPick(
  pick: EdgeScanPick,
  canonicalBySlot: Map<string, PrizePicksProjection>
): PrizePicksProjection | null {
  if (!isStandardOddsType(pick.oddsType)) return null;

  const slotKey = boardGroupKey({
    playerName: pick.playerName,
    statType: pick.statType,
    gameId: pick.projection?.gameId ?? "",
  });
  const canonical = canonicalBySlot.get(slotKey);
  if (!canonical) return null;
  if (pick.prizepicksProjectionId !== canonical.id) return null;
  if (!edgePickMatchesLiveProjection(pick, canonical)) return null;

  const pickComposite = projectionCompositeKey({
    playerName: pick.playerName,
    statType: pick.statType,
    statDisplayName: pick.statDisplayName,
    lineScore: pick.lineScore,
    gameId: pick.projection?.gameId ?? "",
    oddsType: pick.oddsType,
  });
  if (pickComposite !== projectionCompositeKey(canonical)) return null;
  return canonical;
}

export function livePrizePicksProjectionMap(
  projections: PrizePicksProjection[]
): Map<string, PrizePicksProjection> {
  const map = new Map<string, PrizePicksProjection>();
  for (const projection of projections) {
    if (isPlayablePrizePicksProjection(projection) && isStandardOddsType(projection.oddsType)) {
      map.set(projection.id, projection);
    }
  }
  return map;
}

export async function fetchLivePrizePicksBoard(): Promise<{
  projections: PrizePicksProjection[];
  canonicalBySlot: Map<string, PrizePicksProjection>;
  byId: Map<string, PrizePicksProjection>;
}> {
  const result = await fetchPrizePicksProjections({
    forceLive: true,
    disallowCacheFallback: true,
  });
  const canonicalBySlot = canonicalLiveLinesByBoardSlot(result.projections);
  return {
    projections: result.projections,
    canonicalBySlot,
    byId: livePrizePicksProjectionMap(result.projections),
  };
}

export function filterPicksOnLivePrizePicksBoard(
  picks: EdgeScanPick[],
  canonicalBySlot: Map<string, PrizePicksProjection>
): EdgeScanPick[] {
  return picks.flatMap((pick) => {
    const live = resolveExactLivePickForPick(pick, canonicalBySlot);
    return live ? [refreshEdgePickFromLive(pick, live)] : [];
  });
}

/** @deprecated Use filterPicksOnLivePrizePicksBoard */
export const filterDemonsOnLivePrizePicksBoard = filterPicksOnLivePrizePicksBoard;

export async function selectLiveAvailableEdgePick(params: {
  edgePicks: EdgeScanPick[];
  postedPickIds: string[];
}): Promise<EdgeScanPick | null> {
  const { canonicalBySlot } = await fetchLivePrizePicksBoard();
  const posted = new Set(params.postedPickIds);
  const candidates = sortPostableEdgePicks(
    filterPicksOnLivePrizePicksBoard(filterPostableEdgePicks(params.edgePicks), canonicalBySlot)
  ).filter((pick) => !posted.has(pick.id));
  return candidates[0] ?? null;
}

/** @deprecated Use selectLiveAvailableEdgePick */
export async function selectLiveAvailableDemonPick(params: {
  demonWatchlist: EdgeScanPick[];
  postedPickIds: string[];
}): Promise<EdgeScanPick | null> {
  return selectLiveAvailableEdgePick({
    edgePicks: params.demonWatchlist,
    postedPickIds: params.postedPickIds,
  });
}

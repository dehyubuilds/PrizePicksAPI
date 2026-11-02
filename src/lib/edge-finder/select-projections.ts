import type { PrizePicksProjection } from "@/lib/prizepicks/types";

export const MAX_EDGE_SCAN_PROJECTIONS = 600;

function oddsTypeRank(oddsType: string): number {
  const value = oddsType.trim().toLowerCase();
  if (value === "demon") return 0;
  if (value === "goblin") return 1;
  return 2;
}

function projectionKey(projection: PrizePicksProjection): string {
  return [
    projection.playerName,
    projection.statType,
    projection.lineScore,
    projection.gameId,
    projection.oddsType,
  ].join("|");
}

export function selectProjectionsForEdgeScan(
  projections: PrizePicksProjection[],
  max = MAX_EDGE_SCAN_PROJECTIONS
): {
  selected: PrizePicksProjection[];
  totalRaw: number;
  totalScannable: number;
} {
  const totalRaw = projections.length;
  const scannable = projections.filter((row) => row.status !== "inactive");

  const seen = new Set<string>();
  const deduped: PrizePicksProjection[] = [];
  for (const projection of scannable) {
    const key = projectionKey(projection);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(projection);
  }

  deduped.sort((a, b) => {
    const oddsDiff = oddsTypeRank(a.oddsType) - oddsTypeRank(b.oddsType);
    if (oddsDiff !== 0) return oddsDiff;
    const aTime = new Date(a.startTime).getTime();
    const bTime = new Date(b.startTime).getTime();
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
      return aTime - bTime;
    }
    return a.playerName.localeCompare(b.playerName);
  });

  return {
    selected: deduped.slice(0, max),
    totalRaw,
    totalScannable: deduped.length,
  };
}

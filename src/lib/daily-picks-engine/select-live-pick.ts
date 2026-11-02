import type { EdgeScanPick } from "@/lib/edge-finder/types";
import {
  fetchLivePrizePicksBoard,
  filterPicksOnLivePrizePicksBoard,
} from "@/lib/edge-finder-automation/prizepicks-live";
import { filterPostableDailyPicks } from "./select-postable-pick";
import { sortDailyPicks } from "./rank-picks";
import type { DailyModelPickMeta } from "./types";

export async function selectLiveAvailableDailyPick(params: {
  picks: EdgeScanPick[];
  pickMetas: Record<string, DailyModelPickMeta>;
  postedPickIds: string[];
}): Promise<{ pick: EdgeScanPick; meta: DailyModelPickMeta } | null> {
  const { canonicalBySlot } = await fetchLivePrizePicksBoard();
  const posted = new Set(params.postedPickIds);
  const livePicks = filterPicksOnLivePrizePicksBoard(
    filterPostableDailyPicks(params.picks),
    canonicalBySlot
  );
  const metas = new Map(Object.entries(params.pickMetas));
  const sorted = sortDailyPicks(livePicks, metas).filter((pick) => !posted.has(pick.id));

  for (const pick of sorted) {
    const meta = params.pickMetas[pick.id];
    if (meta) return { pick, meta };
  }
  return null;
}

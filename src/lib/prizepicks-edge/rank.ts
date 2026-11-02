import type { EdgeScanPick } from "@/lib/edge-finder/types";
import type { GrokEdgePick } from "./grok";
import { mechanicalPriority } from "./shortlist";
import type { EdgeOpportunity, EdgePriority } from "./types";

const PRIORITY_ORDER: Record<EdgePriority, number> = { now: 0, watch: 1, pass: 2 };

function sourcesFor(pick: EdgeScanPick, grok: boolean) {
  return {
    prizepicks: true as const,
    kalshi: Boolean(pick.kalshi),
    polymarket: Boolean(pick.polymarket),
    grok,
  };
}

export function opportunitiesFromMechanical(
  candidates: EdgeScanPick[],
  count: number
): EdgeOpportunity[] {
  return candidates
    .map((pick) => ({
      rank: 0,
      priority: mechanicalPriority(pick),
      pick,
      explanation: pick.reasoning,
      sources: sourcesFor(pick, false),
    }))
    .filter((row) => row.priority !== "pass")
    .sort((a, b) => {
      const pri = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (pri !== 0) return pri;
      return (b.pick.edgePercent ?? -999) - (a.pick.edgePercent ?? -999);
    })
    .slice(0, count)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function mergeGrokOpportunities(params: {
  candidates: EdgeScanPick[];
  grok: GrokEdgePick[];
  count: number;
}): EdgeOpportunity[] {
  const byId = new Map(params.candidates.map((pick) => [`${pick.prizepicksProjectionId}:${pick.side}`, pick]));
  const used = new Set<string>();
  const merged: EdgeOpportunity[] = [];

  for (const grok of params.grok) {
    const key = `${grok.projectionId}:${grok.side}`;
    const pick = byId.get(key);
    if (!pick || used.has(key)) continue;
    used.add(key);
    if (grok.veto || grok.priority === "pass") continue;
    merged.push({
      rank: grok.rank,
      priority: grok.priority,
      pick,
      explanation: grok.explanation,
      xSignal: grok.xSignal,
      grokConfidence: grok.confidence,
      sources: sourcesFor(pick, true),
    });
  }

  if (merged.length < params.count) {
    for (const pick of params.candidates) {
      const key = `${pick.prizepicksProjectionId}:${pick.side}`;
      if (used.has(key)) continue;
      const priority = mechanicalPriority(pick);
      if (priority === "pass") continue;
      if ((pick.edgePercent ?? 0) < 4) continue;
      used.add(key);
      merged.push({
        rank: 100 + merged.length,
        priority: "watch",
        pick,
        explanation: pick.reasoning,
        sources: sourcesFor(pick, false),
      });
      if (merged.length >= params.count) break;
    }
  }

  return merged
    .sort((a, b) => {
      const pri = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (pri !== 0) return pri;
      if (a.rank !== b.rank) return a.rank - b.rank;
      return (b.pick.edgePercent ?? -999) - (a.pick.edgePercent ?? -999);
    })
    .slice(0, params.count)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

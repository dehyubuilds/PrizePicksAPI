import type { EdgeScanPick } from "@/lib/edge-finder/types";
import type { PrizePicksProjection } from "@/lib/prizepicks/types";
import type { IntelligenceSignal } from "@/lib/prizepicks-intelligence/types";
import type { EdgeOpportunity, PickDelta } from "./types";
import { formatDeltaLines } from "./history";

export function isActionableSignal(signal: IntelligenceSignal): boolean {
  if (signal.direction !== "UP" && signal.direction !== "DOWN") return false;
  if (signal.verdict === "LIKELY_ALREADY_REFLECTED") return false;
  if (signal.marketAwareness === "BROADLY_KNOWN" || signal.marketAwareness === "SPECULATIVE") return false;
  return (
    signal.marketAwareness === "NEWLY_EMERGED" || signal.marketAwareness === "POSSIBLY_UNDER_REFLECTED"
  );
}

function normalizeStat(value: string): string {
  return value.trim().toLowerCase();
}

export function findProjectionForSignal(
  signal: IntelligenceSignal,
  projections: PrizePicksProjection[]
): PrizePicksProjection | undefined {
  const byId = projections.find((row) => row.id === signal.marketId);
  if (byId) return byId;

  const player = signal.player.trim().toLowerCase();
  const stat = normalizeStat(signal.statType);
  const matches = projections.filter((row) => {
    if (row.playerName.trim().toLowerCase() !== player) return false;
    const hay = `${row.statDisplayName} ${row.statType}`.toLowerCase();
    return hay.includes(stat) || stat.includes(normalizeStat(row.statType)) || stat.includes(normalizeStat(row.statDisplayName));
  });
  return matches.find((row) => row.oddsType.trim().toLowerCase() === "standard") ?? matches[0];
}

function pickLineFor(projection: PrizePicksProjection, side: "over" | "under"): string {
  const stat = projection.statDisplayName || projection.statType;
  return `${projection.playerName} ${side === "over" ? "Over" : "Under"} ${projection.lineScore} ${stat}`;
}

export function opportunityFromSignal(
  signal: IntelligenceSignal,
  projection: PrizePicksProjection
): EdgeOpportunity {
  const side = signal.direction === "UP" ? "over" : "under";
  const high = signal.evidenceConfidence === "HIGH";
  const now = signal.marketAwareness === "NEWLY_EMERGED";
  const pick: EdgeScanPick = {
    id: `intel:${signal.signalId}:${side}`,
    prizepicksProjectionId: projection.id,
    playerName: projection.playerName,
    sport: signal.sport || projection.leagueName,
    team: projection.team,
    opponent: projection.opponent,
    statDisplayName: projection.statDisplayName || signal.statType,
    statType: projection.statType || signal.statType,
    lineScore: projection.lineScore,
    side,
    oddsType: projection.oddsType || "standard",
    startTime: projection.startTime,
    pickLine: pickLineFor(projection, side),
    prizepicksImpliedProb: 50,
    kalshiImpliedProb: null,
    adjustedProb: null,
    edgePercent: null,
    confidenceScore: high ? 80 : 62,
    confidenceLabel: high ? "high" : "medium",
    category: "premium",
    reasoning: signal.whyNow,
    kalshi: null,
    projection,
  };
  return {
    rank: 0,
    priority: now ? "now" : "watch",
    pick,
    explanation: [signal.whatChanged, signal.whyItMatters].filter(Boolean).join(" "),
    xSignal: signal.whyNow,
    grokConfidence: pick.confidenceScore,
    sources: { prizepicks: true, kalshi: false, polymarket: false, grok: true },
  };
}

export function opportunitiesFromSignals(params: {
  signals: IntelligenceSignal[];
  projections: PrizePicksProjection[];
}): EdgeOpportunity[] {
  const rows: EdgeOpportunity[] = [];
  const used = new Set<string>();
  for (const signal of params.signals) {
    if (!isActionableSignal(signal)) continue;
    const projection = findProjectionForSignal(signal, params.projections);
    if (!projection) continue;
    const row = opportunityFromSignal(signal, projection);
    const key = `${row.pick.playerName}|${row.pick.statDisplayName}|${row.pick.side}`.toLowerCase();
    if (used.has(key)) continue;
    used.add(key);
    rows.push(row);
  }
  return rows;
}

function pickKey(row: EdgeOpportunity): string {
  return `${row.pick.playerName}|${row.pick.statDisplayName}|${row.pick.side}`.toLowerCase();
}

function appendUnique(
  source: EdgeOpportunity[],
  dest: EdgeOpportunity[],
  seen: Set<string>,
  count: number
): void {
  for (const row of source) {
    if (dest.length >= count) return;
    const key = pickKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    dest.push(row);
  }
}

/** News-backed TAKE picks first, then Kalshi/Poly venue ranking. */
export function mergeIntelAndVenue(params: {
  intel: EdgeOpportunity[];
  venue: EdgeOpportunity[];
  count: number;
}): EdgeOpportunity[] {
  const seen = new Set<string>();
  const merged: EdgeOpportunity[] = [];
  appendUnique(
    params.intel.filter((row) => row.priority === "now"),
    merged,
    seen,
    params.count
  );
  appendUnique(
    params.venue.filter((row) => row.priority === "now"),
    merged,
    seen,
    params.count
  );
  appendUnique(
    params.intel.filter((row) => row.priority === "watch"),
    merged,
    seen,
    params.count
  );
  appendUnique(
    params.venue.filter((row) => row.priority === "watch"),
    merged,
    seen,
    params.count
  );
  return merged.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function formatPicksTerminal(params: {
  opportunities: EdgeOpportunity[];
  sports: string[];
  intelCount: number;
  rejectedCount: number;
  incompleteCount?: number;
  incompleteEvents?: string[];
  pageUrl?: string;
  researchPath?: string;
  delta?: PickDelta;
}): string {
  const take = params.opportunities.filter((row) => row.priority === "now");
  const watch = params.opportunities.filter((row) => row.priority === "watch");
  const lines = [
    "PRIZEPICKS PICKS",
    params.sports.join(" / "),
    "",
  ];
  if (params.delta) {
    lines.push(...formatDeltaLines(params.delta));
    lines.push("");
  }
  if (params.incompleteCount) {
    lines.push(
      `News research did not finish on ${params.incompleteCount} game${params.incompleteCount === 1 ? "" : "s"}${
        params.incompleteEvents?.length ? ` (${params.incompleteEvents.join("; ")})` : ""
      }. That is not a reject — those games were never judged and could have changed the board.`
    );
    lines.push("");
  } else if (!take.length && params.intelCount === 0) {
    lines.push("No overnight news edge — ranked on PrizePicks vs Kalshi/Polymarket.");
    lines.push("");
  }
  lines.push("TAKE");
  if (!take.length) {
    lines.push("None.");
  } else {
    for (const row of take) {
      lines.push(`${row.rank}. ${row.pick.pickLine}`);
      lines.push(`   ${row.explanation}`);
      if (row.xSignal) lines.push(`   why: ${row.xSignal}`);
    }
  }
  lines.push("");
  lines.push("WATCH — not ready. Don’t monitor these. Run this again and SINCE LAST RUN will say if one became a TAKE.");
  if (!watch.length) {
    lines.push("None.");
  } else {
    for (const row of watch) {
      const edge =
        row.pick.edgePercent == null
          ? ""
          : `  ${row.pick.edgePercent >= 0 ? "+" : ""}${row.pick.edgePercent}%`;
      lines.push(`${row.rank}. ${row.pick.pickLine}${edge}`);
      lines.push(`   ${row.explanation}`);
    }
  }
  lines.push("");
  if (params.incompleteCount) {
    lines.push(`Research incomplete: ${params.incompleteCount} games`);
  }
  if (params.rejectedCount) {
    lines.push(`News theses rejected: ${params.rejectedCount}`);
  }
  if (params.researchPath) lines.push(`Research: ${params.researchPath}`);
  if (params.pageUrl) lines.push(params.pageUrl);
  return lines.join("\n");
}

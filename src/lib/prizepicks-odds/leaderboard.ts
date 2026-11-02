import type { EvaluatedProp } from "./evaluate";
import { BOARD_SPORTS } from "./features";
import { lineIsStale } from "./select";

export type RankMode = "probability" | "ev" | "entry" | "opportunity" | "confidence";

function actionable(prop: EvaluatedProp): boolean {
  return prop.rejectionReasons.length === 0 && prop.marketProbability != null && (prop.dataQuality === "market" || prop.dataQuality === "interpolated");
}

function confidenceOrder(a: EvaluatedProp, b: EvaluatedProp): number {
  const clean = (prop: EvaluatedProp) =>
    prop.researchStatus === "completed" &&
    prop.probabilitySource === "direct" &&
    !(prop.researchFlags ?? []).some((flag) => flag.startsWith("unverified") || flag === "minutes_restriction" || flag === "conflicting_reports");
  if (clean(a) !== clean(b)) return clean(a) ? -1 : 1;
  if ((b.books ?? 0) !== (a.books ?? 0)) return b.books - a.books;
  const aRange = a.bookRange ? a.bookRange.high - a.bookRange.low : 100;
  const bRange = b.bookRange ? b.bookRange.high - b.bookRange.low : 100;
  if (aRange !== bRange) return aRange - bRange;
  return (b.marketProbability ?? 0) - (a.marketProbability ?? 0) || a.playerName.localeCompare(b.playerName);
}

export function sportBoards(
  props: EvaluatedProp[],
  countPerSport: number,
  rank: RankMode = "probability"
): Record<string, EvaluatedProp[]> {
  const boards: Record<string, EvaluatedProp[]> = {};
  for (const sport of BOARD_SPORTS) {
    const pool = props.filter((prop) => prop.sport === sport && actionable(prop));
    const qualified = [...pool].sort(
      rank === "confidence"
        ? confidenceOrder
        : (a, b) => (b.marketProbability ?? 0) - (a.marketProbability ?? 0) || a.playerName.localeCompare(b.playerName)
    );
    const picked: EvaluatedProp[] = [];
    const players = new Set<string>();
    for (const prop of qualified) {
      if (players.has(prop.matchKey)) continue;
      players.add(prop.matchKey);
      picked.push(prop);
      if (picked.length >= countPerSport) break;
    }
    if (picked.length) boards[sport] = picked;
  }
  return boards;
}

/** Line gaps only. These rows are not hit probabilities. */
export function discrepancyBoards(props: EvaluatedProp[], countPerSport: number): Record<string, EvaluatedProp[]> {
  const boards: Record<string, EvaluatedProp[]> = {};
  for (const sport of BOARD_SPORTS) {
    const ranked = props
      .filter(
        (prop) =>
          prop.sport === sport &&
          prop.rejectionReasons.includes("exact_line_not_priced") &&
          prop.bookPoint != null &&
          lineIsStale(prop.line, prop.bookPoint)
      )
      .sort((a, b) => Math.abs(b.line - (b.bookPoint ?? b.line)) - Math.abs(a.line - (a.bookPoint ?? a.line)));
    const picked: EvaluatedProp[] = [];
    const players = new Set<string>();
    for (const prop of ranked) {
      if (players.has(prop.matchKey)) continue;
      players.add(prop.matchKey);
      picked.push(prop);
      if (picked.length >= countPerSport) break;
    }
    if (picked.length) boards[sport] = picked;
  }
  return boards;
}

export function rejectionSummary(props: EvaluatedProp[]): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const prop of props) {
    for (const reason of prop.rejectionReasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

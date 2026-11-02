export type OddsLeg = {
  sport: string;
  player: string;
  stat: string;
  line: number;
  side: "over" | "under";
  edge: number;
  fairPct: number;
  ppPct: number;
  books: number;
  oddsType: string;
  projectionId: string;
  bookLine: string;
  /** price: same number, different chance. line: PrizePicks number has moved at the books. */
  gapKind?: "price" | "line";
  bookPoint?: number;
};

export const DEFAULT_MIN_EDGE = 12;
export const DEFAULT_MAX_LEGS = 6;

/** A same-number lean under 12 points is normal. A moved line has to be obvious. */
export function lineIsStale(ppLine: number, bookLine: number): boolean {
  const gap = Math.abs(ppLine - bookLine);
  if (gap < 0.5) return false;
  const larger = Math.max(ppLine, bookLine, 0.5);
  if (gap > 8 && gap / larger > 0.5) return false;
  return gap >= 1.5 || gap / Math.max(ppLine, 0.5) >= 0.4;
}

function disagreementScore(leg: OddsLeg): number {
  if (leg.gapKind === "line" && leg.bookPoint != null) {
    return (Math.abs(leg.line - leg.bookPoint) / Math.max(leg.line, 0.5)) * 100;
  }
  return leg.edge;
}

export function gapSentence(leg: OddsLeg): string {
  if (leg.gapKind === "line" && leg.bookPoint != null) {
    const gap = Math.round(Math.abs(leg.line - leg.bookPoint) * 10) / 10;
    return `Books ${leg.bookPoint} vs PrizePicks ${leg.line} · number off by ${gap} · ${leg.books} books`;
  }
  return `Books ${leg.fairPct}% vs PrizePicks ${leg.ppPct}% · edge +${leg.edge} · ${leg.books} books`;
}

/**
 * The largest book-versus-PrizePicks gaps, any sport.
 * Same-number gaps must clear the price floor. Moved lines must be stale.
 * The floor does not drop to fill the card.
 */
export function selectBiggestGaps(
  legs: OddsLeg[],
  max = DEFAULT_MAX_LEGS,
  minEdge = DEFAULT_MIN_EDGE
): OddsLeg[] {
  const qualified = legs
    .filter((leg) => {
      if (leg.books < 2) return false;
      if (leg.gapKind === "line") return leg.bookPoint != null && lineIsStale(leg.line, leg.bookPoint);
      return leg.edge >= minEdge;
    })
    .sort((a, b) => disagreementScore(b) - disagreementScore(a) || a.player.localeCompare(b.player));
  const picked: OddsLeg[] = [];
  const seen = new Set<string>();
  for (const leg of qualified) {
    const key = `${leg.sport}|${leg.player.toLowerCase()}|${leg.stat.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(leg);
    if (picked.length >= max) break;
  }
  return picked;
}

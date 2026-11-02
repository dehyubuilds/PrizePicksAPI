import { americanToImplied, devigTwoWay } from "@/lib/edge-combos/estimators/devig";
import { edgePercent, prizepicksImpliedProbability } from "@/lib/edge-finder/implied-probability";

export type BookQuote = {
  book: string;
  overPrice: number;
  underPrice: number;
  /** Odds API market last_update, when the response included one. */
  lastUpdate?: string;
};

export type FairLine = {
  fairOver: number;
  fairUnder: number;
  books: number;
};

/** Median no-vig probability across books that priced both sides. */
export function fairFromBooks(quotes: BookQuote[], minBooks = 2): FairLine | null {
  const overs: number[] = [];
  for (const quote of quotes) {
    const over = americanToImplied(quote.overPrice);
    const under = americanToImplied(quote.underPrice);
    if (over == null || under == null) continue;
    const fair = devigTwoWay(over, under);
    if (!fair) continue;
    overs.push(fair.a);
  }
  if (overs.length < minBooks) return null;
  overs.sort((a, b) => a - b);
  const mid = overs[Math.floor((overs.length - 1) / 2)]!;
  return {
    fairOver: mid,
    fairUnder: Number((1 - mid).toFixed(6)),
    books: overs.length,
  };
}

export type PricedSide = {
  side: "over" | "under";
  fairPct: number;
  ppPct: number;
  edge: number;
};

export type PointQuote = BookQuote & { point: number };

/** The number at least two books post as their main line for this prop. */
export function agreedBookLine(quotes: PointQuote[]): { point: number; books: number } | null {
  const byBook = new Map<string, PointQuote[]>();
  for (const quote of quotes) {
    const rows = byBook.get(quote.book) ?? [];
    rows.push(quote);
    byBook.set(quote.book, rows);
  }
  const mains: number[] = [];
  for (const rows of byBook.values()) {
    let best: { point: number; distance: number } | null = null;
    for (const row of rows) {
      const over = americanToImplied(row.overPrice);
      const under = americanToImplied(row.underPrice);
      if (over == null || under == null) continue;
      const fair = devigTwoWay(over, under);
      if (!fair) continue;
      const distance = Math.abs(fair.a - 0.5);
      if (!best || distance < best.distance) best = { point: row.point, distance };
    }
    if (best) mains.push(best.point);
  }
  const counts = new Map<number, number>();
  for (const point of mains) counts.set(point, (counts.get(point) ?? 0) + 1);
  let chosen: number | null = null;
  let books = 0;
  for (const [point, count] of counts) {
    if (count > books) {
      chosen = point;
      books = count;
    }
  }
  if (chosen == null || books < 2) return null;
  return { point: chosen, books };
}

export function priceSides(params: {
  fair: FairLine;
  oddsType: string;
}): PricedSide[] {
  const sides: Array<"over" | "under"> = ["over", "under"];
  return sides.map((side) => {
    const fairPct = Math.round((side === "over" ? params.fair.fairOver : params.fair.fairUnder) * 1000) / 10;
    const ppPct = prizepicksImpliedProbability({ oddsType: params.oddsType, side });
    return {
      side,
      fairPct,
      ppPct,
      edge: edgePercent({ adjustedProb: fairPct, prizepicksImpliedProb: ppPct }),
    };
  });
}

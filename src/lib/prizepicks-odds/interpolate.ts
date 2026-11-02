import type { PointQuote } from "./consensus";
import { fairOverSamples, isHalfPointLine } from "./probability";

/** A four-point gap is not a probability. Brackets wider than this are refused. */
export const MAX_INTERPOLATION_SPAN = 2;

/** Curves that are not already close to monotone are refused instead of being smoothed into a price. */
const MAX_MONOTONE_ADJUSTMENT = 0.05;

export type CurvePoint = {
  point: number;
  overProbability: number;
  books: number;
  rangePoints: number;
};

export type InterpolatedOver = {
  overProbability: number;
  books: number;
  lower: number;
  upper: number;
  /** Half-width, in percentage points. This is not a calibrated confidence interval. */
  uncertaintyPoints: number;
};

/**
 * Piecewise linear interpolation of the median no-vig over probability.
 * Requires a quoted line strictly below and strictly above the target.
 * Does not extrapolate.
 */
export function interpolateOver(quotes: PointQuote[], target: number): InterpolatedOver | null {
  if (!isHalfPointLine(target)) return null;
  const curve = monotoneCurve(quotes);
  if (!curve) return null;
  const lower = [...curve].reverse().find((row) => row.point < target);
  const upper = curve.find((row) => row.point > target);
  if (!lower || !upper) return null;
  if (upper.point - lower.point > MAX_INTERPOLATION_SPAN) return null;
  const span = upper.point - lower.point;
  const weight = (target - lower.point) / span;
  const over = lower.overProbability + weight * (upper.overProbability - lower.overProbability);
  if (over <= 0.01 || over >= 0.99) return null;
  const uncertainty = Math.max(lower.rangePoints, upper.rangePoints);
  return {
    overProbability: over,
    books: Math.min(lower.books, upper.books),
    lower: lower.point,
    upper: upper.point,
    uncertaintyPoints: Math.round(uncertainty * 10) / 10,
  };
}

function monotoneCurve(quotes: PointQuote[]): CurvePoint[] | null {
  const byPoint = new Map<number, PointQuote[]>();
  for (const quote of quotes) {
    if (!isHalfPointLine(quote.point)) continue;
    const list = byPoint.get(quote.point) ?? [];
    list.push(quote);
    byPoint.set(quote.point, list);
  }
  const points: CurvePoint[] = [];
  for (const [point, rows] of byPoint) {
    const overs = fairOverSamples(rows);
    if (overs.length < 2) continue;
    const sorted = [...overs].sort((a, b) => a - b);
    const mid = sorted[Math.floor((sorted.length - 1) / 2)]!;
    points.push({
      point,
      overProbability: mid,
      books: overs.length,
      rangePoints: (Math.max(...overs) - Math.min(...overs)) * 100,
    });
  }
  points.sort((a, b) => a.point - b.point);
  if (points.length < 2) return null;
  const adjusted = isotonicNonIncreasing(points.map((row) => row.overProbability));
  const shift = Math.max(...points.map((row, index) => Math.abs(row.overProbability - adjusted[index]!)));
  if (shift > MAX_MONOTONE_ADJUSTMENT) return null;
  return points.map((row, index) => ({ ...row, overProbability: adjusted[index]! }));
}

function isotonicNonIncreasing(values: number[]): number[] {
  return pavaIncreasing(values.map((value) => -value)).map((value) => -value);
}

/** Pool-adjacent-violators for a non-decreasing sequence. */
function pavaIncreasing(values: number[]): number[] {
  const blocks: Array<{ sum: number; count: number }> = [];
  for (const value of values) {
    blocks.push({ sum: value, count: 1 });
    while (blocks.length >= 2) {
      const right = blocks[blocks.length - 1]!;
      const left = blocks[blocks.length - 2]!;
      if (left.sum / left.count <= right.sum / right.count) break;
      blocks.splice(blocks.length - 2, 2, { sum: left.sum + right.sum, count: left.count + right.count });
    }
  }
  const out: number[] = [];
  for (const block of blocks) {
    const mean = block.sum / block.count;
    for (let i = 0; i < block.count; i += 1) out.push(mean);
  }
  return out;
}

/** Convert American odds to vigged implied probability. */
export function americanToImplied(american: number): number | null {
  if (!Number.isFinite(american) || american === 0) return null;
  if (american > 0) return Number((100 / (american + 100)).toFixed(6));
  return Number((-american / (-american + 100)).toFixed(6));
}

/** Remove two-way vig. Does not treat a single vigged price as p. */
export function devigTwoWay(impliedA: number, impliedB: number): { a: number; b: number } | null {
  if (!(impliedA > 0) || !(impliedB > 0)) return null;
  const sum = impliedA + impliedB;
  if (!(sum > 0)) return null;
  return { a: Number((impliedA / sum).toFixed(6)), b: Number((impliedB / sum).toFixed(6)) };
}

export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x >= 0 ? 1 - p : p;
}

/** P(value > threshold) under Normal(mean, sigma). */
export function probAboveThreshold(mean: number, sigma: number, threshold: number): number | null {
  if (!(sigma > 0) || !Number.isFinite(mean) || !Number.isFinite(threshold)) return null;
  const z = (threshold - mean) / sigma;
  return Number(Math.min(0.97, Math.max(0.03, 1 - normalCdf(z))).toFixed(6));
}

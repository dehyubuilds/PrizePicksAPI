import type { EdgeScanPick } from "./types";

export const BINARY_SCORER_PATTERN =
  /\b(to score|goalscorer|first goal|anytime scorer|score a goal|scores? a goal|score in)\b/i;

const COMBO_STAT_PATTERN =
  /[+/&]|(?:\bpts?\s*\+\s*(?:asts?|rebs?))|(?:\bpoints?\s*\+\s*(?:asts?|rebs?))|(?:\brebs?\s*\+\s*asts?\b)|(?:\bpra\b)/i;

export function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s.+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isComboStatProjection(projection: {
  statDisplayName: string;
  statType: string;
}): boolean {
  const hay = `${projection.statDisplayName} ${projection.statType}`;
  return COMBO_STAT_PATTERN.test(hay);
}

export function comboStatAllowedInMarket(
  projection: { statDisplayName: string; statType: string },
  marketText: string
): boolean {
  const hay = normalizeMatchText(marketText);
  const statHay = normalizeMatchText(`${projection.statDisplayName} ${projection.statType}`);
  if (/\bpra\b/.test(statHay) && /\bpra\b/.test(hay)) return true;
  if (/\+/.test(statHay) && /\+/.test(hay)) return true;
  if (/\bpoints?\b/.test(statHay) && /\bassists?\b/.test(statHay)) {
    return /\bpoints?\b/.test(hay) && /\bassists?\b/.test(hay);
  }
  if (/\bpoints?\b/.test(statHay) && /\brebs?\b/.test(hay)) {
    return /\bpoints?\b/.test(hay) && /\brebs?\b/.test(hay);
  }
  return false;
}

export function parseThresholdCandidates(text: string): number[] {
  const values = new Set<number>();
  const patterns = [
    /(\d+(?:\.\d+)?)\s*\+/g,
    /\bover\s+(\d+(?:\.\d+)?)/gi,
    /\bunder\s+(\d+(?:\.\d+)?)/gi,
    /\bat\s+least\s+(\d+(?:\.\d+)?)/gi,
    /\b(\d+(?:\.\d+)?)\s+(?:points?|rebounds?|assists?|yards?|shots?|passes?|hits?|strikeouts?|goals?)\b/gi,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(text);
    while (match) {
      const n = Number.parseFloat(match[1] ?? "");
      if (Number.isFinite(n)) values.add(n);
      match = pattern.exec(text);
    }
  }

  return Array.from(values);
}

export function closestThresholdDelta(
  lineScore: number,
  marketText: string
): { delta: number; threshold: number } | null {
  const thresholds = parseThresholdCandidates(marketText);
  if (!thresholds.length) return null;
  const closest = thresholds.reduce(
    (best, value) => {
      const delta = Math.abs(value - lineScore);
      return delta < best.delta ? { value, delta } : best;
    },
    { value: thresholds[0]!, delta: Number.POSITIVE_INFINITY }
  );
  return { delta: closest.delta, threshold: closest.value };
}

export function passesHardLineGate(lineScore: number, marketText: string): boolean {
  const closest = closestThresholdDelta(lineScore, marketText);
  if (!closest) return false;
  return closest.delta <= 0.5;
}

export function passesBinaryScorerGate(
  projection: { lineScore: number; statDisplayName: string; statType: string },
  marketText: string
): boolean {
  const hay = normalizeMatchText(marketText);
  const statHay = normalizeMatchText(`${projection.statDisplayName} ${projection.statType}`);
  if (!/\bgoals?\b/.test(statHay)) return true;
  if (projection.lineScore > 1.5) return true;
  return !BINARY_SCORER_PATTERN.test(hay);
}

export function inferSideForPick(params: {
  side: "over" | "under";
  lineScore: number;
  marketText: string;
}): "yes" | "no" | null {
  const lower = normalizeMatchText(params.marketText);
  const closest = closestThresholdDelta(params.lineScore, params.marketText);
  const asksOver = /\bover\b|\bat least\b|\d+(?:\.\d+)?\s*\+/.test(lower);
  const asksUnder = /\bunder\b|\bfewer than\b|\bless than\b/.test(lower);

  if (params.side === "over") {
    if (asksUnder) return "no";
    if (asksOver) return "yes";
    if (closest && closest.delta <= 0.5) return "yes";
    return null;
  }

  if (asksOver) return "no";
  if (asksUnder) return "yes";
  if (closest && closest.delta <= 0.5) return "yes";
  return null;
}

export function thresholdMatchScore(lineScore: number, marketText: string): number {
  const closest = closestThresholdDelta(lineScore, marketText);
  if (!closest) return 0;
  if (closest.delta <= 0.5) return 100;
  if (closest.delta <= 1.0) return 60;
  return 10;
}

export function bestVenueMatchScore(pick: EdgeScanPick): number {
  return Math.max(pick.kalshi?.matchScore ?? 0, pick.polymarket?.matchScore ?? 0);
}

export function isSuspiciousEdgePick(pick: EdgeScanPick): boolean {
  const edge = pick.edgePercent ?? 0;
  const matchScore = bestVenueMatchScore(pick);
  if (edge > 20) return true;
  if (edge > 15 && matchScore < 70) return true;
  const statHay = normalizeMatchText(`${pick.statDisplayName} ${pick.statType}`);
  if (/\bgoals?\b/.test(statHay) && edge > 15) return true;
  return false;
}

export function confidenceFromMatchQuality(params: {
  matchScore: number;
  volumeBoost: number;
}): number {
  return Math.round(Math.min(100, params.matchScore * 0.55 + params.volumeBoost + 12));
}

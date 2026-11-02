import { playerKey } from "./identity";
import { MODEL_VERSION, type MapAppearance, type Projection, type ValorantProp } from "./types";

const MIN_SAMPLES = 5;
const PRIOR_STRENGTH = 8;
const MIN_DISTRIBUTION_SAMPLES = 30;

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function variance(values: number[]): number | null {
  const mid = mean(values);
  if (mid == null || values.length < 2) return null;
  return values.reduce((sum, value) => sum + (value - mid) ** 2, 0) / (values.length - 1);
}

/** Variance / mean. Above 1 is overdispersed relative to Poisson. Small samples are not a fit test. */
export function dispersionRatio(counts: number[]): { ratio: number | null; poissonRejected: boolean; reason: string } {
  if (counts.length < MIN_DISTRIBUTION_SAMPLES) {
    return { ratio: null, poissonRejected: true, reason: "Fewer than 30 counts. No distribution was fitted." };
  }
  const mid = mean(counts);
  const spread = variance(counts);
  if (mid == null || spread == null || mid <= 0) {
    return { ratio: null, poissonRejected: true, reason: "The count sample has no positive mean." };
  }
  const ratio = spread / mid;
  if (ratio > 1.5) {
    return { ratio, poissonRejected: true, reason: "The sample is overdispersed relative to Poisson, so that distribution was not used." };
  }
  return { ratio, poissonRejected: true, reason: "Poisson was not accepted. Held-out calibration is still required before any probability is published." };
}

export function shrink(observed: number, sampleSize: number, prior: number): number {
  return (sampleSize * observed + PRIOR_STRENGTH * prior) / (sampleSize + PRIOR_STRENGTH);
}

export type SeriesSamples = {
  map1Rounds: number[];
  map2Rounds: number[];
  killsPerRound: number[];
};

export function samplesForPlayer(rows: MapAppearance[], playerKeyValue: string, nowIso: string): SeriesSamples {
  const map1Rounds: number[] = [];
  const map2Rounds: number[] = [];
  const killsPerRound: number[] = [];
  const cutoff = Date.parse(nowIso);
  for (const row of rows) {
    const key = playerKey(row.playerName);
    if (key !== playerKeyValue) continue;
    const played = Date.parse(row.matchDate);
    if (Number.isFinite(cutoff) && Number.isFinite(played) && played > cutoff) continue;
    if (!(row.rounds > 0) || !(row.kills >= 0)) continue;
    killsPerRound.push(row.kills / row.rounds);
    if (row.seriesPosition === 1) map1Rounds.push(row.rounds);
    if (row.seriesPosition === 2) map2Rounds.push(row.rounds);
  }
  return { map1Rounds, map2Rounds, killsPerRound };
}

export function projectMaps12(prop: ValorantProp, rows: MapAppearance[], nowIso: string, identity: Projection["identity"]): Projection {
  const base = {
    projectionId: prop.projectionId,
    player: prop.player,
    team: prop.team,
    opponent: prop.opponent,
    eventId: prop.eventId,
    startTime: prop.startTime,
    line: prop.line,
    propClass: prop.propClass,
    modelVersion: MODEL_VERSION,
    adjustedExpected: null as number | null,
    probabilityMore: null,
    probabilityLess: null,
    probabilityPush: null,
    calibration: "uncalibrated" as const,
    distribution: "not_fitted" as const,
    identity,
    marketComparison: "INDEPENDENT_MODEL_ONLY" as const,
  };
  if (!prop.eligible) {
    return {
      ...base,
      status: "INSUFFICIENT_HISTORICAL_DATA",
      baselineExpected: null,
      interval: null,
      sampleSize: 0,
      reason: "Promotional lines are kept separate and are not modeled as standard Maps 1–2 kills.",
      verdict: "INVALID_MARKET_SCOPE",
    };
  }
  if (identity !== "high") {
    return {
      ...base,
      status: "INSUFFICIENT_HISTORICAL_DATA",
      baselineExpected: null,
      interval: null,
      sampleSize: 0,
      reason: "The PrizePicks name did not match one statistics identity at high confidence.",
      verdict: "INSUFFICIENT_DATA",
    };
  }
  const samples = samplesForPlayer(rows, prop.playerKey, prop.startTime || nowIso);
  const roundsReady = samples.map1Rounds.length >= MIN_SAMPLES && samples.map2Rounds.length >= MIN_SAMPLES;
  const rateReady = samples.killsPerRound.length >= MIN_SAMPLES;
  if (!roundsReady || !rateReady) {
    return {
      ...base,
      status: "INSUFFICIENT_HISTORICAL_DATA",
      baselineExpected: null,
      interval: null,
      sampleSize: samples.killsPerRound.length,
      reason: roundsReady
        ? "Kills per round need at least five map rows dated before the match."
        : "Map 1 and map 2 need their own pre-match round samples. A career average was not substituted.",
      verdict: "INSUFFICIENT_DATA",
    };
  }
  const rateMean = mean(samples.killsPerRound)!;
  const round1 = mean(samples.map1Rounds)!;
  const round2 = mean(samples.map2Rounds)!;
  const rate = shrink(rateMean, samples.killsPerRound.length, rateMean);
  const expected = rate * shrink(round1, samples.map1Rounds.length, round1) + rate * shrink(round2, samples.map2Rounds.length, round2);
  const rateVariance = variance(samples.killsPerRound) ?? 0;
  const spread = Math.sqrt(rateVariance) * (round1 + round2);
  const half = Number.isFinite(spread) ? 1.96 * spread / Math.sqrt(samples.killsPerRound.length) : expected;
  return {
    ...base,
    status: "projected",
    baselineExpected: round(expected),
    adjustedExpected: round(expected),
    interval: { low: round(expected - half), high: round(expected + half), kind: "sampling_interval_not_calibrated" },
    sampleSize: samples.killsPerRound.length,
    reason: "Baseline is expected rounds on map 1 plus map 2, times shrunk kills per round. No probability was fitted.",
    verdict: Math.abs(expected - prop.line) >= 1 ? "POSSIBLE_DISCREPANCY" : "NO_MEASURABLE_DISCREPANCY",
  };
}

export function applyInformation(projection: Projection, effects: string[]): Projection {
  if (effects.includes("ROLE_CHANGE_RISK")) {
    return {
      ...projection,
      adjustedExpected: projection.baselineExpected,
      verdict: "ROLE_CHANGE_RISK",
      reason: `${projection.reason} A verified roster or role signal was stored. No kill bonus was added.`,
    };
  }
  if (effects.includes("MODEL_UNCERTAINTY_INCREASED")) {
    return {
      ...projection,
      adjustedExpected: projection.baselineExpected,
      reason: `${projection.reason} Unverified or stale information increased uncertainty. The baseline was left unchanged.`,
    };
  }
  return projection;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

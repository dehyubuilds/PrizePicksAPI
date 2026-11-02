import { createHash, randomUUID } from "node:crypto";

export const SPORTS_DAILY_EVIDENCE_SCHEMA_VERSION = 1 as const;

export type EvidenceProvider =
  | "prizepicks"
  | "the_odds_api"
  | "kalshi"
  | "x_context"
  | "historical_performance";

export type EvidenceSourceObject = {
  provider: EvidenceProvider;
  observedAt: string;
  sourceId?: string;
  sourceUrl?: string;
  objectKey?: string;
  sha256?: string;
  freshnessSeconds?: number;
};

export type ContextClaim = {
  id: string;
  category:
    | "injury"
    | "availability"
    | "starting_lineup"
    | "minutes_restriction"
    | "rotation"
    | "matchup"
    | "other";
  text: string;
  publishedAt: string;
  observedAt: string;
  sourceObjectIndex: number;
  authorId?: string;
  postId?: string;
  playerId?: string;
  teamId?: string;
  reliability: "primary" | "established_reporter" | "secondary" | "unknown";
  verificationStatus: "verified" | "partially_verified" | "unverified" | "contradicted";
};

export type SportsbookEvidence = {
  marketKey: string;
  line: number;
  overProbability?: number;
  underProbability?: number;
  bookmakerCount: number;
  lastUpdateAt: string;
  disagreement?: number;
};

export type KalshiEvidence = {
  ticker: string;
  eventTicker?: string;
  title: string;
  yesBid?: number;
  yesAsk?: number;
  lastPrice?: number;
  volume?: number;
  openInterest?: number;
  observedAt: string;
  relationship: "direct" | "contextual";
};

export type HistoricalEvidence = {
  games: number;
  mean?: number;
  standardDeviation?: number;
  minutesMean?: number;
  hitRateAtLine?: number;
  throughDate: string;
};

export type PlayerImageEvidence = {
  sourceUrl: string;
  publisher: string;
  observedAt: string;
  usageStatus: "approved" | "review_required" | "unavailable";
  attribution?: string;
};

export type SportsDailyCandidate = {
  candidateId: string;
  player: {
    canonicalId: string;
    displayName: string;
    teamId?: string;
    externalIds: Record<string, string>;
  };
  event: {
    canonicalId: string;
    startAt: string;
    opponentTeamId?: string;
    externalIds: Record<string, string>;
  };
  stat: {
    canonicalKey: string;
    displayName: string;
  };
  postedLine: {
    value: number;
    projectionId: string;
    observedAt: string;
    onAirLabel: "the posted line" | "today's projection" | "the number";
  };
  sportsbook?: SportsbookEvidence;
  kalshi?: KalshiEvidence[];
  historical?: HistoricalEvidence;
  contextualClaimIds: string[];
  playerImage?: PlayerImageEvidence;
  limitations: string[];
};

export type SportsDailyEvidenceBundle = {
  schemaVersion: typeof SPORTS_DAILY_EVIDENCE_SCHEMA_VERSION;
  bundleId: string;
  createdAt: string;
  observedAt: string;
  predictionCutoffAt: string;
  league: string;
  slateDate: string;
  sourceObjects: EvidenceSourceObject[];
  claims: ContextClaim[];
  candidates: SportsDailyCandidate[];
  limitations: string[];
};

export type EvidenceValidationResult =
  | { ok: true; bundle: SportsDailyEvidenceBundle }
  | { ok: false; errors: string[] };

const BUNDLE_KEYS = new Set([
  "schemaVersion",
  "bundleId",
  "createdAt",
  "observedAt",
  "predictionCutoffAt",
  "league",
  "slateDate",
  "sourceObjects",
  "claims",
  "candidates",
  "limitations",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseIso(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function validateProbability(value: unknown, path: string, errors: string[]): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    errors.push(`${path} must be a probability from 0 to 1`);
  }
}

export function validateSportsDailyEvidenceBundle(input: unknown): EvidenceValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["bundle must be an object"] };

  for (const key of Object.keys(input)) {
    if (!BUNDLE_KEYS.has(key)) errors.push(`bundle contains unknown field: ${key}`);
  }
  if (input.schemaVersion !== SPORTS_DAILY_EVIDENCE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SPORTS_DAILY_EVIDENCE_SCHEMA_VERSION}`);
  }
  for (const key of ["bundleId", "league", "slateDate"] as const) {
    if (typeof input[key] !== "string" || !input[key].trim()) errors.push(`${key} is required`);
  }

  const observedAt = parseIso(input.observedAt);
  const cutoffAt = parseIso(input.predictionCutoffAt);
  const createdAt = parseIso(input.createdAt);
  if (!Number.isFinite(observedAt)) errors.push("observedAt must be ISO-8601");
  if (!Number.isFinite(cutoffAt)) errors.push("predictionCutoffAt must be ISO-8601");
  if (!Number.isFinite(createdAt)) errors.push("createdAt must be ISO-8601");
  if (Number.isFinite(observedAt) && Number.isFinite(cutoffAt) && observedAt > cutoffAt) {
    errors.push("observedAt cannot be after predictionCutoffAt");
  }

  if (!Array.isArray(input.sourceObjects) || input.sourceObjects.length === 0) {
    errors.push("sourceObjects must contain at least one source");
  } else {
    input.sourceObjects.forEach((source, index) => {
      if (!isRecord(source)) {
        errors.push(`sourceObjects[${index}] must be an object`);
        return;
      }
      const sourceObserved = parseIso(source.observedAt);
      if (!Number.isFinite(sourceObserved)) errors.push(`sourceObjects[${index}].observedAt must be ISO-8601`);
      if (Number.isFinite(sourceObserved) && Number.isFinite(cutoffAt) && sourceObserved > cutoffAt) {
        errors.push(`sourceObjects[${index}] was observed after predictionCutoffAt`);
      }
      if (source.sha256 !== undefined && !/^[a-f0-9]{64}$/i.test(String(source.sha256))) {
        errors.push(`sourceObjects[${index}].sha256 must be a 64-character hex digest`);
      }
    });
  }

  const claims = Array.isArray(input.claims) ? input.claims : [];
  if (!Array.isArray(input.claims)) errors.push("claims must be an array");
  claims.forEach((claim, index) => {
    if (!isRecord(claim)) {
      errors.push(`claims[${index}] must be an object`);
      return;
    }
    for (const timestamp of ["publishedAt", "observedAt"] as const) {
      const parsed = parseIso(claim[timestamp]);
      if (!Number.isFinite(parsed)) errors.push(`claims[${index}].${timestamp} must be ISO-8601`);
      if (Number.isFinite(parsed) && Number.isFinite(cutoffAt) && parsed > cutoffAt) {
        errors.push(`claims[${index}].${timestamp} is after predictionCutoffAt`);
      }
    }
    const sourceIndex = claim.sourceObjectIndex;
    if (
      !Number.isInteger(sourceIndex) ||
      Number(sourceIndex) < 0 ||
      Number(sourceIndex) >= (Array.isArray(input.sourceObjects) ? input.sourceObjects.length : 0)
    ) {
      errors.push(`claims[${index}].sourceObjectIndex is invalid`);
    }
  });

  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    errors.push("candidates must contain at least one candidate");
  } else {
    const candidateIds = new Set<string>();
    input.candidates.forEach((candidate, index) => {
      if (!isRecord(candidate)) {
        errors.push(`candidates[${index}] must be an object`);
        return;
      }
      const id = String(candidate.candidateId ?? "");
      if (!id) errors.push(`candidates[${index}].candidateId is required`);
      if (candidateIds.has(id)) errors.push(`duplicate candidateId: ${id}`);
      candidateIds.add(id);
      if (!isRecord(candidate.player) || !String(candidate.player.canonicalId ?? "")) {
        errors.push(`candidates[${index}].player.canonicalId is required`);
      }
      if (!isRecord(candidate.event) || !String(candidate.event.canonicalId ?? "")) {
        errors.push(`candidates[${index}].event.canonicalId is required`);
      }
      const startAt = isRecord(candidate.event) ? parseIso(candidate.event.startAt) : Number.NaN;
      if (!Number.isFinite(startAt)) errors.push(`candidates[${index}].event.startAt must be ISO-8601`);
      if (!isRecord(candidate.postedLine) || !Number.isFinite(candidate.postedLine.value)) {
        errors.push(`candidates[${index}].postedLine.value must be finite`);
      } else {
        const lineObserved = parseIso(candidate.postedLine.observedAt);
        if (!Number.isFinite(lineObserved)) {
          errors.push(`candidates[${index}].postedLine.observedAt must be ISO-8601`);
        } else if (Number.isFinite(cutoffAt) && lineObserved > cutoffAt) {
          errors.push(`candidates[${index}].postedLine was observed after predictionCutoffAt`);
        }
        if (!["the posted line", "today's projection", "the number"].includes(String(candidate.postedLine.onAirLabel))) {
          errors.push(`candidates[${index}].postedLine.onAirLabel is not approved`);
        }
      }
      if (isRecord(candidate.sportsbook)) {
        validateProbability(candidate.sportsbook.overProbability, `candidates[${index}].sportsbook.overProbability`, errors);
        validateProbability(candidate.sportsbook.underProbability, `candidates[${index}].sportsbook.underProbability`, errors);
        const updated = parseIso(candidate.sportsbook.lastUpdateAt);
        if (Number.isFinite(updated) && Number.isFinite(cutoffAt) && updated > cutoffAt) {
          errors.push(`candidates[${index}].sportsbook was updated after predictionCutoffAt`);
        }
      }
      const claimIds = Array.isArray(candidate.contextualClaimIds) ? candidate.contextualClaimIds : [];
      for (const claimId of claimIds) {
        if (!claims.some((claim) => isRecord(claim) && claim.id === claimId)) {
          errors.push(`candidates[${index}] references unknown claim ${String(claimId)}`);
        }
      }
    });
  }

  if (!Array.isArray(input.limitations)) errors.push("limitations must be an array");
  return errors.length
    ? { ok: false, errors }
    : { ok: true, bundle: input as SportsDailyEvidenceBundle };
}

export function canonicalEvidenceJson(bundle: SportsDailyEvidenceBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export function evidenceSha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newEvidenceBundleId(now = new Date()): string {
  return `sdeb_${now.toISOString().slice(0, 10).replace(/-/g, "")}_${randomUUID()}`;
}

export function evidenceBundleKey(bundle: Pick<SportsDailyEvidenceBundle, "bundleId" | "observedAt">): string {
  const date = new Date(bundle.observedAt);
  if (!Number.isFinite(date.getTime())) throw new Error("observedAt must be a valid ISO timestamp");
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `aotq/sports-daily/evidence-bundles/${yyyy}/${mm}/${dd}/${bundle.bundleId}.json`;
}

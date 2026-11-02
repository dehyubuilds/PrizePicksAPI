export type Evidence = {
  sourceUrl: string;
  publisher: string;
  publishedAt: string | null;
  claim: string;
  verificationStatus: "verified" | "partially_verified" | "unverified" | "contradicted";
};

export type AvailabilityStatus = "confirmed" | "probable" | "questionable" | "out" | "unknown";

const LEAGUE_HOST = /(^|\.)((nba|wnba|nfl|mlb|nhl|ncaa)\.com)$/i;
const REPORTING_HOST = /(^|\.)((espn|cbssports|reuters|apnews)\.com|nytimes\.com|theathletic\.com)$/i;
const SOCIAL_HOST = /(^|\.)((x|twitter|t)\.com)$/i;

export function hostTier(url: string): 1 | 3 | 4 | 5 | null {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  if (SOCIAL_HOST.test(host)) return 5;
  if (LEAGUE_HOST.test(host)) return 1;
  if (REPORTING_HOST.test(host)) return 3;
  return 4;
}

export function validateEvidence(params: {
  evidence: Evidence;
  playerName: string;
  eventStart: string;
  pageText?: string | null;
}): Evidence {
  const tier = hostTier(params.evidence.sourceUrl);
  if (tier == null || tier === 5) {
    return { ...params.evidence, verificationStatus: "unverified" };
  }
  const published = params.evidence.publishedAt ? Date.parse(params.evidence.publishedAt) : NaN;
  const start = Date.parse(params.eventStart);
  if (!Number.isFinite(published) || (Number.isFinite(start) && published > start)) {
    return { ...params.evidence, verificationStatus: "unverified" };
  }
  if (params.pageText == null) {
    return { ...params.evidence, verificationStatus: "partially_verified" };
  }
  const last = params.playerName.trim().split(/\s+/).at(-1)?.toLowerCase() ?? "";
  const page = params.pageText.toLowerCase();
  const claim = params.evidence.claim.toLowerCase();
  const snippet = claim.slice(0, 24).trim();
  if (!last || snippet.length < 8 || !page.includes(last) || !page.includes(snippet)) {
    return { ...params.evidence, verificationStatus: "unverified" };
  }
  if (tier === 1) return { ...params.evidence, verificationStatus: "verified" };
  return { ...params.evidence, verificationStatus: "partially_verified" };
}

export function researchDecision(params: {
  availability: AvailabilityStatus;
  evidence: Evidence[];
  restrictionsReported: boolean | null;
  eventStart: string;
}): { rejectUnavailable: boolean; flags: string[] } {
  const flags: string[] = [];
  const verified = params.evidence.filter((row) => row.verificationStatus === "verified");
  const outClaims = verified.filter((row) => /\bout\b|ruled out|will not play|inactive/i.test(row.claim));
  const playingClaims = verified.filter((row) => /\b(probable|available|will play|starting)\b/i.test(row.claim));
  if (params.availability === "out" && outClaims.length && playingClaims.length) {
    flags.push("conflicting_reports");
    return { rejectUnavailable: false, flags };
  }
  if (params.availability === "out" && outClaims.length) {
    return { rejectUnavailable: true, flags: ["player_unavailable"] };
  }
  if (params.availability === "out" || params.availability === "questionable") {
    flags.push("unverified_availability");
  }
  if (params.restrictionsReported === true) {
    const supported = verified.some((row) => /minute|restriction|workload/i.test(row.claim));
    flags.push(supported ? "minutes_restriction" : "unverified_minutes");
  }
  const rumor = params.evidence.some(
    (row) => row.verificationStatus === "unverified" && /injur|questionable|doubtful/i.test(row.claim)
  );
  if (rumor) flags.push("unverified_injury");
  return { rejectUnavailable: false, flags };
}

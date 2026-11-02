import fs from "fs";
import path from "path";
import { callGrokResponses, grokConfigured, isGrokTimeoutError } from "@/lib/xai/client";
import type { EvaluatedProp } from "./evaluate";
import { lineIsStale } from "./select";
import {
  researchDecision,
  validateEvidence,
  type AvailabilityStatus,
  type Evidence,
} from "./evidence";

export const GROK_CACHE_DIR = path.resolve(process.cwd(), "tmp/prizepicks-odds/grok-cache");
export const DEFAULT_GROK_CANDIDATES = 10;
export const DEFAULT_RESEARCH_TTL_MS = 6 * 60 * 60 * 1000;

export type GrokPropResearch = {
  propId: string;
  availability: { status: AvailabilityStatus; evidence: Evidence[] };
  injuryImpact: { summary: string; relevant: boolean; evidence: Evidence[] };
  playingTime: { summary: string; restrictionsReported: boolean | null; evidence: Evidence[] };
  matchup: { summary: string; relevantFactors: string[]; evidence: Evidence[] };
  marketExplanation: { summary: string; possibleCauses: string[]; evidence: Evidence[] };
  risks: string[];
  confidence: "high" | "medium" | "low" | "unknown";
  researchedAt: string;
};

export type ResearchTarget = {
  prop: EvaluatedProp;
  category: "supported" | "discrepancy" | "conflict";
};

export type ResearchFinding =
  | { status: "completed"; research: GrokPropResearch; fromCache: boolean }
  | { status: "failed"; reason: string };

const AVAILABILITY = new Set(["confirmed", "probable", "questionable", "out", "unknown"]);
const CONFIDENCE = new Set(["high", "medium", "low", "unknown"]);

const INSTRUCTIONS = `You research public context for one PrizePicks prop. You do not set a betting probability and you do not invent odds, statistics, or payout rules.

Return strict JSON with this shape:
{
  "propId": string,
  "availability": { "status": "confirmed"|"probable"|"questionable"|"out"|"unknown", "evidence": Evidence[] },
  "injuryImpact": { "summary": string, "relevant": boolean, "evidence": Evidence[] },
  "playingTime": { "summary": string, "restrictionsReported": boolean|null, "evidence": Evidence[] },
  "matchup": { "summary": string, "relevantFactors": string[], "evidence": Evidence[] },
  "marketExplanation": { "summary": string, "possibleCauses": string[], "evidence": Evidence[] },
  "risks": string[],
  "confidence": "high"|"medium"|"low"|"unknown"
}

Evidence is { "sourceUrl": string, "publisher": string, "publishedAt": string|null, "claim": string, "verificationStatus": "unverified" }.
Use web and X search. Prefer official league or team reports. If you cannot verify a claim, say so and leave status "unknown". Do not guess a hit probability.`;

export function selectResearchTargets(
  props: EvaluatedProp[],
  countPerSport: number,
  maxCandidates = DEFAULT_GROK_CANDIDATES
): ResearchTarget[] {
  const supported: ResearchTarget[] = [];
  const discrepancy: ResearchTarget[] = [];
  const conflict: ResearchTarget[] = [];
  const bySport = new Map<string, EvaluatedProp[]>();
  for (const prop of props) {
    if (prop.marketProbability == null || prop.rejectionReasons.length) continue;
    const list = bySport.get(prop.sport) ?? [];
    list.push(prop);
    bySport.set(prop.sport, list);
  }
  for (const list of bySport.values()) {
    const ranked = [...list].sort((a, b) => (b.marketProbability ?? 0) - (a.marketProbability ?? 0));
    const players = new Set<string>();
    for (const prop of ranked) {
      if (players.has(prop.matchKey)) continue;
      players.add(prop.matchKey);
      supported.push({ prop, category: "supported" });
      if (players.size >= countPerSport) break;
    }
  }
  for (const prop of props) {
    if (!prop.rejectionReasons.includes("exact_line_not_priced") || prop.bookPoint == null) continue;
    if (!lineIsStale(prop.line, prop.bookPoint)) continue;
    discrepancy.push({ prop, category: "discrepancy" });
  }
  for (const prop of props) {
    if (prop.rejectionReasons.includes("books_disagree")) conflict.push({ prop, category: "conflict" });
  }
  const picked: ResearchTarget[] = [];
  const seen = new Set<string>();
  const take = (list: ResearchTarget[], slots: number) => {
    let left = slots;
    for (const item of list) {
      if (picked.length >= maxCandidates || left <= 0) return;
      if (seen.has(item.prop.id)) continue;
      seen.add(item.prop.id);
      picked.push(item);
      left -= 1;
    }
  };
  take(supported, Math.max(1, Math.ceil(maxCandidates / 2)));
  take(discrepancy, maxCandidates);
  take(conflict, maxCandidates);
  take(supported, maxCandidates);
  return picked;
}

export function dailyResearchPlan(params: {
  mode: string;
  research?: "none" | "grok" | "auto";
  maxGrokSpend?: number;
}): { run: boolean; note: string; maxSpend?: number } {
  const wants = params.research === "grok" || ((params.mode === "daily" || params.mode === "recheck") && params.research !== "none");
  if (!wants) return { run: false, note: "Research was not requested." };
  if (!grokConfigured()) return { run: false, note: "Research skipped. XAI_API_KEY is not set." };
  if (usdPerResearch() == null) {
    return { run: false, note: "Research skipped. Set XAI_USD_PER_RESEARCH before Grok can run." };
  }
  const fromEnv = Number(process.env.DAILY_MAX_GROK_SPEND);
  const cap = params.maxGrokSpend ?? (Number.isFinite(fromEnv) ? fromEnv : undefined);
  if (params.research !== "grok" && !(cap != null && cap > 0)) {
    return { run: false, note: "Research skipped. Set --max-grok-spend or DAILY_MAX_GROK_SPEND to a positive cap." };
  }
  if (cap != null && cap <= 0) return { run: false, note: "Research skipped. The Grok spend cap is zero." };
  return { run: true, note: "Research ran on the shortlist.", maxSpend: cap };
}

export function usdPerResearch(): number | null {
  const raw = process.env.XAI_USD_PER_RESEARCH?.trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function grokSpendBlocked(maxSpend: number | undefined): string | null {
  if (maxSpend == null) return null;
  if (usdPerResearch() == null) {
    return "max-grok-spend is set but XAI_USD_PER_RESEARCH is not, so research is skipped rather than billed without a cap.";
  }
  return null;
}

type GrokCaller = typeof callGrokResponses;

export async function researchShortlist(
  targets: ResearchTarget[],
  options: {
    maxSpend?: number;
    ttlMs?: number;
    usdPerCall?: number | null;
    cacheDir?: string;
    nowMs?: number;
    call?: GrokCaller;
    fetchPage?: (url: string) => Promise<string | null>;
  } = {}
): Promise<{ findings: Record<string, ResearchFinding>; calls: number; cacheHits: number; estimatedUsd: number | null }> {
  const findings: Record<string, ResearchFinding> = {};
  let calls = 0;
  let cacheHits = 0;
  const unit = options.usdPerCall === undefined ? usdPerResearch() : options.usdPerCall;
  const ttl = options.ttlMs ?? DEFAULT_RESEARCH_TTL_MS;
  const now = options.nowMs ?? Date.now();
  const cacheDir = options.cacheDir ?? GROK_CACHE_DIR;
  const caller = options.call ?? callGrokResponses;
  if (!targets.length) return { findings, calls, cacheHits, estimatedUsd: unit == null ? null : 0 };
  if (!options.call && !grokConfigured()) {
    for (const target of targets) findings[target.prop.id] = { status: "failed", reason: "grok_not_configured" };
    return { findings, calls, cacheHits, estimatedUsd: null };
  }
  for (const target of targets) {
    const cached = readCache(cacheDir, target.prop.id, now, ttl);
    if (cached) {
      cacheHits += 1;
      findings[target.prop.id] = { status: "completed", research: cached, fromCache: true };
      continue;
    }
    const nextSpend = unit == null ? null : (calls + 1) * unit;
    if (options.maxSpend != null && nextSpend != null && nextSpend > options.maxSpend) {
      findings[target.prop.id] = { status: "failed", reason: "grok_budget" };
      continue;
    }
    try {
      const research = await requestOne(target, caller, () => {
        calls += 1;
      });
      const checked = await verifyResearch(research, target.prop, options.fetchPage);
      writeCache(cacheDir, checked);
      findings[target.prop.id] = { status: "completed", research: checked, fromCache: false };
    } catch (err) {
      const reason = isGrokTimeoutError(err) ? "grok_timeout" : err instanceof Error ? err.message : String(err);
      if (/429|rate/i.test(reason)) {
        findings[target.prop.id] = { status: "failed", reason: "grok_rate_limit" };
        for (const rest of targets) {
          if (!findings[rest.prop.id]) findings[rest.prop.id] = { status: "failed", reason: "grok_rate_limit" };
        }
        break;
      }
      findings[target.prop.id] = { status: "failed", reason };
    }
  }
  return { findings, calls, cacheHits, estimatedUsd: unit == null ? null : Math.round(calls * unit * 1000) / 1000 };
}

export function applyFinding(prop: EvaluatedProp, finding: ResearchFinding | undefined): EvaluatedProp {
  if (!finding) return { ...prop, researchFlags: prop.researchFlags ?? [] };
  if (finding.status === "failed") {
    return {
      ...prop,
      researchStatus: "failed",
      researchFlags: [...(prop.researchFlags ?? []), "research_unavailable"],
      researchSummary: finding.reason,
    };
  }
  const decision = researchDecision({
    availability: finding.research.availability.status,
    evidence: allEvidence(finding.research),
    restrictionsReported: finding.research.playingTime.restrictionsReported,
    eventStart: prop.startTime,
  });
  const flags = [...decision.flags];
  if (
    finding.research.marketExplanation.evidence.some(
      (row) => row.verificationStatus === "verified" && /lineup/i.test(row.claim)
    )
  ) {
    flags.push("lineup_change");
  }
  if (decision.rejectUnavailable) {
    return {
      ...prop,
      marketProbability: null,
      dataQuality: "insufficient",
      rejectionReasons: [...prop.rejectionReasons, "player_unavailable"],
      researchStatus: "completed",
      researchFlags: flags,
      researchSummary: finding.research.injuryImpact.summary || finding.research.availability.status,
      explanation: "A verified pre-game report says this player is out. The prop is off the board. The market probability was not rewritten.",
    };
  }
  return {
    ...prop,
    researchStatus: "completed",
    researchFlags: flags,
    researchSummary: finding.research.marketExplanation.summary || finding.research.injuryImpact.summary || finding.research.availability.status,
  };
}

function allEvidence(research: GrokPropResearch): Evidence[] {
  return [
    ...research.availability.evidence,
    ...research.injuryImpact.evidence,
    ...research.playingTime.evidence,
    ...research.matchup.evidence,
    ...research.marketExplanation.evidence,
  ];
}

async function verifyResearch(
  research: GrokPropResearch,
  prop: EvaluatedProp,
  fetchPage?: (url: string) => Promise<string | null>
): Promise<GrokPropResearch> {
  const verify = async (rows: Evidence[]): Promise<Evidence[]> => {
    const out: Evidence[] = [];
    for (const row of rows.slice(0, 3)) {
      const pageText = fetchPage ? await fetchPage(row.sourceUrl).catch(() => null) : null;
      out.push(validateEvidence({ evidence: row, playerName: prop.playerName, eventStart: prop.startTime, pageText }));
    }
    return out;
  };
  return {
    ...research,
    availability: { ...research.availability, evidence: await verify(research.availability.evidence) },
    injuryImpact: { ...research.injuryImpact, evidence: await verify(research.injuryImpact.evidence) },
    playingTime: { ...research.playingTime, evidence: await verify(research.playingTime.evidence) },
    matchup: { ...research.matchup, evidence: await verify(research.matchup.evidence) },
    marketExplanation: { ...research.marketExplanation, evidence: await verify(research.marketExplanation.evidence) },
  };
}

async function requestOne(target: ResearchTarget, caller: GrokCaller, onCall: () => void): Promise<GrokPropResearch> {
  const prop = target.prop;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      onCall();
      const result = await caller({
        instructions: INSTRUCTIONS,
        timeoutMs: 90_000,
        input: [
          `Category: ${target.category}`,
          `propId: ${prop.id}`,
          `${prop.sport} ${prop.playerName} (${prop.team}) vs ${prop.opponent}`,
          `${prop.side ?? "unpriced"} ${prop.line} ${prop.stat} (${prop.oddsType})`,
          `Starts ${prop.startTime}. Market ${prop.market}.`,
          prop.marketProbability == null
            ? `No hit probability. Book number ${prop.bookPoint ?? "unknown"}. Reasons: ${prop.rejectionReasons.join(", ") || "none"}.`
            : `Market hit probability ${prop.marketProbability}% from ${prop.books} books (${prop.probabilitySource ?? "direct"}).`,
          "Return JSON only. Do not invent a probability.",
        ].join("\n"),
      });
      const parsed = parseResearch(result.parsed, prop.id);
      if (!parsed) throw new Error("grok_schema");
      return parsed;
    } catch (err) {
      lastError = err;
      if (!isGrokTimeoutError(err)) throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("grok_timeout");
}

export function parseResearch(raw: Record<string, unknown>, propId: string): GrokPropResearch | null {
  const availability = raw.availability;
  if (!availability || typeof availability !== "object") return null;
  const status = String((availability as { status?: unknown }).status ?? "");
  if (!AVAILABILITY.has(status)) return null;
  const confidence = String(raw.confidence ?? "unknown");
  return {
    propId,
    availability: { status: status as AvailabilityStatus, evidence: parseEvidence((availability as { evidence?: unknown }).evidence) },
    injuryImpact: parseImpact(raw.injuryImpact),
    playingTime: parsePlayingTime(raw.playingTime),
    matchup: parseMatchup(raw.matchup),
    marketExplanation: parseMarket(raw.marketExplanation),
    risks: Array.isArray(raw.risks) ? raw.risks.map((row) => String(row)).filter(Boolean) : [],
    confidence: CONFIDENCE.has(confidence) ? (confidence as GrokPropResearch["confidence"]) : "unknown",
    researchedAt: new Date().toISOString(),
  };
}

function parseEvidence(raw: unknown): Evidence[] {
  if (!Array.isArray(raw)) return [];
  const rows: Evidence[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const sourceUrl = String(row.sourceUrl ?? "").trim();
    if (!/^https?:\/\//i.test(sourceUrl)) continue;
    rows.push({
      sourceUrl,
      publisher: String(row.publisher ?? "").trim() || "unknown",
      publishedAt: typeof row.publishedAt === "string" && row.publishedAt.trim() ? row.publishedAt : null,
      claim: String(row.claim ?? "").trim(),
      verificationStatus: "unverified",
    });
  }
  return rows;
}

function parseImpact(raw: unknown): GrokPropResearch["injuryImpact"] {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    summary: String(row.summary ?? ""),
    relevant: row.relevant === true,
    evidence: parseEvidence(row.evidence),
  };
}

function parsePlayingTime(raw: unknown): GrokPropResearch["playingTime"] {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    summary: String(row.summary ?? ""),
    restrictionsReported: row.restrictionsReported === true ? true : row.restrictionsReported === false ? false : null,
    evidence: parseEvidence(row.evidence),
  };
}

function parseMatchup(raw: unknown): GrokPropResearch["matchup"] {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    summary: String(row.summary ?? ""),
    relevantFactors: Array.isArray(row.relevantFactors) ? row.relevantFactors.map((item) => String(item)) : [],
    evidence: parseEvidence(row.evidence),
  };
}

function parseMarket(raw: unknown): GrokPropResearch["marketExplanation"] {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    summary: String(row.summary ?? ""),
    possibleCauses: Array.isArray(row.possibleCauses) ? row.possibleCauses.map((item) => String(item)) : [],
    evidence: parseEvidence(row.evidence),
  };
}

function cacheFile(dir: string, propId: string): string {
  return path.join(dir, `${propId.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 180)}.json`);
}

function readCache(dir: string, propId: string, now: number, ttl: number): GrokPropResearch | null {
  const file = cacheFile(dir, propId);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { savedAt?: number; research?: GrokPropResearch };
    if (!parsed.savedAt || now - parsed.savedAt > ttl || !parsed.research) return null;
    return parsed.research;
  } catch {
    return null;
  }
}

function writeCache(dir: string, research: GrokPropResearch): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cacheFile(dir, research.propId), `${JSON.stringify({ savedAt: Date.now(), research })}\n`);
}

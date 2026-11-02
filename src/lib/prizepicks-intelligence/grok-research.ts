import { callGrokResponses, grokConfigured, isGrokTimeoutError } from "@/lib/xai/client";
import { parseSource } from "./validate";
import type { EventCluster, GrokChange, GrokEventPacket, IncompleteResearch, RejectedThesis } from "./types";

const TIMEOUT_MS = 360_000;
const CONCURRENCY = 2;

const SYSTEM_PROMPT = `You are a sports-information researcher, not a betting tout. Find recent public information that could change a player's expected statistical distribution versus a posted PrizePicks projection.

Return strict JSON:
{
  "packets": [
    {
      "eventKey": string,
      "changes": [Change],
      "watch": [Change],
      "rejected": [Change]
    }
  ]
}

Change fields:
eventKey, player, statType, signalType (ROLE_CHANGE|LINEUP|INJURY|USAGE|MATCHUP|ENVIRONMENT|WORKLOAD|TACTICAL),
whatChanged, whyNow, whyItMatters, direction (UP|DOWN|MIXED|UNCLEAR),
causalChain (string[]), developing (bool),
missingConfirmation, expectedNextSource, expectedResolutionTime,
bullCase, bearCase, alreadyPricedArgument, missingEvidence, invalidationCondition,
invalidationAlreadyApplies (bool), rejected (bool), rejectReason,
sources: [{ author, outlet, url, publishedAt, sourceType, credibility }]

Rules:
- Research official team/league accounts, official injury/lineup reports, coach/player quotes, credentialed beat and local reporters, practice/pregame notes, weather.
- X is a pointer, not proof. Author credibility matters.
- Exclude anonymous rumor accounts, fan speculation, picks accounts, unsourced insiders, reposts without provenance.
- Do not invent sources, quotes, lineups, or injuries.
- Do not use hot/cold streaks, season averages vs the line, revenge, birthday, national TV, "due", or sentiment.
- A change must be recent. whyNow is mandatory and must name the recent change.
- causalChain must have at least two steps from the world change to the stat distribution.
- If evidence is a rumor or already obvious, put it in rejected with rejectReason.
- If confirmation is missing, put it in watch, not changes.
- Empty packets are fine. Returning zero changes is preferred to forcing weak claims.
- Use only eventKey values from the input.`;

export type ResearchBatchFn = (clusters: EventCluster[], timeoutMs: number) => Promise<{
  packets: GrokEventPacket[];
  model?: string;
}>;

function formatCluster(cluster: EventCluster): string {
  const players = cluster.markets
    .slice(0, 12)
    .map((market) => `- ${market.player} ${market.projection} ${market.statType}`)
    .join("\n");
  return [
    `eventKey=${cluster.eventKey}`,
    `${cluster.sport} ${cluster.event} starts ${cluster.startTime}`,
    `look for: ${cluster.causalVariables.slice(0, 8).join(", ")}`,
    "board:",
    players,
  ].join("\n");
}

function parseChange(raw: unknown, eventKey: string): GrokChange | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const whatChanged = String(row.whatChanged ?? "").trim();
  const whyNow = String(row.whyNow ?? "").trim();
  if (!whatChanged && !whyNow) return null;
  const sources = Array.isArray(row.sources)
    ? row.sources.map(parseSource).filter((source): source is NonNullable<typeof source> => Boolean(source))
    : [];
  return {
    eventKey: String(row.eventKey ?? eventKey).trim() || eventKey,
    player: String(row.player ?? "").trim() || undefined,
    statType: String(row.statType ?? "").trim() || undefined,
    signalType: String(row.signalType ?? "").trim() || undefined,
    whatChanged: whatChanged || whyNow,
    whyNow,
    whyItMatters: String(row.whyItMatters ?? "").trim() || undefined,
    direction: String(row.direction ?? "").trim() || undefined,
    causalChain: Array.isArray(row.causalChain) ? row.causalChain.map((step) => String(step)) : [],
    developing: row.developing === true,
    missingConfirmation: String(row.missingConfirmation ?? "").trim() || undefined,
    expectedNextSource: String(row.expectedNextSource ?? "").trim() || undefined,
    expectedResolutionTime: String(row.expectedResolutionTime ?? "").trim() || undefined,
    bullCase: String(row.bullCase ?? "").trim() || undefined,
    bearCase: String(row.bearCase ?? "").trim() || undefined,
    alreadyPricedArgument: String(row.alreadyPricedArgument ?? "").trim() || undefined,
    missingEvidence: String(row.missingEvidence ?? "").trim() || undefined,
    invalidationCondition: String(row.invalidationCondition ?? "").trim() || undefined,
    invalidationAlreadyApplies: row.invalidationAlreadyApplies === true,
    rejected: row.rejected === true,
    rejectReason: String(row.rejectReason ?? "").trim() || undefined,
    sources,
  };
}

function parsePacket(raw: unknown, allowed: Set<string>): GrokEventPacket | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const eventKey = String(row.eventKey ?? "").trim();
  if (!eventKey || !allowed.has(eventKey)) return null;
  return {
    eventKey,
    changes: (Array.isArray(row.changes) ? row.changes : []).map((item) => parseChange(item, eventKey)).filter((row): row is GrokChange => Boolean(row)),
    watch: (Array.isArray(row.watch) ? row.watch : []).map((item) => parseChange(item, eventKey)).filter((row): row is GrokChange => Boolean(row)),
    rejected: (Array.isArray(row.rejected) ? row.rejected : []).map((item) => parseChange(item, eventKey)).filter((row): row is GrokChange => Boolean(row)),
  };
}

function incompleteFromError(cluster: EventCluster, err: unknown): IncompleteResearch {
  return {
    event: cluster.event,
    eventKey: cluster.eventKey,
    reason: isGrokTimeoutError(err) ? "GROK_TIMEOUT" : err instanceof Error ? err.message : String(err),
  };
}

export async function researchEventBatch(
  clusters: EventCluster[],
  timeoutMs = TIMEOUT_MS
): Promise<{
  packets: GrokEventPacket[];
  rejected: RejectedThesis[];
  model?: string;
}> {
  if (!clusters.length) return { packets: [], rejected: [] };
  if (!grokConfigured()) {
    throw new Error("GROK_NOT_CONFIGURED");
  }

  const allowed = new Set(clusters.map((cluster) => cluster.eventKey));
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Chicago",
  });
  const result = await callGrokResponses({
    instructions: SYSTEM_PROMPT,
    timeoutMs,
    input: [
      `Today is ${today} (America/Chicago).`,
      "Research only recent public information for this event. Return JSON only.",
      "",
      clusters.map(formatCluster).join("\n\n"),
    ].join("\n"),
  });
  const packetsRaw = Array.isArray(result.parsed.packets) ? result.parsed.packets : [];
  const packets = packetsRaw.map((row) => parsePacket(row, allowed)).filter((row): row is GrokEventPacket => Boolean(row));
  return { packets, rejected: [], model: result.model };
}

export async function researchOneEvent(
  cluster: EventCluster,
  runBatch: ResearchBatchFn
): Promise<{ packets: GrokEventPacket[]; incomplete?: IncompleteResearch; model?: string }> {
  try {
    const first = await runBatch([cluster], TIMEOUT_MS);
    return { packets: first.packets, model: first.model };
  } catch (err) {
    if (!isGrokTimeoutError(err)) {
      return { packets: [], incomplete: incompleteFromError(cluster, err) };
    }
    try {
      const retry = await runBatch([cluster], TIMEOUT_MS);
      return { packets: retry.packets, model: retry.model };
    } catch (retryErr) {
      return { packets: [], incomplete: incompleteFromError(cluster, retryErr) };
    }
  }
}

export async function researchEvents(
  clusters: EventCluster[],
  runBatch: ResearchBatchFn = async (batch, timeoutMs) => {
    const result = await researchEventBatch(batch, timeoutMs);
    return { packets: result.packets, model: result.model };
  }
): Promise<{
  packets: GrokEventPacket[];
  rejected: RejectedThesis[];
  incomplete: IncompleteResearch[];
  model?: string;
}> {
  if (!clusters.length) return { packets: [], rejected: [], incomplete: [] };

  const packets: GrokEventPacket[] = [];
  const incomplete: IncompleteResearch[] = [];
  let model: string | undefined;
  for (let i = 0; i < clusters.length; i += CONCURRENCY) {
    const wave = clusters.slice(i, i + CONCURRENCY);
    const results = await Promise.all(wave.map((cluster) => researchOneEvent(cluster, runBatch)));
    for (const result of results) {
      packets.push(...result.packets);
      if (result.incomplete) incomplete.push(result.incomplete);
      model = result.model ?? model;
    }
  }
  return { packets, rejected: [], incomplete, model };
}

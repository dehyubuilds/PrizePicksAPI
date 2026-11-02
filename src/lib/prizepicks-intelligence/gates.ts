import { classifyMarketAwareness, freshnessMinutes } from "./awareness";
import { thesisSurvivesChallenge } from "./challenge";
import { clusterByKey, flattenPackets, matchMarkets, normalizeSignalType, rejectedFromChange } from "./extract";
import { bestSourceCredibility, parseSource, usableSources } from "./validate";
import type {
  Direction,
  EventCluster,
  GrokEventPacket,
  IntelligenceSignal,
  RejectedThesis,
  Verdict,
  WatchItem,
} from "./types";

const DIRECTIONS = new Set<Direction>(["UP", "DOWN", "MIXED", "UNCLEAR"]);

function asDirection(raw?: string): Direction {
  const value = String(raw ?? "UNCLEAR").trim().toUpperCase();
  return DIRECTIONS.has(value as Direction) ? (value as Direction) : "UNCLEAR";
}

function signalKey(player: string, statType: string, whatChanged: string): string {
  return [player.trim().toLowerCase(), statType.trim().toLowerCase(), whatChanged.trim().toLowerCase()].join("|");
}

export function makeSignalId(key: string, runId: string): string {
  const safe = key.replace(/[^a-z0-9|]+/g, "-").slice(0, 80);
  return `sig_${runId}_${safe}`;
}

export function verdictForAwareness(awareness: IntelligenceSignal["marketAwareness"]): Verdict {
  if (awareness === "NEWLY_EMERGED") return "UNDER_REFLECTED_CHANGE";
  if (awareness === "POSSIBLY_UNDER_REFLECTED") return "POSSIBLY_UNDER_REFLECTED";
  return "LIKELY_ALREADY_REFLECTED";
}

export type GateResult = {
  signals: IntelligenceSignal[];
  contextSignals: IntelligenceSignal[];
  watchlist: WatchItem[];
  rejected: RejectedThesis[];
};

export function processPackets(params: {
  clusters: EventCluster[];
  packets: GrokEventPacket[];
  runId: string;
  seenKeys?: Set<string>;
  nowMs?: number;
}): GateResult {
  const nowMs = params.nowMs ?? Date.now();
  const byEvent = clusterByKey(params.clusters);
  const rejected: RejectedThesis[] = [];
  const watchlist: WatchItem[] = [];
  const primary: IntelligenceSignal[] = [];
  const context: IntelligenceSignal[] = [];
  const used = new Set<string>();

  for (const change of flattenPackets(params.packets)) {
    const cluster = byEvent.get(change.eventKey);
    const markets = cluster ? matchMarkets(cluster, change) : [];
    const market = markets[0];
    const parsedSources = (change.sources ?? []).map(parseSource).filter((row): row is NonNullable<typeof row> => Boolean(row));
    const sources = usableSources(parsedSources);

    if (change.bucket === "rejected" || change.rejected) {
      rejected.push(
        rejectedFromChange(
          { ...change, rejectReason: change.rejectReason || change.whyNow || "Rejected during research." },
          market
        )
      );
      continue;
    }

    if (change.bucket === "watch" || change.developing) {
      watchlist.push({
        player: change.player || market?.player || "unknown",
        sport: market?.sport || cluster?.sport || "Unknown",
        market: market ? `${market.player} ${market.projection} ${market.statType}` : change.statType || cluster?.event || "",
        developingSignal: change.whatChanged || change.whyNow,
        missingConfirmation: change.missingConfirmation || change.missingEvidence || "Confirmation not yet public.",
        expectedNextSource: change.expectedNextSource || "official lineup / injury report",
        expectedResolutionTime: change.expectedResolutionTime || market?.startTime || "",
      });
      continue;
    }

    const whyNow = change.whyNow?.trim() ?? "";
    const chain = (change.causalChain ?? []).map((step) => step.trim()).filter(Boolean);
    if (!whyNow) {
      rejected.push(rejectedFromChange({ ...change, rejectReason: "Missing whyNow." }, market));
      continue;
    }
    if (chain.length < 2) {
      rejected.push(rejectedFromChange({ ...change, rejectReason: "Causal chain too short." }, market));
      continue;
    }
    if (!sources.length) {
      rejected.push(
        rejectedFromChange(
          { ...change, rejectReason: "No usable sources (missing URL/timestamp or low-credibility/anonymous)." },
          market
        )
      );
      continue;
    }

    const challenge = thesisSurvivesChallenge(change);
    if (!challenge.ok) {
      rejected.push(rejectedFromChange({ ...change, rejectReason: challenge.reason }, market));
      continue;
    }

    const evidenceConfidence = bestSourceCredibility(sources);
    if (evidenceConfidence === "LOW") {
      rejected.push(rejectedFromChange({ ...change, rejectReason: "LOW evidence confidence excluded from primary report." }, market));
      continue;
    }

    const key = signalKey(market?.player || change.player || "", market?.statType || change.statType || "", change.whatChanged);
    const awareness = classifyMarketAwareness({
      sources,
      market,
      seenBefore: params.seenKeys?.has(key),
      nowMs,
    });
    if (awareness === "SPECULATIVE") {
      rejected.push(rejectedFromChange({ ...change, rejectReason: "SPECULATIVE — insufficient evidence." }, market));
      continue;
    }

    if (!market) {
      rejected.push(rejectedFromChange({ ...change, rejectReason: "Could not map change to a PrizePicks market." }, market));
      continue;
    }

    const signal: IntelligenceSignal = {
      signalId: makeSignalId(key, params.runId),
      marketId: market.id,
      sport: market.sport,
      event: market.event,
      player: market.player,
      team: market.team,
      opponent: market.opponent,
      statType: market.statType,
      projection: market.projection,
      direction: asDirection(change.direction),
      signalType: normalizeSignalType(change.signalType),
      whyNow,
      causalChain: chain,
      evidenceConfidence,
      marketAwareness: awareness,
      freshnessMinutes: freshnessMinutes(sources, nowMs),
      whatChanged: change.whatChanged,
      whyItMatters: change.whyItMatters?.trim() || change.whatChanged,
      bullCase: change.bullCase!.trim(),
      bearCase: change.bearCase!.trim(),
      alreadyPricedArgument: change.alreadyPricedArgument!.trim(),
      missingEvidence: change.missingEvidence!.trim(),
      invalidationCondition: change.invalidationCondition!.trim(),
      verdict: verdictForAwareness(awareness),
      sources,
      firstSeenAt: new Date(nowMs).toISOString(),
      lastSeenAt: new Date(nowMs).toISOString(),
      isNew: true,
    };

    const dedupe = `${signal.player}|${signal.statType}|${signal.whatChanged}`.toLowerCase();
    if (used.has(dedupe)) continue;
    used.add(dedupe);

    if (awareness === "BROADLY_KNOWN") {
      context.push({ ...signal, verdict: "LIKELY_ALREADY_REFLECTED" });
      continue;
    }
    primary.push(signal);
  }

  return { signals: primary, contextSignals: context, watchlist, rejected };
}

import type { IntelligenceSignal, SignalOutcome } from "./types";

export function signalDedupeKey(signal: Pick<IntelligenceSignal, "player" | "statType" | "whatChanged">): string {
  return [signal.player, signal.statType, signal.whatChanged].map((part) => part.trim().toLowerCase()).join("|");
}

export function reconcileSignals(params: {
  incoming: IntelligenceSignal[];
  previous: IntelligenceSignal[];
  nowIso?: string;
}): {
  active: IntelligenceSignal[];
  resolved: IntelligenceSignal[];
  pendingOutcomes: SignalOutcome[];
} {
  const nowIso = params.nowIso ?? new Date().toISOString();
  const prevByKey = new Map(params.previous.map((signal) => [signalDedupeKey(signal), signal]));
  const incomingKeys = new Set(params.incoming.map(signalDedupeKey));

  const active = params.incoming.map((signal) => {
    const prior = prevByKey.get(signalDedupeKey(signal));
    if (!prior) return { ...signal, isNew: true, firstSeenAt: signal.firstSeenAt || nowIso, lastSeenAt: nowIso };
    const upgraded = prior.evidenceConfidence !== signal.evidenceConfidence;
    return {
      ...signal,
      signalId: prior.signalId,
      firstSeenAt: prior.firstSeenAt,
      lastSeenAt: nowIso,
      isNew: false,
      previousSignalId: prior.signalId,
      signalEvolution: upgraded
        ? `Yesterday: ${prior.evidenceConfidence}. Today: ${signal.evidenceConfidence} (${prior.marketAwareness} → ${signal.marketAwareness}).`
        : `Seen since ${prior.firstSeenAt}.`,
    };
  });

  const resolved = params.previous
    .filter((signal) => !incomingKeys.has(signalDedupeKey(signal)))
    .map((signal) => ({ ...signal, lastSeenAt: nowIso }));

  return {
    active,
    resolved,
    pendingOutcomes: resolved.map((signal) => ({
      signalId: signal.signalId,
      projection: signal.projection,
      actual: null,
      outcome: "PENDING" as const,
    })),
  };
}

export function promoteWatchlist(params: {
  previousWatch: string[];
  confirmedKeys: string[];
}): string[] {
  return params.confirmedKeys.filter((key) => params.previousWatch.includes(key));
}

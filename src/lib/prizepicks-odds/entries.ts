import type { EvaluatedProp } from "./evaluate";

export type EntryDependency = {
  kind: "same_player" | "same_game" | "same_team";
  labels: string[];
};

export type EntryCandidate = {
  legs: EvaluatedProp[];
  dependencies: EntryDependency[];
  jointProbability: null;
  estimatedEv: null;
  evStatus: "unavailable";
  reason: string;
  warnings: string[];
};

/** One prop per player, at most two from a game. Joint EV is withheld. */
export function candidateEntry(props: EvaluatedProp[], count: number): EntryCandidate {
  const ranked = props
    .filter(
      (prop) =>
        prop.rejectionReasons.length === 0 &&
        prop.marketProbability != null &&
        (prop.dataQuality === "market" || prop.dataQuality === "interpolated")
    )
    .sort((a, b) => (b.marketProbability ?? 0) - (a.marketProbability ?? 0));
  const legs: EvaluatedProp[] = [];
  const players = new Set<string>();
  const games = new Map<string, number>();
  for (const prop of ranked) {
    if (players.has(prop.matchKey)) continue;
    const used = games.get(prop.eventId) ?? 0;
    if (used >= 2) continue;
    players.add(prop.matchKey);
    games.set(prop.eventId, used + 1);
    legs.push(prop);
    if (legs.length >= count) break;
  }
  return {
    legs,
    dependencies: dependencies(legs),
    jointProbability: null,
    estimatedEv: null,
    evStatus: "unavailable",
    warnings: [...new Set(legs.flatMap((leg) => leg.researchFlags ?? []))],
    reason:
      "Research candidate only. Joint probability is not estimated, same-game legs are not treated as independent, and no verified payout is applied.",
  };
}

export function dependencies(legs: EvaluatedProp[]): EntryDependency[] {
  const found: EntryDependency[] = [];
  found.push(...group(legs, "same_player", (leg) => leg.matchKey));
  found.push(...group(legs, "same_game", (leg) => leg.eventId));
  found.push(...group(legs, "same_team", (leg) => `${leg.sport}|${leg.team}`));
  return found;
}

function group(
  legs: EvaluatedProp[],
  kind: EntryDependency["kind"],
  keyOf: (leg: EvaluatedProp) => string
): EntryDependency[] {
  const buckets = new Map<string, EvaluatedProp[]>();
  for (const leg of legs) {
    const key = keyOf(leg);
    const list = buckets.get(key) ?? [];
    list.push(leg);
    buckets.set(key, list);
  }
  const rows: EntryDependency[] = [];
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    rows.push({ kind, labels: list.map((leg) => leg.label) });
  }
  return rows;
}

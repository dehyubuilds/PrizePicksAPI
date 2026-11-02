export type IdentityCandidate = {
  id: string;
  name: string;
  team?: string;
};

export function playerKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function teamKey(team: string | undefined): string {
  return (team ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Exact gamer-tag match only. Two people with the same tag stay unresolved unless the team picks one. */
export function matchIdentity(
  prizePicksName: string,
  prizePicksTeam: string,
  candidates: IdentityCandidate[]
): { status: "high"; id: string } | { status: "ambiguous" } | { status: "unmatched" } {
  const key = playerKey(prizePicksName);
  if (!key) return { status: "unmatched" };
  const hits = candidates.filter((candidate) => playerKey(candidate.name) === key);
  if (hits.length === 1) return { status: "high", id: hits[0]!.id };
  if (hits.length > 1) {
    const team = teamKey(prizePicksTeam);
    const sided = hits.filter((candidate) => team && teamKey(candidate.team) === team);
    if (sided.length === 1) return { status: "high", id: sided[0]!.id };
    return { status: "ambiguous" };
  }
  return { status: "unmatched" };
}

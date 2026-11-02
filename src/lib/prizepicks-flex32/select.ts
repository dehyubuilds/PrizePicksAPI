import {
  FLEX32_ALT_CANDIDATES,
  FLEX32_GOBLIN_COUNT,
  FLEX32_LINEUP_SIZE,
  FLEX32_MAX_PER_GAME,
  FLEX32_MAX_PER_PLAYER,
} from "./config";
import type { Flex32Candidate, Flex32Mix, Flex32Pick } from "./types";

function playerKey(c: Flex32Candidate): string {
  return `${c.sport}::${c.projection.playerName.trim().toLowerCase()}`;
}

function gameKey(c: Flex32Candidate): string {
  return String(c.projection.gameId || `${c.projection.startTime}|${c.projection.team}`).trim();
}

type BuildState = {
  picks: Flex32Candidate[];
  players: Set<string>;
  games: Map<string, number>;
  sports: Set<string>;
};

function canAdd(state: BuildState, c: Flex32Candidate): boolean {
  if (state.picks.length >= FLEX32_LINEUP_SIZE) return false;
  if (state.players.has(playerKey(c))) return false;
  const g = gameKey(c);
  if ((state.games.get(g) ?? 0) >= FLEX32_MAX_PER_GAME) return false;
  return true;
}

function add(state: BuildState, c: Flex32Candidate): void {
  state.picks.push(c);
  state.players.add(playerKey(c));
  const g = gameKey(c);
  state.games.set(g, (state.games.get(g) ?? 0) + 1);
  state.sports.add(c.sport);
}

function takeTop(
  pool: Flex32Candidate[],
  state: BuildState,
  count: number,
  preferNewSport: boolean
): number {
  let taken = 0;

  // First pass: one best leg per unused sport (keeps MLB/WNBA/NBA/NFL mixed).
  if (preferNewSport) {
    const bySport = new Map<string, Flex32Candidate[]>();
    for (const c of pool) {
      const arr = bySport.get(c.sport) ?? [];
      arr.push(c);
      bySport.set(c.sport, arr);
    }
    const sportOrder = [...bySport.entries()]
      .map(([sport, arr]) => ({
        sport,
        best: arr.sort((a, b) => b.softnessScore - a.softnessScore)[0]!,
      }))
      .filter((row) => !state.sports.has(row.sport))
      .sort((a, b) => b.best.softnessScore - a.best.softnessScore);

    for (const row of sportOrder) {
      if (taken >= count) break;
      if (!canAdd(state, row.best)) continue;
      add(state, row.best);
      taken += 1;
    }
  }

  const ordered = preferNewSport
    ? [...pool].sort((a, b) => {
        const aNew = state.sports.has(a.sport) ? 0 : 1;
        const bNew = state.sports.has(b.sport) ? 0 : 1;
        if (aNew !== bNew) return bNew - aNew;
        return b.softnessScore - a.softnessScore;
      })
    : pool;

  for (const c of ordered) {
    if (taken >= count) break;
    if (!canAdd(state, c)) continue;
    add(state, c);
    taken += 1;
  }
  return taken;
}

function toPicks(candidates: Flex32Candidate[]): Flex32Pick[] {
  return candidates.map((c, i) => ({
    ...c,
    slot: i + 1,
    side: "more" as const,
  }));
}

export type Flex32Selection = {
  mix: Flex32Mix;
  picks: Flex32Pick[];
  alternates: Flex32Candidate[];
  warnings: string[];
};

/**
 * Preferred: 3 goblins + 2 standards.
 * Fallback: 3 goblins + 1 standard + 1 mild demon.
 */
export function selectFlex32Lineup(candidates: Flex32Candidate[]): Flex32Selection {
  const warnings: string[] = [];
  const goblins = candidates.filter((c) => c.bucket === "goblin");
  const standards = candidates.filter((c) => c.bucket === "standard");
  const demons = candidates.filter((c) => c.bucket === "demon");

  const tryMix = (mix: Flex32Mix): Flex32Candidate[] | null => {
    const state: BuildState = {
      picks: [],
      players: new Set(),
      games: new Map(),
      sports: new Set(),
    };

    const gNeeded = FLEX32_GOBLIN_COUNT;
    const gTaken = takeTop(goblins, state, gNeeded, true);
    if (gTaken < gNeeded) return null;

    if (mix === "3g2s") {
      const sTaken = takeTop(standards, state, 2, true);
      if (sTaken < 2 || state.picks.length !== FLEX32_LINEUP_SIZE) return null;
      return state.picks;
    }

    const sTaken = takeTop(standards, state, 1, true);
    if (sTaken < 1) return null;
    const dTaken = takeTop(demons, state, 1, true);
    if (dTaken < 1 || state.picks.length !== FLEX32_LINEUP_SIZE) return null;
    return state.picks;
  };

  let mix: Flex32Mix = "3g2s";
  let chosen = tryMix("3g2s");
  if (!chosen) {
    warnings.push("Not enough soft standards for 3 goblin + 2 standard; trying 3 goblin + 1 standard + 1 mild demon.");
    mix = "3g1s1d";
    chosen = tryMix("3g1s1d");
  }

  if (!chosen) {
    warnings.push("Could not fill a full Flex 5 under mix rules. Returning best partial board.");
    const state: BuildState = {
      picks: [],
      players: new Set(),
      games: new Map(),
      sports: new Set(),
    };
    takeTop(goblins, state, 3, true);
    takeTop(standards, state, 2, true);
    if (state.picks.length < FLEX32_LINEUP_SIZE) takeTop(demons, state, 1, true);
    chosen = state.picks;
    mix = chosen.filter((c) => c.bucket === "demon").length ? "3g1s1d" : "3g2s";
  }

  const used = new Set(chosen.map((c) => c.projection.id));
  const alternates = candidates.filter((c) => !used.has(c.projection.id)).slice(0, FLEX32_ALT_CANDIDATES);

  // Sort lineup: goblins first (by softness), then standards, then demon.
  const bucketOrder = { goblin: 0, standard: 1, demon: 2 } as const;
  const ordered = [...chosen].sort((a, b) => {
    const bo = bucketOrder[a.bucket] - bucketOrder[b.bucket];
    if (bo !== 0) return bo;
    return b.softnessScore - a.softnessScore;
  });

  return {
    mix,
    picks: toPicks(ordered),
    alternates,
    warnings,
  };
}

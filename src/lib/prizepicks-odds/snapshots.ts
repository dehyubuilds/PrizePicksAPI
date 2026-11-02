import fs from "fs";
import path from "path";
import type { EvaluatedProp } from "./evaluate";

export const SNAPSHOT_DIR = path.resolve(process.cwd(), "tmp/prizepicks-odds/snapshots");

export type SnapshotLeg = {
  id: string;
  projectionId: string;
  sport: string;
  label: string;
  line: number;
  side: EvaluatedProp["side"];
  marketProbability: number | null;
  modelVersion: string;
  sourceTimestamp: string;
  playerName?: string;
  team?: string;
  opponent?: string;
  stat?: string;
  market?: string;
  startTime?: string;
  probabilitySource?: "direct" | "interpolated" | null;
  books?: number;
  quotedAt?: string | null;
  oddsType?: string;
  eventId?: string;
  evidenceQuality?: "high" | "moderate" | "limited";
  selectionRank?: number;
};

export type OddsSnapshot = {
  generatedAt: string;
  modelVersion: string;
  creditsSpent: number;
  remaining: number | null;
  legs: SnapshotLeg[];
};

export type ScanChange =
  | { kind: "added"; label: string; marketProbability: number | null }
  | { kind: "removed"; label: string; marketProbability: number | null }
  | { kind: "line"; label: string; from: number; to: number }
  | { kind: "probability"; label: string; from: number; to: number };

export function toSnapshot(params: {
  generatedAt: string;
  modelVersion: string;
  creditsSpent: number;
  remaining: number | null;
  props: EvaluatedProp[];
}): OddsSnapshot {
  return {
    generatedAt: params.generatedAt,
    modelVersion: params.modelVersion,
    creditsSpent: params.creditsSpent,
    remaining: params.remaining,
    legs: params.props
      .filter((prop) => prop.dataQuality === "market" || prop.dataQuality === "interpolated")
      .map((prop) => ({
        id: prop.id,
        projectionId: prop.projectionId,
        sport: prop.sport,
        label: prop.label,
        line: prop.line,
        side: prop.side,
        marketProbability: prop.marketProbability,
        modelVersion: prop.modelVersion,
        sourceTimestamp: prop.sourceTimestamp,
        playerName: prop.playerName,
        team: prop.team,
        opponent: prop.opponent,
        stat: prop.stat,
        market: prop.market,
        startTime: prop.startTime,
        probabilitySource: prop.probabilitySource,
        books: prop.books,
        quotedAt: prop.quotedAt,
        oddsType: prop.oddsType,
        eventId: prop.eventId,
        evidenceQuality: prop.evidenceQuality,
        selectionRank: prop.selectionRank,
      })),
  };
}

export function diffSnapshots(previous: OddsSnapshot | null, next: OddsSnapshot): ScanChange[] {
  if (!previous?.generatedAt || !next.generatedAt) return [];
  if (Date.parse(previous.generatedAt) > Date.parse(next.generatedAt)) return [];
  const before = new Map(previous.legs.map((leg) => [leg.id, leg]));
  const after = new Map(next.legs.map((leg) => [leg.id, leg]));
  const changes: ScanChange[] = [];
  for (const leg of next.legs) {
    const prior = before.get(leg.id);
    if (!prior) {
      changes.push({ kind: "added", label: leg.label, marketProbability: leg.marketProbability });
      continue;
    }
    const bothTimed = Boolean(prior.sourceTimestamp && leg.sourceTimestamp);
    if (bothTimed && prior.line !== leg.line) changes.push({ kind: "line", label: leg.label, from: prior.line, to: leg.line });
    if (
      bothTimed &&
      prior.marketProbability != null &&
      leg.marketProbability != null &&
      prior.marketProbability !== leg.marketProbability
    ) {
      changes.push({
        kind: "probability",
        label: leg.label,
        from: prior.marketProbability,
        to: leg.marketProbability,
      });
    }
  }
  for (const leg of previous.legs) {
    if (!after.has(leg.id)) changes.push({ kind: "removed", label: leg.label, marketProbability: leg.marketProbability });
  }
  return changes;
}

export function writeSnapshot(snapshot: OddsSnapshot, dir = SNAPSHOT_DIR): string {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = snapshot.generatedAt.replace(/[:.]/g, "-");
  const file = path.join(dir, `${stamp}.json`);
  fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "latest.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
  return file;
}

export function readLatestSnapshot(dir = SNAPSHOT_DIR): OddsSnapshot | null {
  const file = path.join(dir, "latest.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as OddsSnapshot;
  } catch {
    return null;
  }
}

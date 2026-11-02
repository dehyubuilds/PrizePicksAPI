import fs from "fs";
import path from "path";
import type { EdgeOpportunity, PickChange, PickDelta, PrizePicksEdgeReport } from "./types";

export const PICKS_DIR = path.resolve(process.cwd(), "tmp/prizepicks-picks");
export const LATEST_PICKS_FILE = path.join(PICKS_DIR, "latest.json");
export const LAST_REPORT_FILE = path.join(PICKS_DIR, "last-report.json");

export type PickSnapshotRow = {
  key: string;
  pickLine: string;
  playerName: string;
  stat: string;
  side: string;
  lineScore: number;
  priority: "now" | "watch";
};

export type PickSnapshot = {
  generatedAt: string;
  rows: PickSnapshotRow[];
};

export function pickHistoryKey(row: {
  playerName: string;
  statDisplayName?: string;
  statType?: string;
  side: string;
}): string {
  const stat = (row.statDisplayName || row.statType || "").trim().toLowerCase();
  return `${row.playerName.trim().toLowerCase()}|${stat}|${row.side.trim().toLowerCase()}`;
}

export function snapshotFromOpportunities(
  opportunities: EdgeOpportunity[],
  generatedAt = new Date().toISOString()
): PickSnapshot {
  return {
    generatedAt,
    rows: opportunities
      .filter((row) => row.priority === "now" || row.priority === "watch")
      .map((row) => ({
        key: pickHistoryKey(row.pick),
        pickLine: row.pick.pickLine,
        playerName: row.pick.playerName,
        stat: row.pick.statDisplayName || row.pick.statType,
        side: row.pick.side,
        lineScore: row.pick.lineScore,
        priority: row.priority,
      })),
  };
}

export function readLastPicksSnapshot(file = LATEST_PICKS_FILE): PickSnapshot | null {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const doc = JSON.parse(raw) as PickSnapshot;
    if (!doc?.generatedAt || !Array.isArray(doc.rows)) return null;
    return doc;
  } catch {
    return null;
  }
}

export function writeLastPicksSnapshot(snapshot: PickSnapshot, file = LATEST_PICKS_FILE): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
}

export function writeLastEdgeReport(report: PrizePicksEdgeReport, file = LAST_REPORT_FILE): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
}

export function readLastEdgeReport(file = LAST_REPORT_FILE): PrizePicksEdgeReport | null {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const doc = JSON.parse(raw) as PrizePicksEdgeReport;
    if (!doc?.generatedAt || !Array.isArray(doc.opportunities)) return null;
    return doc;
  } catch {
    return null;
  }
}

export function diffPicksSnapshots(previous: PickSnapshot | null, current: PickSnapshot): PickDelta {
  if (!previous) {
    return {
      firstRun: true,
      promoted: [],
      newTakes: [],
      dropped: [],
      lineMoved: [],
      stillWaiting: current.rows.filter((row) => row.priority === "watch").length,
    };
  }

  const prevByKey = new Map(previous.rows.map((row) => [row.key, row]));
  const currByKey = new Map(current.rows.map((row) => [row.key, row]));
  const promoted: PickChange[] = [];
  const newTakes: PickChange[] = [];
  const dropped: PickChange[] = [];
  const lineMoved: PickChange[] = [];

  for (const row of current.rows) {
    const prior = prevByKey.get(row.key);
    if (row.priority === "now" && !prior) {
      newTakes.push({ kind: "new_take", pickLine: row.pickLine, detail: "New TAKE since last run." });
      continue;
    }
    if (row.priority === "now" && prior?.priority === "watch") {
      promoted.push({
        kind: "promoted",
        pickLine: row.pickLine,
        detail: "Was waiting. Now a TAKE.",
      });
    }
    if (prior && prior.lineScore !== row.lineScore) {
      lineMoved.push({
        kind: "line_moved",
        pickLine: row.pickLine,
        detail: `Line moved ${prior.lineScore} → ${row.lineScore}.`,
      });
    }
  }

  for (const prior of previous.rows) {
    if (!currByKey.has(prior.key)) {
      dropped.push({
        kind: "dropped",
        pickLine: prior.pickLine,
        detail: prior.priority === "now" ? "Last run’s TAKE is gone." : "No longer on the board.",
      });
    }
  }

  return {
    previousAt: previous.generatedAt,
    firstRun: false,
    promoted,
    newTakes,
    dropped,
    lineMoved,
    stillWaiting: current.rows.filter((row) => row.priority === "watch").length,
  };
}

export function formatDeltaLines(delta: PickDelta): string[] {
  if (delta.firstRun) {
    return [
      "SINCE LAST RUN",
      "First board. WATCH means not ready — don’t monitor it. Run this again and this section will say what changed.",
    ];
  }
  const lines = ["SINCE LAST RUN"];
  const items = [...delta.promoted, ...delta.newTakes, ...delta.lineMoved, ...delta.dropped];
  if (!items.length) {
    lines.push(
      delta.stillWaiting
        ? `Nothing new. ${delta.stillWaiting} still waiting. Run again later if you want an update.`
        : "Nothing new. No TAKEs and nothing waiting."
    );
    return lines;
  }
  for (const item of items) {
    lines.push(`• ${item.pickLine} — ${item.detail}`);
  }
  if (delta.stillWaiting) {
    lines.push(`${delta.stillWaiting} still waiting. Run again later if you want an update.`);
  }
  return lines;
}

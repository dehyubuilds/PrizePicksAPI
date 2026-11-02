import fs from "fs";
import path from "path";
import { renderValorantMarkdown } from "./report";
import type { IntelItem, MapAppearance, Projection, SourceRecord, ValorantProp, ValorantReport } from "./types";

export const VALORANT_DIR = path.resolve(process.cwd(), "tmp/prizepicks-valorant");

export function writeValorant(report: ValorantReport, root = VALORANT_DIR): void {
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const snapshot = path.join(root, "snapshots", stamp);
  fs.mkdirSync(snapshot, { recursive: true });
  const files: Record<string, unknown> = {
    "source-registry.json": report.sources,
    "board.json": report.props,
    "intelligence.json": report.intelligence,
    "historical-stats.json": { rows: report.history, blockers: report.historyBlockers },
    "projections.json": report.projections,
    "backtest.json": report.backtest,
    "report.json": report,
  };
  for (const [name, value] of Object.entries(files)) {
    const body = `${JSON.stringify(value, null, 2)}\n`;
    fs.writeFileSync(path.join(root, name), body);
    fs.writeFileSync(path.join(snapshot, name), body);
  }
  const markdown = renderValorantMarkdown(report);
  fs.writeFileSync(path.join(root, "report.md"), markdown);
  fs.writeFileSync(path.join(snapshot, "report.md"), markdown);
}

export function readValorant(root = VALORANT_DIR): {
  props: ValorantProp[];
  sources: SourceRecord[];
  intelligence: IntelItem[];
  history: MapAppearance[];
  projections: Projection[];
} | null {
  const board = path.join(root, "board.json");
  if (!fs.existsSync(board)) return null;
  const historyDoc = JSON.parse(fs.readFileSync(path.join(root, "historical-stats.json"), "utf8")) as { rows?: MapAppearance[] };
  return {
    props: JSON.parse(fs.readFileSync(board, "utf8")) as ValorantProp[],
    sources: JSON.parse(fs.readFileSync(path.join(root, "source-registry.json"), "utf8")) as SourceRecord[],
    intelligence: JSON.parse(fs.readFileSync(path.join(root, "intelligence.json"), "utf8")) as IntelItem[],
    history: historyDoc.rows ?? [],
    projections: JSON.parse(fs.readFileSync(path.join(root, "projections.json"), "utf8")) as Projection[],
  };
}

import fs from "fs";
import path from "path";
import { scoreSettlements, type SettlementRow, type ScoreReport } from "./scoring";

export const SETTLEMENTS_FILE = path.resolve(process.cwd(), "tmp/prizepicks-odds/settlements.json");

export function readSettlements(file = SETTLEMENTS_FILE): SettlementRow[] {
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as SettlementRow[]) : [];
  } catch {
    return [];
  }
}

export function formatBacktest(report?: ScoreReport): string {
  const scored = report ?? scoreSettlements(readSettlements());
  const lines = [
    "BACKTEST",
    scored.note,
    `Graded sample: ${scored.sampleSize}. Pushes and voids excluded: ${scored.excludedPushes}.`,
  ];
  if (scored.brier != null) lines.push(`Brier ${scored.brier}. Log loss ${scored.logLoss}.`);
  lines.push("ROI: unavailable.");
  for (const bucket of scored.buckets) {
    if (!bucket.count) continue;
    lines.push(`  ${bucket.from}–${bucket.to}%: ${bucket.hits}/${bucket.count} hit, average quoted ${bucket.averageProbability}%`);
  }
  return lines.join("\n");
}

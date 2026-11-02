import fs from "fs";
import path from "path";
import type { DailyReport } from "./daily";

export const DAILY_REPORT_ROOT = path.resolve(process.cwd(), "artifacts/prizepicks/daily");

/** Writes a new folder per run so a later scan does not erase the earlier one. */
export function writeDailyArtifacts(report: DailyReport, text: string, root = DAILY_REPORT_ROOT): string {
  const day = report.generatedAt.slice(0, 10);
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  let dir = path.join(root, day, stamp);
  if (fs.existsSync(dir)) dir = `${dir}-${Date.now()}`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "report.txt"), text.endsWith("\n") ? text : `${text}\n`);
  fs.writeFileSync(path.join(dir, "report.json"), `${JSON.stringify({ rankingVersion: report.rankingVersion, generatedAt: report.generatedAt, picks: report.picks }, null, 2)}\n`);
  fs.writeFileSync(
    path.join(dir, "candidates.json"),
    `${JSON.stringify(
      Object.values(report.boards)
        .flat()
        .map((leg) => ({
          id: leg.id,
          player: leg.playerName,
          sport: leg.sport,
          market: leg.market,
          line: leg.line,
          side: leg.side,
          marketProbability: leg.marketProbability,
          probabilitySource: leg.probabilitySource,
        })),
      null,
      2
    )}\n`
  );
  fs.writeFileSync(path.join(dir, "rejected.json"), `${JSON.stringify(report.rejections, null, 2)}\n`);
  fs.writeFileSync(
    path.join(dir, "research.json"),
    `${JSON.stringify({ note: report.researchNote, calls: report.grokCalls, spendUsd: report.grokCostUsd }, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(dir, "metadata.json"),
    `${JSON.stringify(
      {
        generatedAt: report.generatedAt,
        rankingVersion: report.rankingVersion,
        modelVersion: report.modelVersion,
        thresholds: report.thresholds,
        creditsSpent: report.creditsSpent,
        remaining: report.remaining,
        snapshotGeneratedAt: report.snapshot.generatedAt,
        scanTruncated: report.scanTruncated,
      },
      null,
      2
    )}\n`
  );
  return dir;
}

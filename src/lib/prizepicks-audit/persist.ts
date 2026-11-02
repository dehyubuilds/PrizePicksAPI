import fs from "fs";
import path from "path";
import type { AuditReport, InefficiencyObservation } from "./types";
import { renderAuditMarkdown } from "./report";

export const AUDIT_DIR = path.resolve(process.cwd(), "tmp/prizepicks-audit");

export function writeAudit(report: AuditReport, root = AUDIT_DIR, options: { append?: boolean } = {}): string {
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const snapshot = path.join(root, "snapshots", stamp);
  fs.mkdirSync(snapshot, { recursive: true });
  const files: Record<string, unknown> = {
    "category-inventory.json": report.categories,
    "source-registry.json": report.sources,
    "market-coverage.json": report.coverage,
    "inefficiency-observations.json": report.observations,
    "category-scorecard.json": report.scorecards,
    "opportunity-matrix.json": report.matrix,
  };
  for (const [name, value] of Object.entries(files)) {
    fs.writeFileSync(path.join(snapshot, name), `${JSON.stringify(value, null, 2)}\n`);
    fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`);
  }
  const markdown = renderAuditMarkdown(report);
  fs.writeFileSync(path.join(snapshot, "audit-report.md"), markdown);
  fs.writeFileSync(path.join(root, "audit-report.md"), markdown);
  fs.writeFileSync(path.join(snapshot, "report.json"), `${JSON.stringify(report)}\n`);
  fs.writeFileSync(path.join(root, "report.json"), `${JSON.stringify(report)}\n`);
  fs.writeFileSync(path.join(root, "latest.json"), `${JSON.stringify({ generatedAt: report.generatedAt, snapshot })}\n`);
  if (options.append !== false && report.observations.length) appendObservations(report.observations, root);
  return snapshot;
}

export function appendObservations(observations: InefficiencyObservation[], root = AUDIT_DIR): void {
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, "observations.jsonl");
  const lines = observations.map((row) => JSON.stringify(row)).join("\n");
  fs.appendFileSync(file, `${lines}\n`);
}

export function readObservations(root = AUDIT_DIR): InefficiencyObservation[] {
  const file = path.join(root, "observations.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as InefficiencyObservation];
      } catch {
        return [];
      }
    });
}

export function readLatestReport(root = AUDIT_DIR): AuditReport | null {
  const file = path.join(root, "report.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as AuditReport;
  } catch {
    return null;
  }
}

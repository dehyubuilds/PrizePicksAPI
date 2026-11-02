import fs from "fs";
import path from "path";
import type { ActiveStore, IntelligenceSignal, RejectedThesis, RunReport, SignalOutcome } from "./types";

export const INTEL_DIR = path.resolve(process.cwd(), "tmp/prizepicks-intelligence");

export type IntelPaths = {
  root: string;
  reports: string;
  signals: string;
  sources: string;
  outcomes: string;
};

export function intelPaths(root = INTEL_DIR): IntelPaths {
  return {
    root,
    reports: path.join(root, "reports"),
    signals: path.join(root, "signals"),
    sources: path.join(root, "sources"),
    outcomes: path.join(root, "outcomes"),
  };
}

export function ensureIntelDirs(root = INTEL_DIR): IntelPaths {
  const paths = intelPaths(root);
  fs.mkdirSync(paths.reports, { recursive: true });
  fs.mkdirSync(paths.signals, { recursive: true });
  fs.mkdirSync(paths.sources, { recursive: true });
  fs.mkdirSync(paths.outcomes, { recursive: true });
  return paths;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function readActiveSignals(root = INTEL_DIR): IntelligenceSignal[] {
  const store = readJson<ActiveStore>(path.join(intelPaths(root).signals, "active.json"), {
    updatedAt: "",
    signals: [],
  });
  return store.signals ?? [];
}

export function writeActiveSignals(signals: IntelligenceSignal[], root = INTEL_DIR): void {
  const paths = ensureIntelDirs(root);
  writeJson(path.join(paths.signals, "active.json"), {
    updatedAt: new Date().toISOString(),
    signals,
  });
}

export function readResolvedSignals(root = INTEL_DIR): IntelligenceSignal[] {
  return readJson<IntelligenceSignal[]>(path.join(intelPaths(root).signals, "resolved.json"), []);
}

export function writeResolvedSignals(signals: IntelligenceSignal[], root = INTEL_DIR): void {
  writeJson(path.join(ensureIntelDirs(root).signals, "resolved.json"), signals);
}

export function appendRejected(rows: RejectedThesis[], root = INTEL_DIR): void {
  const file = path.join(ensureIntelDirs(root).signals, "rejected.json");
  const existing = readJson<RejectedThesis[]>(file, []);
  writeJson(file, [...existing, ...rows]);
}

export function readCredibility(root = INTEL_DIR): Record<string, "HIGH" | "MEDIUM" | "LOW" | "DENIED"> {
  return readJson(path.join(intelPaths(root).sources, "credibility.json"), {});
}

export function writeCredibility(
  ledger: Record<string, "HIGH" | "MEDIUM" | "LOW" | "DENIED">,
  root = INTEL_DIR
): void {
  writeJson(path.join(ensureIntelDirs(root).sources, "credibility.json"), ledger);
}

export function readOutcomes(root = INTEL_DIR): SignalOutcome[] {
  return readJson(path.join(intelPaths(root).outcomes, "outcomes.json"), []);
}

export function writeOutcomes(rows: SignalOutcome[], root = INTEL_DIR): void {
  writeJson(path.join(ensureIntelDirs(root).outcomes, "outcomes.json"), rows);
}

export function writeRunReport(report: RunReport, markdown: string, root = INTEL_DIR): { jsonPath: string; mdPath: string } {
  const paths = ensureIntelDirs(root);
  const jsonPath = path.join(paths.reports, `${report.runDate}.json`);
  const mdPath = path.join(paths.reports, `${report.runDate}.md`);
  writeJson(jsonPath, report);
  fs.writeFileSync(mdPath, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
  return { jsonPath, mdPath };
}

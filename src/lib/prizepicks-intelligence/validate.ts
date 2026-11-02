import type { Credibility, IntelligenceSource, SourceType } from "./types";

const DENIED_TYPES = new Set<SourceType>(["ANONYMOUS", "FAN", "PICKS_ACCOUNT", "UNVERIFIED"]);

const HIGH_TYPES = new Set<SourceType>([
  "OFFICIAL",
  "LEAGUE_REPORT",
  "INJURY_REPORT",
  "COACH_QUOTE",
  "LINEUP",
  "WEATHER",
]);

const MEDIUM_TYPES = new Set<SourceType>([
  "BEAT_REPORTER",
  "LOCAL_REPORTER",
  "PRACTICE_REPORT",
  "PREGAME_REPORT",
  "PLAYER_QUOTE",
  "ANALYTICS",
]);

export function normalizeSourceType(raw: string): SourceType {
  const value = raw.trim().toUpperCase().replace(/\s+/g, "_");
  const aliases: Record<string, SourceType> = {
    OFFICIAL_TEAM: "OFFICIAL",
    TEAM: "OFFICIAL",
    COACH: "COACH_QUOTE",
    BEAT: "BEAT_REPORTER",
    REPORTER: "BEAT_REPORTER",
    INJURY: "INJURY_REPORT",
    RUMOR: "ANONYMOUS",
    INSIDER: "UNVERIFIED",
    FAN_ACCOUNT: "FAN",
    PICKS: "PICKS_ACCOUNT",
  };
  const mapped = aliases[value] ?? value;
  if (DENIED_TYPES.has(mapped as SourceType) || HIGH_TYPES.has(mapped as SourceType) || MEDIUM_TYPES.has(mapped as SourceType)) {
    return mapped as SourceType;
  }
  return "UNVERIFIED";
}

export function credibilityForSourceType(type: SourceType): Credibility {
  if (HIGH_TYPES.has(type)) return "HIGH";
  if (MEDIUM_TYPES.has(type)) return "MEDIUM";
  return "LOW";
}

export function parseSource(raw: unknown): IntelligenceSource | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const url = String(row.url ?? "").trim();
  const publishedAt = String(row.publishedAt ?? "").trim();
  const sourceType = normalizeSourceType(String(row.sourceType ?? "UNVERIFIED"));
  if (!url || !publishedAt) return null;
  if (!Number.isFinite(new Date(publishedAt).getTime())) return null;
  const credibility = credibilityForSourceType(sourceType);
  return {
    author: String(row.author ?? "").trim() || "unknown",
    outlet: String(row.outlet ?? "").trim() || "unknown",
    url,
    publishedAt,
    sourceType,
    credibility,
  };
}

export function usableSources(sources: IntelligenceSource[]): IntelligenceSource[] {
  return sources.filter((source) => !DENIED_TYPES.has(source.sourceType) && source.credibility !== "LOW");
}

export function bestSourceCredibility(sources: IntelligenceSource[]): Credibility {
  if (sources.some((source) => source.credibility === "HIGH")) return "HIGH";
  if (sources.some((source) => source.credibility === "MEDIUM")) return "MEDIUM";
  return "LOW";
}

export function newestSourceMs(sources: IntelligenceSource[], nowMs = Date.now()): number | null {
  let newest: number | null = null;
  for (const source of sources) {
    const ms = new Date(source.publishedAt).getTime();
    if (!Number.isFinite(ms) || ms > nowMs + 60_000) continue;
    if (newest === null || ms > newest) newest = ms;
  }
  return newest;
}

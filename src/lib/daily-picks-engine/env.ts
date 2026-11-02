export function dailyPicksModelVersion(): string {
  return process.env.DROPFLOW_DAILY_PICKS_MODEL_VERSION?.trim() || "v1";
}

export function dailyPicksMinEdge(): number {
  const raw = Number(process.env.DROPFLOW_DAILY_PICKS_MIN_EDGE ?? "3");
  return Number.isFinite(raw) ? raw : 3;
}

export function dailyPicksMinConfidence(): "medium" | "high" {
  const raw = process.env.DROPFLOW_DAILY_PICKS_MIN_CONFIDENCE?.trim().toLowerCase();
  return raw === "high" ? "high" : "medium";
}

export function sportsStatsGrader(): "nba-cdn" {
  return "nba-cdn";
}

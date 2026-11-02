/** Player and game features this scanner does not have a feed for. */

export const MODEL_VERSION = "market-median-v1";
export const INTERPOLATION_VERSION = "market-interpolate-v1";

const FEATURES: Record<string, readonly string[]> = {
  NBA: [
    "projected minutes",
    "usage and role",
    "recent performance",
    "season baseline",
    "opponent defense",
    "pace",
    "injuries and rotation",
    "blowout sensitivity",
  ],
  WNBA: [
    "projected minutes",
    "usage and role",
    "recent performance",
    "season baseline",
    "opponent defense",
    "pace",
    "injuries and rotation",
    "blowout sensitivity",
  ],
  NFL: [
    "snap and route share",
    "target or carry share",
    "game script",
    "opponent defense",
    "weather",
    "injuries",
    "quarterback and offensive line",
  ],
  NCAAF: [
    "snap and route share",
    "target or carry share",
    "game script",
    "opponent defense",
    "weather",
    "injuries",
    "quarterback and offensive line",
  ],
  MLB: [
    "confirmed lineup",
    "starting pitcher",
    "handedness",
    "strikeout and walk rates",
    "park factor",
    "weather",
    "expected plate appearances",
  ],
  NHL: [
    "expected ice time",
    "line assignment",
    "power-play unit",
    "shots and points rates",
    "opponent shot suppression",
    "goaltender",
    "penalty opportunities",
  ],
  NCAAB: ["minutes", "usage", "tempo", "opponent profile", "rotation", "foul risk"],
};

export function missingFeatures(sport: string): string[] {
  return [...(FEATURES[sport] ?? ["sport features"])];
}

export const BOARD_SPORTS = ["NFL", "NBA", "WNBA", "MLB", "NHL", "NCAAF", "NCAAB"] as const;

export function boardSport(league: string): string | null {
  const name = league.trim().toUpperCase();
  if (name === "CFB") return "NCAAF";
  if (name === "CBB") return "NCAAB";
  if ((BOARD_SPORTS as readonly string[]).includes(name)) return name;
  return null;
}

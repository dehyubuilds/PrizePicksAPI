/** Target PrizePicks leagues for the Flex 3-2 script. */
export const FLEX32_SPORTS = ["MLB", "WNBA", "NBA", "NFL"] as const;

export const FLEX32_LEAGUE_IDS: Record<(typeof FLEX32_SPORTS)[number], string> = {
  MLB: "2",
  WNBA: "3",
  NBA: "7",
  NFL: "9",
};

export const LEAGUE_ID_TO_SPORT: Record<string, string> = {
  "2": "MLB",
  "3": "WNBA",
  "7": "NBA",
  "9": "NFL",
};

/** Counting stats we treat as reliable floor props. */
export const FLEX32_ALLOWED_STATS = [
  "points",
  "rebounds",
  "assists",
  "ks",
  "strikeouts",
  "pitcher strikeouts",
  "receptions",
  "rushing yards",
  "receiving yards",
  "passing yards",
] as const;

export const FLEX32_DEFAULT_HORIZON_HOURS = 48;
export const FLEX32_MAX_PER_PLAYER = 1;
export const FLEX32_MAX_PER_GAME = 3;
export const FLEX32_LINEUP_SIZE = 5;
export const FLEX32_GOBLIN_COUNT = 3;
/** Softest demons only: at most this many points above the standard main. */
export const FLEX32_MAX_DEMON_GAP = 2;
export const FLEX32_ALT_CANDIDATES = 8;

export function normalizeStat(stat: string): string {
  return stat.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isAllowedStat(stat: string): boolean {
  const n = normalizeStat(stat);
  return (FLEX32_ALLOWED_STATS as readonly string[]).includes(n);
}

export function normalizeOddsBucket(oddsType: string | undefined): "goblin" | "standard" | "demon" | null {
  const raw = String(oddsType ?? "standard").trim().toLowerCase();
  if (raw === "goblin") return "goblin";
  if (raw === "demon") return "demon";
  if (!raw || raw === "standard") return "standard";
  return null;
}

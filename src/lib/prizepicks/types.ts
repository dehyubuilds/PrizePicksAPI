export type PrizePicksOddsType = "standard" | "demon" | "goblin" | string;

export type PrizePicksProjection = {
  id: string;
  playerName: string;
  team: string;
  opponent: string;
  leagueId: string;
  leagueName: string;
  statDisplayName: string;
  statType: string;
  lineScore: number;
  oddsType: PrizePicksOddsType;
  startTime: string;
  gameId: string;
  status: string;
  /** When the line first appeared on the board (PP `board_time`). */
  boardTime?: string;
  /** Last time PP updated this projection. */
  updatedAt?: string;
  rank?: number;
  isPromo?: boolean;
};

export type PrizePicksFetchResult = {
  projections: PrizePicksProjection[];
  fetchedAt: string;
  leagueCount: number;
  /** True when live API failed and a recent S3 cache was used instead. */
  fromCache?: boolean;
};

export type PrizePicksPairOutputs = {
  freePick: import("@/lib/playlist-insights/types").PlaylistInsightsOutputs;
  /** Two Discord-only PrizePick props (distinct from the X pick). */
  discordPicks: [
    import("@/lib/playlist-insights/types").PlaylistInsightsPremiumPick,
    import("@/lib/playlist-insights/types").PlaylistInsightsPremiumPick,
  ];
  /** @deprecated Use discordPicks[1] — kept for callers expecting a single Discord prop. */
  discordPick: import("@/lib/playlist-insights/types").PlaylistInsightsPremiumPick;
  prizePicksProjectionIds: [string, string, string];
};

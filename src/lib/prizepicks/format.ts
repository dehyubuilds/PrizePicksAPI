import type { PrizePicksProjection } from "./types";

const MAX_PROJECTIONS_IN_CORPUS = 80;

export function formatPrizePicksCorpus(projections: PrizePicksProjection[]): string {
  const rows = projections.slice(0, MAX_PROJECTIONS_IN_CORPUS);
  const blocks = rows.map((p) => {
    return [
      `ID: ${p.id}`,
      `Player: ${p.playerName} (${p.team})`,
      p.opponent ? `Matchup: ${p.opponent}` : null,
      `League: ${p.leagueName}`,
      `Line: ${p.lineScore} ${p.statDisplayName}`,
      p.oddsType !== "standard" ? `Odds type: ${p.oddsType}` : null,
      p.startTime ? `Start: ${p.startTime}` : null,
      p.gameId ? `Game ID: ${p.gameId}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return `=== PRIZEPICKS PROJECTIONS (${rows.length} live props) ===\n${blocks.join("\n\n")}`;
}

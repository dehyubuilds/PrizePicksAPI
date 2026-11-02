import type { PrizePicksProjection } from "@/lib/prizepicks/types";
import { normalizePlayerName } from "@/lib/prizepicks-odds/markets";
import { newsMarketForStat, type NewsSport } from "./scope";
import { isComboSoccerSide, soccerOddsKeyForLeague } from "./soccer";
import type { IndexedProp, SlateGame } from "./types";

const LEAGUE_TO_SPORT: Record<string, NewsSport> = {
  MLB: "MLB",
  "2": "MLB",
  WNBA: "WNBA",
  "3": "WNBA",
  NFL: "NFL",
  "9": "NFL",
  SOCCER: "SOCCER",
  MLS: "SOCCER",
  EPL: "SOCCER",
  "6": "SOCCER",
  "14": "SOCCER",
  "82": "SOCCER",
  "531": "SOCCER",
};

export function sportOfProjection(projection: PrizePicksProjection): NewsSport | null {
  const name = projection.leagueName.trim().toUpperCase();
  const id = projection.leagueId.trim();
  return LEAGUE_TO_SPORT[name] ?? LEAGUE_TO_SPORT[id] ?? null;
}

export function indexBoard(
  projections: PrizePicksProjection[],
  sports: NewsSport[],
  nowIso: string
): { props: IndexedProp[]; games: SlateGame[]; rejectedMlb: number } {
  const wanted = new Set(sports);
  const now = Date.parse(nowIso);
  const props: IndexedProp[] = [];
  let rejectedMlb = 0;
  for (const projection of projections) {
    if (projection.playerName.includes("+")) continue;
    const sport = sportOfProjection(projection);
    if (!sport || !wanted.has(sport)) continue;
    const start = Date.parse(projection.startTime);
    if (!Number.isFinite(start) || start <= now) continue;
    if (projection.oddsType !== "standard") continue;
    const mapped = newsMarketForStat(sport, projection.statDisplayName, projection.statType);
    if (mapped.rejectedMlb) {
      rejectedMlb += 1;
      continue;
    }
    if (!mapped.market) continue;
    if (sport === "SOCCER" && (isComboSoccerSide(projection.team) || isComboSoccerSide(projection.opponent))) continue;
    props.push({
      projectionId: projection.id,
      sport,
      player: projection.playerName,
      playerKey: normalizePlayerName(projection.playerName),
      team: projection.team,
      opponent: projection.opponent,
      gameId: projection.gameId,
      market: mapped.market,
      oddsSportKey: sport === "SOCCER" ? soccerOddsKeyForLeague(projection.leagueId, projection.leagueName) : undefined,
      stat: projection.statDisplayName || projection.statType,
      line: projection.lineScore,
      oddsType: projection.oddsType,
      startTime: projection.startTime,
    });
  }
  const games = new Map<string, SlateGame>();
  for (const prop of props) {
    const key = `${prop.sport}:${prop.gameId}`;
    const game = games.get(key) ?? {
      sport: prop.sport,
      gameId: prop.gameId,
      team: prop.team,
      opponent: prop.opponent,
      startTime: prop.startTime,
      players: [],
    };
    if (!game.players.includes(prop.player)) game.players.push(prop.player);
    games.set(key, game);
  }
  return { props, games: Array.from(games.values()), rejectedMlb };
}

export function findPlayerProps(props: IndexedProp[], sport: NewsSport, playerName: string): IndexedProp[] {
  const key = normalizePlayerName(playerName);
  if (!key) return [];
  const exact = props.filter((prop) => prop.sport === sport && prop.playerKey === key);
  if (exact.length) return exact;
  const parts = key.split(" ").filter(Boolean);
  if (parts.length !== 1) return [];
  const last = parts[0] ?? "";
  if (last.length < 3) return [];
  const loose = props.filter((prop) => prop.sport === sport && prop.playerKey.split(" ").at(-1) === last);
  const names = new Set(loose.map((prop) => prop.playerKey));
  return names.size === 1 ? loose : [];
}

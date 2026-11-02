import type { PrizePicksProjection } from "@/lib/prizepicks/types";
import type { PropClass, ValorantProp } from "./types";
import { playerKey } from "./identity";

const MAPS_12_KILLS = /\bmaps?\s*1\s*(?:-|–|to)\s*2\b/i;

export function isValorantCategoryName(name: string): boolean {
  const folded = name.trim().toLowerCase();
  return folded === "val" || folded === "valorant";
}

export function cleanSide(value: string): string {
  return value.replace(/\bmaps?\s*1\s*(?:-|–|to)\s*2\b/gi, " ").replace(/\s+/g, " ").trim();
}

export function isMaps12Kills(label: string): boolean {
  return MAPS_12_KILLS.test(label) && /\bkills?\b/i.test(label) && !/\bcombo\b/i.test(label) && !label.includes("+");
}

export function propClass(projection: Pick<PrizePicksProjection, "oddsType" | "isPromo">): PropClass {
  if (projection.isPromo) return "promo";
  const odds = projection.oddsType.trim().toLowerCase();
  if (odds === "standard") return "standard";
  if (odds === "demon") return "demon";
  if (odds === "goblin") return "goblin";
  return "other";
}

export function discoverValorantProps(
  projections: PrizePicksProjection[],
  namesByLeague: Map<string, string>,
  nowIso: string
): ValorantProp[] {
  const now = Date.parse(nowIso);
  const props: ValorantProp[] = [];
  for (const projection of projections) {
    const name = namesByLeague.get(projection.leagueId) || projection.leagueName;
    if (!isValorantCategoryName(name)) continue;
    const label = projection.statDisplayName || projection.statType;
    if (!isMaps12Kills(label)) continue;
    const start = Date.parse(projection.startTime);
    if (!Number.isFinite(start) || start <= now) continue;
    const kind = propClass(projection);
    props.push({
      projectionId: projection.id,
      player: projection.playerName,
      playerKey: playerKey(projection.playerName),
      team: cleanSide(projection.team),
      opponent: cleanSide(projection.opponent),
      eventId: projection.gameId,
      startTime: projection.startTime,
      scope: "maps_1_2",
      statLabel: label,
      line: projection.lineScore,
      propClass: kind,
      eligible: kind === "standard",
    });
  }
  return props.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.player.localeCompare(b.player));
}

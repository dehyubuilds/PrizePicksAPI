import { PRIZEPICKS_LEAGUE_NAMES } from "@/lib/prizepicks/leagues";
import type { PrizePicksLeagueCatalogEntry } from "@/lib/prizepicks/client";
import type { PrizePicksProjection } from "@/lib/prizepicks/types";
import { abbreviationUnexpanded, classifyValueKind, dependencyFlags, familyId, parseScope } from "./taxonomy";
import type { CategoryRecord, NameResolution, PropFamilyRecord } from "./types";

const KNOWN_SPORT: Record<string, string> = {
  NFL: "football",
  NBA: "basketball",
  WNBA: "basketball",
  CBB: "basketball",
  CFB: "football",
  MLB: "baseball",
  NHL: "hockey",
  MLS: "soccer",
};

export function resolveCategoryName(
  leagueId: string,
  catalog: PrizePicksLeagueCatalogEntry | undefined
): { displayName: string; nameResolution: NameResolution; sportOrGame: string | null; sportAssignment: CategoryRecord["sportAssignment"] } {
  const providerName = catalog?.name?.trim() ?? "";
  if (providerName) {
    return {
      displayName: providerName,
      nameResolution: "provider",
      sportOrGame: catalog?.providerSport?.trim() || KNOWN_SPORT[providerName.toUpperCase()] || providerName,
      sportAssignment: catalog?.providerSport?.trim() ? "provider" : KNOWN_SPORT[providerName.toUpperCase()] ? "known_map" : "provider",
    };
  }
  const known = PRIZEPICKS_LEAGUE_NAMES[leagueId];
  if (known) {
    return {
      displayName: known,
      nameResolution: "known_map",
      sportOrGame: KNOWN_SPORT[known] ?? known,
      sportAssignment: KNOWN_SPORT[known] ? "known_map" : "unassigned",
    };
  }
  return {
    displayName: `League ${leagueId}`,
    nameResolution: "unresolved",
    sportOrGame: null,
    sportAssignment: "unassigned",
  };
}

export function buildInventory(
  projections: PrizePicksProjection[],
  catalog: PrizePicksLeagueCatalogEntry[],
  nowIso: string
): CategoryRecord[] {
  const byId = new Map(catalog.map((row) => [row.id, row]));
  const groups = new Map<string, PrizePicksProjection[]>();
  for (const projection of projections) {
    const id = projection.leagueId.trim() || "unknown";
    const list = groups.get(id) ?? [];
    list.push(projection);
    groups.set(id, list);
  }
  for (const row of catalog) {
    if ((row.projectionsCount ?? 0) > 0 && !groups.has(row.id)) groups.set(row.id, []);
  }
  const now = Date.parse(nowIso);
  const categories: CategoryRecord[] = [];
  for (const [categoryId, rows] of Array.from(groups.entries())) {
    const named = resolveCategoryName(categoryId, byId.get(categoryId));
    const events = new Set<string>();
    const upcoming = new Set<string>();
    const players = new Set<string>();
    let standard = 0;
    let promotional = 0;
    let freshest: string | null = null;
    const families = new Map<string, { labels: string[]; types: string[]; lines: number[]; standard: number; promotional: number }>();
    for (const projection of rows) {
      if (projection.gameId) events.add(projection.gameId);
      const start = Date.parse(projection.startTime);
      if (projection.gameId && Number.isFinite(start) && start > now) upcoming.add(projection.gameId);
      if (projection.playerName) players.add(projection.playerName);
      const promo = projection.isPromo === true || (projection.oddsType && projection.oddsType !== "standard");
      if (promo) promotional += 1;
      else standard += 1;
      const stamp = projection.updatedAt || projection.boardTime || null;
      if (stamp && (!freshest || stamp > freshest)) freshest = stamp;
      const parsed = parseScope(projection.statDisplayName || projection.statType || "Stat");
      const key = familyId(parsed.scope, parsed.familyLabel);
      const bag = families.get(key) ?? { labels: [], types: [], lines: [], standard: 0, promotional: 0 };
      bag.labels.push(projection.statDisplayName || parsed.familyLabel);
      bag.types.push(projection.statType || "");
      bag.lines.push(projection.lineScore);
      if (promo) bag.promotional += 1;
      else bag.standard += 1;
      families.set(key, bag);
    }
    const propFamilies: PropFamilyRecord[] = Array.from(families.entries()).map(([id, bag]) => {
      const label = bag.labels[0] ?? id;
      const parsed = parseScope(label);
      const uniqueLines = Array.from(new Set(bag.lines)).sort((a, b) => a - b).slice(0, 8);
      return {
        id,
        providerLabel: label,
        providerStatType: bag.types.find(Boolean) ?? "",
        normalizedFamily: parsed.familyLabel,
        abbreviationUnexpanded: abbreviationUnexpanded(parsed.familyLabel),
        scope: parsed.scope,
        valueKind: classifyValueKind(bag.labels, bag.lines),
        lineCount: bag.lines.length,
        integerLines: bag.lines.filter((line) => Number.isInteger(line)).length,
        halfPointLines: bag.lines.filter((line) => !Number.isInteger(line)).length,
        sampleThresholds: uniqueLines,
        standardCount: bag.standard,
        promotionalCount: bag.promotional,
        ...dependencyFlags(label),
        scoringDefinition: null,
      };
    });
    categories.push({
      categoryId,
      displayName: named.displayName,
      nameResolution: named.nameResolution,
      providerLeagueId: categoryId,
      sportOrGame: named.sportOrGame,
      sportAssignment: named.sportAssignment,
      activeEventCount: events.size,
      upcomingEventCount: upcoming.size,
      activePlayerCount: players.size,
      activePropCount: rows.length,
      standardPropCount: standard,
      promotionalPropCount: promotional,
      propFamilies: propFamilies.sort((a, b) => b.lineCount - a.lineCount || a.providerLabel.localeCompare(b.providerLabel)),
      dataFreshness: freshest,
      scoringDefinitions: null,
    });
  }
  return categories.sort((a, b) => b.activePropCount - a.activePropCount || a.displayName.localeCompare(b.displayName));
}

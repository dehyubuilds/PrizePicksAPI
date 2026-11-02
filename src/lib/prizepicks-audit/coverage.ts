import { PRIZEPICKS_LEAGUE_NAMES } from "@/lib/prizepicks/leagues";
import { alternateMarket, marketForStat, sportKeyForLeague } from "@/lib/prizepicks-odds/markets";
import type { CategoryCoverage, CategoryRecord, CoverageClass, FamilyCoverage } from "./types";

export type OddsSportRow = { key: string; title: string };

export function foldName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Match a provider category to one Odds API sport. Unresolved ids and ambiguous titles stay unmatched. */
export function matchOddsSport(
  displayName: string,
  nameResolution: CategoryRecord["nameResolution"],
  sports: OddsSportRow[],
  leagueId = ""
): string | null {
  if (!sports.length) return null;
  const known = sportKeyForLeague(PRIZEPICKS_LEAGUE_NAMES[leagueId] || (nameResolution === "unresolved" ? "" : displayName));
  if (known && sports.some((sport) => sport.key === known)) return known;
  const name = foldName(displayName);
  if (nameResolution === "unresolved" || name.length < 4) return null;
  const hits = sports.filter((sport) => {
    const title = foldName(sport.title);
    if (title.length < 6) return false;
    return title === name || name.includes(title) || title.includes(name);
  });
  return hits.length === 1 ? hits[0]!.key : null;
}

export function buildCoverage(
  categories: CategoryRecord[],
  sports: OddsSportRow[] | null,
  probedMarkets: Map<string, string[]>
): CategoryCoverage[] {
  return categories.map((category) => {
    const oddsSportKey = sports ? matchOddsSport(category.displayName, category.nameResolution, sports, category.categoryId) : null;
    const families: FamilyCoverage[] = category.propFamilies.map((family) =>
      classifyFamily({
        category,
        familyLabel: family.normalizedFamily,
        providerLabel: family.providerLabel,
        familyId: family.id,
        scopeKind: family.scope.kind,
        scopeLabel: family.scope.label,
        statType: family.providerStatType,
        oddsSportKey,
        sportsCatalogLoaded: sports != null,
        returned: probedMarkets.get(category.categoryId) ?? null,
      })
    );
    return { categoryId: category.categoryId, displayName: category.displayName, oddsSportKey, families };
  });
}

function classifyFamily(args: {
  category: CategoryRecord;
  familyLabel: string;
  providerLabel: string;
  familyId: string;
  scopeKind: string;
  scopeLabel: string;
  statType: string;
  oddsSportKey: string | null;
  sportsCatalogLoaded: boolean;
  returned: string[] | null;
}): FamilyCoverage {
  const base = {
    familyId: args.familyId,
    providerLabel: args.providerLabel,
    scopeLabel: args.scopeLabel,
    oddsSportKey: args.oddsSportKey,
    marketKey: null as string | null,
  };
  if (!args.sportsCatalogLoaded) {
    return { ...base, coverage: "UNKNOWN", reason: "The Odds API sport list was not loaded, so coverage is unknown." };
  }
  if (!args.oddsSportKey) {
    return { ...base, coverage: "NO_COMPARABLE_MARKET", reason: "No Odds API sport key matched this category." };
  }
  const leagueCode = PRIZEPICKS_LEAGUE_NAMES[args.category.categoryId] || args.category.displayName;
  const documented = marketForStat(leagueCode, args.familyLabel, args.familyLabel);
  if (args.scopeKind !== "match") {
    if (documented) {
      return {
        ...base,
        marketKey: documented,
        coverage: "RELATED_MARKET_ONLY",
        reason: `A full-game ${documented} market is not the same settlement scope as ${args.scopeLabel}.`,
      };
    }
    return {
      ...base,
      coverage: "NO_COMPARABLE_MARKET",
      reason: "No same-scope sportsbook market is documented for this prop.",
    };
  }
  if (!documented) {
    return { ...base, coverage: "NO_COMPARABLE_MARKET", reason: "No full-game market key is documented for this prop family." };
  }
  if (args.returned == null) {
    return {
      ...base,
      marketKey: documented,
      coverage: "UNKNOWN",
      reason: `The odds client documents ${documented}, and this run did not request that market.`,
    };
  }
  if (args.returned.includes(documented)) {
    return { ...base, marketKey: documented, coverage: "EXACT_COMPARABLE_MARKET", reason: `${documented} was returned for a full-game scope.` };
  }
  const alt = alternateMarket(leagueCode, documented);
  if (alt && args.returned.includes(alt)) {
    return { ...base, marketKey: alt, coverage: "ADJACENT_ALT_LINES", reason: `${alt} was returned and the primary ${documented} market was not.` };
  }
  return {
    ...base,
    marketKey: documented,
    coverage: "NO_COMPARABLE_MARKET",
    reason: `${documented} was requested and the book response did not include it.`,
  };
}

export function coverageRank(coverage: CoverageClass): number {
  if (coverage === "EXACT_COMPARABLE_MARKET") return 4;
  if (coverage === "ADJACENT_ALT_LINES") return 3;
  if (coverage === "RELATED_MARKET_ONLY") return 2;
  if (coverage === "NO_COMPARABLE_MARKET") return 1;
  return 0;
}

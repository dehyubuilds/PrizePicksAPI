import { sportKeyForLeague } from "@/lib/prizepicks-odds/markets";
import { summarizeObservations } from "./longitudinal";
import type {
  CategoryCoverage,
  CategoryRecord,
  CategoryScorecard,
  DataSourceRecord,
  DimensionScore,
  EffortClass,
  InefficiencyObservation,
  OpportunityRow,
  ScoreValue,
} from "./types";

function dimension(score: ScoreValue, formula: string, observations: string): DimensionScore {
  return { score, formula, observations };
}

function sourcesFor(category: CategoryRecord, sources: DataSourceRecord[]): DataSourceRecord[] {
  return sources.filter((source) => source.categories.includes(category.categoryId) || source.categories.includes("*"));
}

export function scoreCategory(args: {
  category: CategoryRecord;
  sources: DataSourceRecord[];
  coverage: CategoryCoverage | undefined;
  observations: InefficiencyObservation[];
  creditsForCategory: number | null;
}): CategoryScorecard {
  const related = sourcesFor(args.category, args.sources);
  const verified = related.filter((source) => source.status === "VERIFIED_ACCESS");
  const documented = related.filter((source) => source.status === "DOCUMENTED_BUT_UNTESTED" || source.status === "REQUIRES_SUBSCRIPTION");
  const verifiedHistory = verified.filter((source) => source.historicalDepth && source.reliability === "tested" && source.provider !== "PrizePicks board");
  const families = args.coverage?.families ?? [];
  const unknownFamilies = families.filter((family) => family.coverage === "UNKNOWN").length;
  const exactFamilies = families.filter((family) => family.coverage === "EXACT_COMPARABLE_MARKET").length;
  const categoryObs = args.observations.filter((row) => row.categoryId === args.category.categoryId);
  const longitudinal = summarizeObservations(categoryObs);
  const ranges = categoryObs.map((row) => row.bookmakerCount).filter((value): value is number => value != null);

  const dataAvailability: DimensionScore =
    verified.length >= 2
      ? dimension(80, "80 when two or more sources were actually called for this category.", `${verified.length} verified sources.`)
      : verified.length === 1
        ? dimension(50, "50 when one source was actually called. The live board alone is that source.", verified.map((source) => source.provider).join(", "))
        : documented.length
          ? dimension(25, "25 when sources are only documented and none were called.", `${documented.length} untested sources.`)
          : dimension("UNKNOWN", "UNKNOWN when no source was verified or documented.", "No source records.");

  const historicalDepth: DimensionScore = verifiedHistory.length
    ? dimension(60, "60 when a verified source other than the live board recorded a tested history span.", verifiedHistory.map((source) => `${source.provider}: ${source.historicalDepth}`).join("; "))
    : dimension("UNKNOWN", "UNKNOWN when no verified source recorded historical depth. Missing history is not a zero.", "No tested history span.");

  const decided = related.filter((source) => source.status !== "UNKNOWN");
  const sourceReliability: DimensionScore = decided.length
    ? dimension(
        Math.round((verified.length / decided.length) * 100),
        "Verified sources divided by sources whose status is not UNKNOWN, times 100.",
        `${verified.length} verified of ${decided.length} decided sources.`
      )
    : dimension("UNKNOWN", "UNKNOWN when every source status is UNKNOWN.", "No decided sources.");

  const modelingFeasibility: DimensionScore = verifiedHistory.length
    ? dimension(55, "55 when a verified historical source exists. That supports a baseline, not a proven model.", verifiedHistory.map((source) => source.provider).join(", "))
    : dimension("UNKNOWN", "UNKNOWN without a verified historical stat source. The live board is not a training set.", "No historical source.");

  const independentMarketCoverage: DimensionScore =
    !args.coverage || !families.length || unknownFamilies === families.length
      ? dimension("UNKNOWN", "UNKNOWN when market coverage was not classified.", `${unknownFamilies} families still unknown.`)
      : unknownFamilies > 0 && exactFamilies === 0
        ? dimension("UNKNOWN", "UNKNOWN when remaining families were not requested and none were confirmed.", `${unknownFamilies} unrequested families.`)
        : dimension(
            Math.round((exactFamilies / families.length) * 100),
            "Exact full-game families divided by all prop families, times 100. A looked-up miss is a real zero.",
            `${exactFamilies} exact of ${families.length} families.`
          );

  const discrepancyFrequency: DimensionScore =
    longitudinal.eventDiscrepancyRate === "UNKNOWN"
      ? dimension("UNKNOWN", "UNKNOWN until two dates and five independent events exist. A single slate is not a rate.", longitudinal.note)
      : dimension(
          Math.round(longitudinal.eventDiscrepancyRate * 100),
          "Share of independent events with a verified discrepancy, times 100. Props in one match count once.",
          `${longitudinal.independentEvents} independent events.`
        );

  const discrepancyPersistence: DimensionScore =
    longitudinal.observationDays < 2
      ? dimension("UNKNOWN", "UNKNOWN with fewer than two observation dates. Missing persistence is not a zero.", `${longitudinal.observationDays} observation date.`)
      : dimension(
          longitudinal.repeatableKeys,
          "Count of player, family, and direction keys seen on two or more dates. This is a count, not a probability.",
          `${longitudinal.repeatableKeys} keys recurred.`
        );

  const priced = categoryObs.filter((row) => row.bookmakerCount != null && row.bookmakerCount >= 2);
  const pricingUncertainty: DimensionScore = priced.length
    ? dimension(
        Math.min(100, Math.round((priced.reduce((sum, row) => sum + (row.discrepancyPoints == null ? 10 : Math.abs(row.discrepancyPoints)), 0) / priced.length) * 10)),
        "Mean absolute line gap times 10, capped at 100. Higher means a less stable comparison, not a better bet.",
        `${priced.length} priced comparisons. Books in sample: ${ranges.join(", ") || "n/a"}.`
      )
    : dimension("UNKNOWN", "UNKNOWN when no two-book quote was stored.", "No priced comparison.");

  const operationalCost: DimensionScore =
    args.creditsForCategory == null
      ? dimension("UNKNOWN", "UNKNOWN when this category was not billed to a measured request.", "No category-level credit measurement.")
      : dimension(
          Math.max(0, 100 - args.creditsForCategory * 5),
          "100 minus 5 points per Odds API credit spent on this category, floored at 0.",
          `${args.creditsForCategory} credits.`
        );

  const commercialKnown = verified.filter((source) => source.commercialUse !== "unknown");
  const commercialUse: DimensionScore = !commercialKnown.length
    ? dimension("UNKNOWN", "UNKNOWN when no verified source states a commercial-use term.", "License not verified.")
    : commercialKnown.some((source) => source.commercialUse === "prohibited")
      ? dimension(0, "0 when a verified source prohibits commercial use.", commercialKnown.map((source) => source.commercialUse).join(", "))
      : commercialKnown.some((source) => source.commercialUse === "allowed")
        ? dimension(100, "100 only when a verified source allows commercial use.", commercialKnown.map((source) => `${source.provider} ${source.commercialUse}`).join(", "))
        : dimension(40, "40 when verified access is restricted rather than prohibited or granted.", commercialKnown.map((source) => `${source.provider} ${source.commercialUse}`).join(", "));

  const claimsRepeatableInefficiency =
    longitudinal.observationDays >= 2 && longitudinal.independentEvents >= 5 && longitudinal.repeatableKeys > 0;

  return {
    categoryId: args.category.categoryId,
    displayName: args.category.displayName,
    dimensions: {
      dataAvailability,
      historicalDepth,
      sourceReliability,
      modelingFeasibility,
      independentMarketCoverage,
      discrepancyFrequency,
      discrepancyPersistence,
      pricingUncertainty,
      operationalCost,
      commercialUse,
    },
    claimsRepeatableInefficiency,
  };
}

export function investigationOrder(categories: CategoryRecord[], coverage: CategoryCoverage[]): string[] {
  const exact = new Map(coverage.map((row) => [row.categoryId, row.families.filter((family) => family.coverage === "EXACT_COMPARABLE_MARKET").length]));
  return [...categories]
    .sort((a, b) => {
      const named = Number(a.nameResolution !== "unresolved") - Number(b.nameResolution !== "unresolved");
      if (named) return named > 0 ? -1 : 1;
      const market = (exact.get(b.categoryId) ?? 0) - (exact.get(a.categoryId) ?? 0);
      if (market) return market;
      return b.standardPropCount - a.standardPropCount;
    })
    .map((category) => category.categoryId);
}

export function empiricalOrder(scorecards: CategoryScorecard[]): string[] {
  return scorecards.filter((row) => row.claimsRepeatableInefficiency).map((row) => row.categoryId);
}

export function opportunityMatrix(args: {
  categories: CategoryRecord[];
  coverage: CategoryCoverage[];
  sources: DataSourceRecord[];
}): OpportunityRow[] {
  const coverageById = new Map(args.coverage.map((row) => [row.categoryId, row]));
  const rows = args.categories.map((category) => {
    const families = coverageById.get(category.categoryId)?.families ?? [];
    const exact = families.some((family) => family.coverage === "EXACT_COMPARABLE_MARKET");
    const verifiedHistory = sourcesFor(category, args.sources).some(
      (source) => source.status === "VERIFIED_ACCESS" && source.historicalDepth && source.provider !== "PrizePicks board"
    );
    let effort: EffortClass = "BLOCKED_BY_DATA";
    let why = "The provider sport is unresolved, or neither a same-scope sportsbook market nor a verified history was found.";
    if (category.nameResolution !== "unresolved" && exact && sportKeyForLeague(category.displayName)) {
      effort = "LOW_EFFORT";
      why = "This category already has a sportsbook key in the odds client and at least one same-scope market.";
    } else if (category.nameResolution !== "unresolved" && exact) {
      effort = "MEDIUM_EFFORT";
      why = "A same-scope market was observed, and settlement history is not in this repository.";
    } else if (category.nameResolution !== "unresolved" && verifiedHistory) {
      effort = "HIGH_EFFORT";
      why = "Historical data was verified, and an independent same-scope market was not.";
    } else if (category.nameResolution !== "unresolved") {
      effort = "BLOCKED_BY_DATA";
      why = "The category is named, and this audit did not verify a history or a same-scope market.";
    }
    return { categoryId: category.categoryId, displayName: category.displayName, effort, why, sequence: "" };
  });
  const rank: Record<EffortClass, number> = { LOW_EFFORT: 0, MEDIUM_EFFORT: 1, HIGH_EFFORT: 2, BLOCKED_BY_DATA: 3 };
  rows.sort((a, b) => rank[a.effort] - rank[b.effort] || a.displayName.localeCompare(b.displayName));
  return rows.map((row, index) => ({
    ...row,
    sequence:
      row.effort === "LOW_EFFORT"
        ? `${index + 1}. Build a baseline comparison on the existing odds client before a new data vendor.`
        : row.effort === "MEDIUM_EFFORT"
          ? `${index + 1}. Keep the market comparison and add verified settlement before any model.`
          : row.effort === "HIGH_EFFORT"
            ? `${index + 1}. The history exists without a same-scope market, so price the license and the market gap before modeling.`
            : `${index + 1}. Identify the provider sport and a licensed history before writing a model.`,
  }));
}

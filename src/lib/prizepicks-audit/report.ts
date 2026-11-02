import type { AuditReport, CategoryScorecard, ScoreValue } from "./types";

function scoreText(score: ScoreValue): string {
  return score === "UNKNOWN" ? "UNKNOWN" : String(score);
}

function line(scorecard: CategoryScorecard): string {
  const dims = scorecard.dimensions;
  return `| ${scorecard.displayName} | ${scoreText(dims.dataAvailability.score)} | ${scoreText(dims.historicalDepth.score)} | ${scoreText(dims.modelingFeasibility.score)} | ${scoreText(dims.independentMarketCoverage.score)} | ${scoreText(dims.discrepancyFrequency.score)} | ${scoreText(dims.discrepancyPersistence.score)} | ${scorecard.claimsRepeatableInefficiency ? "yes" : "no"} |`;
}

export function renderAuditMarkdown(report: AuditReport): string {
  const families = report.categories.reduce((sum, category) => sum + category.propFamilies.length, 0);
  const verifiedCategories = new Set(
    report.sources.filter((source) => source.status === "VERIFIED_ACCESS").flatMap((source) => source.categories)
  );
  const comparable = report.coverage.filter((row) => row.families.some((family) => family.coverage === "EXACT_COMPARABLE_MARKET")).length;
  const names = new Map(report.categories.map((category) => [category.categoryId, category.displayName]));
  const investigate = report.investigateRanking.slice(0, 5).map((id) => names.get(id) ?? id);
  const discrepancies = report.observations.filter((row) => row.comparison === "VERIFIED_MARKET_DISCREPANCY");
  const sections = [
    "# PrizePicks market inefficiency audit",
    "",
    "This is an evaluation of where research effort could go. It is not a pick sheet, and it does not claim expected value.",
    "",
    "## Executive summary",
    "",
    `Discovered ${report.categories.length} categories and ${families} prop families.`,
    `Categories with a verified source: ${report.categories.filter((category) => verifiedCategories.has(category.categoryId) || verifiedCategories.has("*")).length}.`,
    `Categories with a same-scope sportsbook market confirmed this run: ${comparable}.`,
    `Odds API credits: ${report.oddsCredits}. Grok calls: ${report.grokCalls}. Grok cost: ${report.grokCostUsd == null ? "unknown" : `$${report.grokCostUsd}`}.`,
    report.empiricalRanking.length
      ? `Empirically repeated inefficiencies: ${report.empiricalRanking.map((id) => names.get(id) ?? id).join(", ")}.`
      : "No category has a repeated, independently counted discrepancy yet. A single slate is not enough.",
    investigate.length ? `First categories to investigate: ${investigate.join(", ")}.` : "No category cleared the investigation sort.",
    "",
    "## Full category inventory",
    "",
    ...report.categories.flatMap((category) => [
      `### ${category.displayName} (${category.categoryId})`,
      "",
      `Name source: ${category.nameResolution}. Sport assignment: ${category.sportAssignment}. Sport or game: ${category.sportOrGame ?? "unassigned"}.`,
      `Events ${category.activeEventCount} (${category.upcomingEventCount} upcoming), players ${category.activePlayerCount}, props ${category.activePropCount} (${category.standardPropCount} standard, ${category.promotionalPropCount} promotional).`,
      `Freshness: ${category.dataFreshness ?? "unknown"}. Scoring definitions: not provided by the board payload.`,
      "",
      ...category.propFamilies.slice(0, 12).map((family) =>
        `- ${family.providerLabel} — family ${family.normalizedFamily}, scope ${family.scope.label}, ${family.valueKind}, standard ${family.standardCount}, promotional ${family.promotionalCount}${family.abbreviationUnexpanded ? ", abbreviation left unexpanded" : ""}`
      ),
      category.propFamilies.length > 12 ? `- ${category.propFamilies.length - 12} more prop families are in category-inventory.json.` : "",
      "",
    ]),
    "## Data availability",
    "",
    ...report.sources.map((source) =>
      `- ${source.provider}: ${source.status}. Tested: ${source.tested ? "yes" : "no"}. Price: ${source.price ?? "not verified"}. Commercial use: ${source.commercialUse}. ${source.notes}`
    ),
    "",
    "## Sportsbook comparison availability",
    "",
    ...report.coverage.flatMap((row) => [
      `### ${row.displayName}`,
      "",
      `Odds sport: ${row.oddsSportKey ?? "none"}.`,
      ...row.families.slice(0, 8).map((family) => `- ${family.providerLabel} (${family.scopeLabel}): ${family.coverage}. ${family.reason}`),
      "",
    ]),
    "## Potential inefficiencies",
    "",
    discrepancies.length
      ? discrepancies.slice(0, 20).map((row) => `- ${row.displayName} ${row.player} ${row.propFamily} ${row.prizePicksLine} vs book ${row.sportsbookLine}: ${row.comparison}. ${row.rejectionReason ?? row.comparison}`).join("\n")
      : "No verified market discrepancy was stored. Possible and insufficient comparisons stay in inefficiency-observations.json and are not treated as an edge.",
    "",
    "## Repeatability",
    "",
    report.longitudinal.note,
    `Observation dates: ${report.longitudinal.observationDays}. Independent events: ${report.longitudinal.independentEvents}. Valid comparisons: ${report.longitudinal.validComparisons}. Keys seen on two or more dates: ${report.longitudinal.repeatableKeys}.`,
    "",
    "## Model feasibility",
    "",
    "A category can be worth investigating when the board and a same-scope market are both real. Modeling still needs a verified history. Historical depth is UNKNOWN until that history is loaded. P1 settlement, closing-line value, and calibration are not claimed.",
    "",
    "## Engineering roadmap",
    "",
    ...report.matrix.slice(0, 15).map((row) => `- ${row.displayName} — ${row.effort}. ${row.why} ${row.sequence}`),
    "",
    "## Category scorecard",
    "",
    "| Category | Data | History | Model | Market | Discrepancy | Persistence | Repeatable claim |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...report.scorecards.slice(0, 25).map(line),
    "",
    "Scores follow the formulas in category-scorecard.json. UNKNOWN means the evidence was not collected. It is not a zero and it is not a favorable score.",
    "",
    "## Unresolved questions",
    "",
    ...report.limitations.map((item) => `- ${item}`),
    ...report.categories.filter((category) => category.nameResolution === "unresolved").map((category) => `- ${category.displayName} still has no provider sport name.`),
    "- Which discrepancies survive a second slate and a verified settlement?",
    "- What is the licensed price of any history Grok only named?",
    "",
  ];
  return sections.filter((part) => part !== undefined).join("\n");
}

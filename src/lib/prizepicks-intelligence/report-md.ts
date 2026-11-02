import type { IntelligenceSignal, RunReport } from "./types";

const BANNED = /\b(LOCK|BEST BET|FREE MONEY|CAN’T MISS|CAN'T MISS|GUARANTEE|MORTGAGE PLAY|MAX PLAY)\b/i;

function chicagoDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Chicago",
  });
}

function renderSignal(signal: IntelligenceSignal): string {
  const sources = signal.sources
    .map((source) => `- ${source.author} / ${source.outlet} (${source.sourceType}, ${source.credibility}) ${source.publishedAt} ${source.url}`)
    .join("\n");
  return [
    `### ${signal.player} — ${signal.statType} ${signal.projection}`,
    "",
    `- Sport: ${signal.sport}`,
    `- Event: ${signal.event}`,
    `- Player: ${signal.player}`,
    `- Market: ${signal.statType} ${signal.projection}`,
    `- PrizePicks projection: ${signal.projection}`,
    `- Expected direction: ${signal.direction}`,
    `- Signal type: ${signal.signalType}`,
    `- Evidence confidence: ${signal.evidenceConfidence}`,
    `- Market awareness: ${signal.marketAwareness}`,
    `- Freshness: ${signal.freshnessMinutes} minutes`,
    "",
    `**What changed**`,
    "",
    signal.whatChanged,
    "",
    `**Why now**`,
    "",
    signal.whyNow,
    "",
    `**Why it matters**`,
    "",
    signal.whyItMatters,
    "",
    `**Causal chain**`,
    "",
    ...signal.causalChain.map((step) => `1. ${step}`),
    "",
    `**Evidence**`,
    "",
    sources || "- none",
    "",
    `**Why the market may not fully reflect it**`,
    "",
    signal.alreadyPricedArgument,
    "",
    `**Bull case**`,
    "",
    signal.bullCase,
    "",
    `**Bear case**`,
    "",
    signal.bearCase,
    "",
    `**What may already be priced in**`,
    "",
    signal.alreadyPricedArgument,
    "",
    `**Missing evidence**`,
    "",
    signal.missingEvidence,
    "",
    `**Invalidation condition**`,
    "",
    signal.invalidationCondition,
    "",
    `**Verdict**`,
    "",
    signal.verdict,
    "",
  ].join("\n");
}

export function renderIntelligenceMarkdown(report: RunReport): string {
  const high = report.signals.filter((signal) => signal.evidenceConfidence === "HIGH").length;
  const section1 = report.signals.length
    ? report.signals.map(renderSignal).join("\n")
    : "No defensible market dislocations identified from currently available evidence.\n";
  const section2 = report.watchlist.length
    ? report.watchlist
        .map(
          (item) =>
            `- **${item.player}** (${item.sport} ${item.market}): ${item.developingSignal}. Missing: ${item.missingConfirmation}. Next: ${item.expectedNextSource} by ${item.expectedResolutionTime}.`
        )
        .join("\n")
    : "None.";
  const section3 = report.contextSignals.length
    ? report.contextSignals.map((signal) => `- ${signal.player} ${signal.statType} ${signal.projection}: ${signal.whatChanged} (${signal.marketAwareness})`).join("\n")
    : "None.";
  const incomplete = report.incomplete ?? [];
  const sectionIncomplete = incomplete.length
    ? incomplete
        .map((row) => `- **${row.event}**: research did not finish (${row.reason}). Not a rejected thesis — this game was never judged.`)
        .join("\n")
    : "None.";
  const section4 = report.rejected.length
    ? report.rejected.map((row) => `- **${row.player}** ${row.market}: ${row.initialHypothesis} — rejected because ${row.whyRejected}`).join("\n")
    : "None.";
  const sourceRows = report.signals
    .flatMap((signal) => signal.sources.map((source) => ({ source, signalId: signal.signalId })))
    .concat(
      report.contextSignals.flatMap((signal) => signal.sources.map((source) => ({ source, signalId: signal.signalId })))
    );
  const section5 = sourceRows.length
    ? sourceRows
        .map(
          ({ source, signalId }) =>
            `- ${source.outlet} / ${source.author} / ${source.publishedAt} / ${source.url} / ${source.credibility} / ${signalId}`
        )
        .join("\n")
    : "None.";

  const markdown = [
    `# DAILY PLAYER MARKET INTELLIGENCE`,
    chicagoDate(report.generatedAt),
    "",
    `Generated: ${report.generatedAt}`,
    `Markets analyzed: ${report.marketsAnalyzed}`,
    `Sports analyzed: ${report.sportsAnalyzed.join(", ") || "none"}`,
    `Material signals: ${report.signals.length}`,
    `High-confidence signals: ${high}`,
    `Watchlist: ${report.watchlist.length}`,
    `Incomplete research: ${incomplete.length}`,
    `Rejected theses: ${report.rejected.length}`,
    "",
    `## SECTION 1`,
    ``,
    `### HIGHEST-CONFIDENCE MARKET DISLOCATIONS`,
    "",
    section1,
    `## SECTION 2`,
    "",
    `### WATCHLIST`,
    "",
    section2,
    "",
    `## SECTION 3`,
    "",
    `### IMPORTANT CHANGES WITH NO CLEAR MARKET DISLOCATION`,
    "",
    section3,
    "",
    `## SECTION 4`,
    "",
    `### INCOMPLETE RESEARCH`,
    "",
    sectionIncomplete,
    "",
    `## SECTION 5`,
    "",
    `### REJECTED THESES`,
    "",
    section4,
    "",
    `## SECTION 6`,
    "",
    `### SOURCE AUDIT`,
    "",
    section5,
    "",
  ].join("\n");

  if (BANNED.test(markdown)) {
    return markdown.replace(BANNED, "UNSUPPORTED_LABEL");
  }
  return markdown;
}

export function formatTerminalSummary(report: RunReport, mdPath: string): string {
  const high = report.signals.filter((signal) => signal.evidenceConfidence === "HIGH").length;
  const medium = report.signals.filter((signal) => signal.evidenceConfidence === "MEDIUM").length;
  const newly = report.signals.filter((signal) => signal.marketAwareness === "NEWLY_EMERGED").length;
  const under = report.signals.filter((signal) => signal.marketAwareness === "POSSIBLY_UNDER_REFLECTED").length;
  return [
    "PRIZEPICKS MARKET INTELLIGENCE",
    "",
    `Markets analyzed: ${report.marketsAnalyzed}`,
    `Sports analyzed: ${report.sportsAnalyzed.length}`,
    "",
    `High-confidence signals: ${high}`,
    `Medium-confidence signals: ${medium}`,
    `Watchlist: ${report.watchlist.length}`,
    `Incomplete research: ${(report.incomplete ?? []).length}`,
    `Rejected: ${report.rejected.length}`,
    "",
    "NEWLY EMERGED",
    String(newly),
    "",
    "POSSIBLY UNDER-REFLECTED",
    String(under),
    "",
    "Report:",
    mdPath,
    "",
    "For a TAKE/WATCH pick list: npm run prizepicks:picks",
  ].join("\n");
}

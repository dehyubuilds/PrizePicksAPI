import type { ValorantReport } from "./types";

export function renderValorantMarkdown(report: ValorantReport): string {
  const matches = new Set(report.props.map((prop) => prop.eventId));
  const standard = report.props.filter((prop) => prop.eligible);
  const lines = [
    "# VALORANT Maps 1–2 research",
    "",
    "This report compares a baseline expectation with PrizePicks lines only when pre-match map history exists. It does not place a wager, and a model gap is not expected value.",
    "",
    `Generated: ${report.generatedAt}`,
    `Matches: ${matches.size}. Maps 1–2 kill props: ${report.props.length}. Standard props eligible for a model: ${standard.length}.`,
    `Historical map rows: ${report.history.length}. Grok calls: ${report.grokCalls}. Grok cost: ${report.grokCostUsd == null ? "unknown" : `$${report.grokCostUsd}`}.`,
    report.grokNote,
    "",
    "## Board",
    "",
    ...report.props.map((prop) => `- ${prop.player} (${prop.team} vs ${prop.opponent}) ${prop.line} ${prop.statLabel} at ${prop.startTime}. ${prop.propClass}. ${prop.eligible ? "standard" : "not modeled"}`),
    "",
    "## Sources",
    "",
    ...report.sources.map((source) => `- ${source.name}: ${source.reliability}. API: ${source.apiAccess}. Handle: ${source.handle ?? "none verified"}. ${source.notes}`),
    "",
    "## History blockers",
    "",
    ...(report.historyBlockers.length ? report.historyBlockers.map((item) => `- ${item}`) : ["- None recorded."]),
    "",
    "## Intelligence",
    "",
    ...(report.intelligence.length
      ? report.intelligence.map((item) => `- ${item.status}: ${item.claim || "empty claim"} (${item.effect}). Measured kill delta: none.`)
      : ["- No verified match intelligence was stored."]),
    "",
    "## Projections",
    "",
    ...report.projections.map((row) =>
      `- ${row.player} line ${row.line}: ${row.status}. Baseline ${row.baselineExpected ?? "withheld"}. More/Less/Push: ${row.probabilityMore ?? "withheld"} / ${row.probabilityLess ?? "withheld"} / ${row.probabilityPush ?? "withheld"}. ${row.verdict}. ${row.reason}`
    ),
    "",
    "## Backtest",
    "",
    report.backtest.note,
    `Held-out rows: ${report.backtest.heldOut}. Model B improved: ${report.backtest.modelBImproved ? "yes" : "no"}.`,
    "",
    "## Limits",
    "",
    ...report.limitations.map((item) => `- ${item}`),
    "",
  ];
  return lines.join("\n");
}

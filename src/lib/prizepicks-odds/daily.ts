import {
  dailyThresholds,
  exclusionCounts,
  exclusionSentence,
  RANKING_VERSION,
  rankBestPicks,
  type DailyPick,
  type DailyThresholds,
} from "./best-picks";
import { candidateEntry } from "./entries";
import { evaluateProp, type EvaluatedProp, type ScanPropInput } from "./evaluate";
import { MODEL_VERSION } from "./features";
import { discrepancyBoards, sportBoards, rejectionSummary, type RankMode } from "./leaderboard";
import { UNVERIFIED_PAYOUTS, type PayoutBook } from "./payouts";
import { applyFinding, type ResearchFinding } from "./research";
import { MIN_MEANINGFUL_SAMPLE, type ScoreReport } from "./scoring";
import { diffSnapshots, toSnapshot, type OddsSnapshot, type ScanChange } from "./snapshots";

export type DailyReport = {
  generatedAt: string;
  modelVersion: typeof MODEL_VERSION;
  rank: RankMode;
  creditsSpent: number;
  remaining: number | null;
  activeSports: string[];
  boards: Record<string, EvaluatedProp[]>;
  crossSportEv: null;
  crossSportEvReason: string;
  entry: ReturnType<typeof candidateEntry>;
  rejections: Array<{ reason: string; count: number }>;
  discrepancies: Record<string, EvaluatedProp[]>;
  changes: ScanChange[];
  payoutProvenance: string;
  note: string;
  snapshot: OddsSnapshot;
  propsScanned: number;
  directCount: number;
  interpolatedCount: number;
  unpricedCount: number;
  grokCalls: number;
  grokCostUsd: number | null;
  historical: ScoreReport | null;
  picks: DailyPick[];
  thresholds: DailyThresholds;
  rankingVersion: typeof RANKING_VERSION;
  gamesScanned: number;
  researchNote: string;
  scanTruncated: boolean;
  exclusions: Record<string, number>;
  sportsConsidered: string[];
};

export function buildDailyReport(params: {
  generatedAt: string;
  props: ScanPropInput[];
  creditsSpent: number;
  remaining: number | null;
  rank?: RankMode;
  countPerSport?: number;
  entryCount?: number;
  previous?: OddsSnapshot | null;
  payouts?: PayoutBook;
  findings?: Record<string, ResearchFinding>;
  grokCalls?: number;
  grokCostUsd?: number | null;
  historical?: ScoreReport | null;
  thresholds?: Partial<DailyThresholds>;
  researchNote?: string;
  scanTruncated?: boolean;
}): DailyReport {
  const rank = params.rank ?? "probability";
  const thresholds = dailyThresholds(params.thresholds);
  const evaluated = params.props
    .map((prop) => evaluateProp(prop, params.generatedAt))
    .map((prop) => applyFinding(prop, params.findings?.[prop.id]));
  const count = params.countPerSport ?? 5;
  const picks = rank === "ev" || rank === "opportunity" ? [] : rankBestPicks(evaluated, params.generatedAt, thresholds, params.previous ?? null);
  const boards = rank === "ev" ? {} : rank === "opportunity" ? discrepancyBoards(evaluated, count) : sportBoards(evaluated, count, rank);
  const snapshot = toSnapshot({
    generatedAt: params.generatedAt,
    modelVersion: MODEL_VERSION,
    creditsSpent: params.creditsSpent,
    remaining: params.remaining,
    props: evaluated,
  });
  const payouts = params.payouts ?? UNVERIFIED_PAYOUTS;
  return {
    generatedAt: params.generatedAt,
    modelVersion: MODEL_VERSION,
    rank,
    creditsSpent: params.creditsSpent,
    remaining: params.remaining,
    activeSports: Object.keys(boards),
    boards,
    crossSportEv: null,
    crossSportEvReason: payouts.verified
      ? "Cross-sport EV is withheld because joint correlation is not estimated."
      : payouts.provenance,
    entry: candidateEntry(
      evaluated.filter((prop) => prop.selectionRank != null),
      params.entryCount ?? 6
    ),
    rejections: rejectionSummary(evaluated),
    discrepancies: discrepancyBoards(evaluated, count),
    changes: diffSnapshots(params.previous ?? null, snapshot),
    payoutProvenance: payouts.provenance,
    snapshot,
    propsScanned: params.props.length,
    directCount: evaluated.filter((prop) => prop.probabilitySource === "direct").length,
    interpolatedCount: evaluated.filter((prop) => prop.probabilitySource === "interpolated").length,
    unpricedCount: evaluated.filter((prop) => prop.rejectionReasons.includes("exact_line_not_priced") || prop.rejectionReasons.includes("unpriced")).length,
    grokCalls: params.grokCalls ?? 0,
    grokCostUsd: params.grokCostUsd ?? null,
    historical: params.historical ?? null,
    picks,
    thresholds,
    rankingVersion: RANKING_VERSION,
    gamesScanned: new Set(params.props.map((prop) => prop.gameId)).size,
    researchNote: params.researchNote ?? "Research was not requested.",
    scanTruncated: params.scanTruncated ?? false,
    exclusions: exclusionCounts(evaluated, params.generatedAt, thresholds),
    sportsConsidered: [...new Set(evaluated.map((prop) => prop.sport))],
    note:
      rank === "ev"
        ? "EV ranking is empty. No verified PrizePicks payout is on file, so nothing is sorted by a made-up price."
        : rank === "opportunity"
          ? "Ranked by the line gap. These rows are not hit probabilities."
          : rank === "confidence"
            ? "Ordered by fresh multi-book prices and clean research flags. This is not a confidence percentage and it is not a calibrated player model."
            : "The list is ordered by evidence quality, then by the market-implied hit chance. This is not a calibrated player model.",
  };
}

export function snapshotFromReport(report: DailyReport, props: EvaluatedProp[]): OddsSnapshot {
  return toSnapshot({
    generatedAt: report.generatedAt,
    modelVersion: report.modelVersion,
    creditsSpent: report.creditsSpent,
    remaining: report.remaining,
    props,
  });
}

export function formatDailyReport(report: DailyReport): string {
  if (report.rank === "opportunity" || report.rank === "ev") return formatTechnicalReport(report);
  return formatBestPicks(report);
}

export function formatBestPicks(report: DailyReport): string {
  const scannedSports = report.sportsConsidered.length ? report.sportsConsidered : report.activeSports;
  const lines = [
    "========================================",
    "        PRIZEPICKS DAILY BEST PICKS",
    "========================================",
    "",
    `Generated: ${report.generatedAt}`,
    `Sports scanned: ${scannedSports.length ? scannedSports.join(", ") : "none with a qualifying pick"}`,
    `Games scanned: ${report.gamesScanned}`,
    `Props evaluated: ${report.propsScanned}`,
    `Qualified picks: ${report.picks.length}`,
    `Odds API credits: ${report.creditsSpent}${report.remaining == null ? "" : ` · ${report.remaining} left this month`}`,
    `Research: ${report.researchNote}`,
    "",
  ];
  if (report.scanTruncated) {
    lines.push("This scan stopped early because the credit budget was hit. Treat the list as incomplete.", "");
  }
  if (!report.picks.length) {
    lines.push("No qualifying picks today.", "", "Reasons:");
    const reasons = Object.entries(report.exclusions);
    if (!reasons.length) lines.push("- No sufficiently priced markets");
    for (const [reason, count] of reasons) lines.push(`- ${exclusionSentence(reason, count)}`);
    lines.push("", "No selections recommended.");
  } else {
    lines.push("TOP PICKS", "");
    for (const pick of report.picks) {
      const side = pick.side === "over" ? "Over" : "Under";
      lines.push(`#${pick.rank} — ${pick.player}`);
      lines.push(`${pick.sport} | ${side} ${pick.line} ${pick.stat}`);
      lines.push(`${pick.player} vs ${pick.opponent}`);
      lines.push("");
      lines.push(`Market-implied hit chance: ${pick.marketProbability}%`);
      lines.push(`Evidence: ${pick.evidenceQuality.toUpperCase()}`);
      lines.push(`Pricing: ${pick.pricingMethod === "direct" ? "DIRECT" : "INTERPOLATED"}`);
      lines.push(`Sportsbooks: ${pick.sportsbookCount}`);
      lines.push(`Quote age: ${pick.quoteAgeMinutes == null ? "not listed" : `${pick.quoteAgeMinutes} minutes`}`);
      lines.push("");
      lines.push("WHY THIS PICK");
      for (const reason of pick.reasons) lines.push(`- ${reason}`);
      lines.push("");
      lines.push("WATCH OUT");
      if (!pick.warnings.length) lines.push("- No material warning on the priced evidence.");
      for (const warning of pick.warnings) lines.push(`- ${warning}`);
      lines.push("", "----------------------------------------", "");
    }
  }
  const scratches = report.exclusions.player_unavailable ?? 0;
  const warnings = report.picks.filter((pick) => pick.researchStatus === "warnings").length;
  lines.push("RESEARCH");
  lines.push(report.researchNote);
  lines.push(`${report.grokCalls} Grok calls. Spend: ${report.grokCostUsd == null ? "unavailable" : `$${report.grokCostUsd}`}.`);
  lines.push(`${scratches} verified scratches removed from the board.`);
  lines.push(`${warnings} availability warnings kept on the list.`, "");
  lines.push("EXCLUDED");
  const excluded = Object.entries(report.exclusions);
  if (!excluded.length) lines.push("None.");
  for (const [reason, count] of excluded) lines.push(exclusionSentence(reason, count));
  lines.push("", "POSSIBLE ENTRY CANDIDATES");
  lines.push("These are not a recommended ticket and they are not a positive-EV play.");
  if (!report.entry.legs.length) lines.push("None.");
  report.entry.legs.slice(0, 3).forEach((leg, index) => {
    lines.push(`${index + 1}. ${leg.sport} ${leg.label}`);
  });
  for (const row of report.entry.dependencies) lines.push(`Warning: ${row.kind}`);
  lines.push("", "Expected value: unavailable.");
  lines.push(report.crossSportEvReason);
  lines.push("A high hit chance is not the same thing as a profitable bet.");
  lines.push(report.note);
  lines.push("");
  lines.push("HISTORICAL PERFORMANCE");
  lines.push(historyLine(report.historical));
  if (report.changes.length) {
    lines.push("", "SINCE THE LAST SNAPSHOT");
    for (const change of report.changes.slice(0, 8)) {
      if (change.kind === "line") lines.push(`Line ${change.label}: ${change.from} → ${change.to}`);
      else if (change.kind === "removed") lines.push(`Removed ${change.label}`);
      else if (change.kind === "added") lines.push(`New ${change.label}`);
      else lines.push(`Chance ${change.label}: ${change.from}% → ${change.to}%`);
    }
  }
  lines.push("", "========================================");
  return lines.join("\n");
}

function historyLine(historical: ScoreReport | null): string {
  if (!historical || historical.sampleSize === 0) {
    return "No graded sample yet. Market probabilities are not a calibrated player model.";
  }
  const rate = historical.hitRate == null ? "n/a" : `${Math.round(historical.hitRate * 1000) / 10}%`;
  if (historical.sampleSize < MIN_MEANINGFUL_SAMPLE) {
    return `Settled ${historical.sampleSize}. Hit rate ${rate}. Brier ${historical.brier}. That sample is too small to describe the system.`;
  }
  return `Settled ${historical.sampleSize}. Hit rate ${rate}. Brier ${historical.brier}. Log loss ${historical.logLoss}.`;
}

function formatTechnicalReport(report: DailyReport): string {
  const lines = [
    "DAILY PROP REPORT",
    report.note,
    `Model ${report.modelVersion} · ${report.generatedAt}`,
    `Credits this run: ${report.creditsSpent}${report.remaining == null ? "" : ` · ${report.remaining} left this month`}`,
    `Props scanned: ${report.propsScanned}. Direct prices: ${report.directCount}. Interpolated: ${report.interpolatedCount}. Unpriced gaps: ${report.unpricedCount}.`,
    `Grok calls: ${report.grokCalls}. Grok spend: ${report.grokCostUsd == null ? "unavailable" : `$${report.grokCostUsd}`}.`,
    "",
    report.activeSports.length
      ? `Active sports: ${report.activeSports.join(", ")}`
      : "No sport had a prop the books priced at the PrizePicks number.",
    "",
  ];
  if (report.rank === "ev") {
    lines.push("EV leaderboard withheld.", report.crossSportEvReason, "");
  } else {
    for (const [sport, legs] of Object.entries(report.boards)) {
      lines.push(sport);
      legs.forEach((leg, index) => {
        lines.push(`  ${index + 1}. ${formatLeg(leg)}`);
        lines.push(`     ${leg.explanation}`);
        if (leg.researchSummary) lines.push(`     Research: ${leg.researchSummary}`);
        if (leg.researchFlags.length) lines.push(`     Flags: ${leg.researchFlags.join(", ")}`);
      });
      lines.push("");
    }
  }
  lines.push("Cross-sport EV: unavailable.", report.crossSportEvReason, "");
  lines.push("Entry candidate (not a submitted ticket):");
  if (!report.entry.legs.length) lines.push("  None.");
  report.entry.legs.forEach((leg, index) => {
    lines.push(`  ${index + 1}. ${leg.sport} ${leg.label} · hit ${leg.marketProbability}%`);
  });
  if (report.entry.dependencies.length) {
    for (const row of report.entry.dependencies) {
      lines.push(`  Warning: ${row.kind} · ${row.labels.join(" | ")}`);
    }
  }
  lines.push(`  ${report.entry.reason}`, "");
  lines.push("Market discrepancies:");
  const discrepancyRows = Object.entries(report.discrepancies);
  if (!discrepancyRows.length) lines.push("  None.");
  for (const [sport, legs] of discrepancyRows) {
    for (const leg of legs) {
      lines.push(`  ${sport} ${leg.label} · books ${leg.bookPoint} vs PrizePicks ${leg.line}`);
    }
  }
  lines.push("", "Grok findings:");
  const researched = Object.values(report.boards)
    .flat()
    .filter((leg) => leg.researchStatus !== "not_requested");
  if (!researched.length) lines.push("  None requested.");
  for (const leg of researched) {
    lines.push(`  ${leg.label}: ${leg.researchStatus}${leg.researchSummary ? ` · ${leg.researchSummary}` : ""}`);
  }
  lines.push("", "Rejected:");
  if (!report.rejections.length) lines.push("  None.");
  for (const row of report.rejections) lines.push(`  ${row.reason}: ${row.count}`);
  lines.push("", "Changes since the previous snapshot:");
  if (!report.changes.length) lines.push("  None, or this is the first snapshot.");
  for (const change of report.changes.slice(0, 12)) {
    if (change.kind === "added") lines.push(`  Added ${change.label} · ${change.marketProbability}%`);
    else if (change.kind === "removed") lines.push(`  Removed ${change.label}`);
    else if (change.kind === "line") lines.push(`  Line ${change.label}: ${change.from} → ${change.to}`);
    else lines.push(`  Probability ${change.label}: ${change.from}% → ${change.to}%`);
  }
  lines.push("", "Historical performance:");
  if (!report.historical || report.historical.sampleSize === 0) {
    lines.push("  No graded sample. Market probabilities are not a calibrated player model.");
  } else {
    lines.push(
      `  Graded ${report.historical.sampleSize}. Brier ${report.historical.brier}. ROI: unavailable.`
    );
    for (const [sport, row] of Object.entries(report.historical.bySport)) {
      lines.push(`  ${sport}: n=${row.sampleSize}, Brier ${row.brier}`);
    }
  }
  return lines.join("\n");
}

function formatLeg(leg: EvaluatedProp): string {
  if (leg.marketProbability == null) {
    return `${leg.label} (${leg.oddsType}) · books ${leg.bookPoint ?? "n/a"} vs PrizePicks ${leg.line} · not a hit probability`;
  }
  const source = leg.probabilitySource === "interpolated" ? "interpolated" : "direct";
  const range = leg.bookRange ? ` · books ${leg.bookRange.low}–${leg.bookRange.high}%` : "";
  const band = leg.interpolationUncertainty != null ? ` · interpolation ±${leg.interpolationUncertainty} pts` : "";
  const quote = leg.quotedAt ? ` · quote ${leg.quotedAt}` : "";
  return `${leg.label} (${leg.oddsType}) · hit ${leg.marketProbability}% · ${source} · ${leg.books} books${range}${band}${quote}`;
}

import path from "path";
import { fetchPrizePicksProjections } from "@/lib/prizepicks/client";
import { clusterEvents } from "./cluster";
import { processPackets } from "./gates";
import { researchEvents } from "./grok-research";
import { normalizeSlate } from "./ingest";
import {
  appendRejected,
  INTEL_DIR,
  readActiveSignals,
  readCredibility,
  readOutcomes,
  readResolvedSignals,
  writeActiveSignals,
  writeCredibility,
  writeOutcomes,
  writeResolvedSignals,
  writeRunReport,
} from "./persist";
import { reconcileSignals, signalDedupeKey } from "./reconcile";
import { formatTerminalSummary, renderIntelligenceMarkdown } from "./report-md";
import type { IntelligenceCliOptions, RunReport } from "./types";

function chicagoDateKey(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function logStep(message: string): void {
  console.error(`prizepicks-intelligence: ${message}`);
}

export async function runPrizePicksIntelligence(
  options: IntelligenceCliOptions = {},
  root = INTEL_DIR
): Promise<RunReport> {
  const runDate = options.date || chicagoDateKey();
  const stamp = new Date().toISOString().replace(/[:.]/g, "");
  const runId = `ppi_${stamp}`;
  const nowIso = new Date().toISOString();

  const board = options.projections
    ? { projections: options.projections, fetchedAt: nowIso }
    : await (async () => {
        logStep("pulling PrizePicks slate…");
        return fetchPrizePicksProjections({
          forceLive: true,
          disallowCacheFallback: true,
        });
      })();
  const markets = normalizeSlate(board.projections);
  const boardSports = Array.from(new Set(markets.map((market) => market.sport))).sort();
  logStep(`normalized ${markets.length} markets across ${boardSports.length} sports (raw ${board.projections.length})`);

  if (options.slateOnly) {
    const report: RunReport = {
      runId,
      runDate,
      generatedAt: nowIso,
      marketsAnalyzed: markets.length,
      sportsAnalyzed: boardSports,
      eventsResearched: 0,
      signals: [],
      contextSignals: [],
      watchlist: [],
      rejected: [],
      incomplete: [],
    };
    const markdown = renderIntelligenceMarkdown(report);
    const { mdPath } = writeRunReport(report, markdown, root);
    if (!options.quiet) {
      console.log(formatTerminalSummary(report, path.relative(process.cwd(), mdPath)));
    }
    return report;
  }

  const researchSports = (options.sports?.length ? options.sports : ["WNBA", "MLB"]).map((sport) =>
    sport.trim().toUpperCase()
  );
  const wantAll = researchSports.includes("ALL");
  const maxEvents = Math.min(40, Math.max(1, options.maxEvents ?? (wantAll ? 18 : 8)));
  const clusters = clusterEvents(markets, maxEvents, researchSports);
  const sportsAnalyzed = wantAll
    ? Array.from(new Set(clusters.map((cluster) => cluster.sport))).sort()
    : researchSports;
  const wnbaOnBoard = markets.filter((market) => market.sport.toUpperCase() === "WNBA").length;
  const mlbOnBoard = markets.filter(
    (market) => market.sport.toUpperCase() === "MLB" || market.sportFamily === "baseball"
  ).length;
  logStep(
    `horizon has ${wnbaOnBoard} WNBA and ${mlbOnBoard} MLB/baseball markets; researching ${clusters.length} games two at a time, 6 min each (${clusters.map((c) => `${c.sport} ${c.event}`).join("; ") || "none"}), retry once on timeout…`
  );

  const previous = readActiveSignals(root);
  const seenKeys = new Set(previous.map(signalDedupeKey));
  const research = options.noGrok
    ? { packets: [], rejected: [], incomplete: [], model: "none" }
    : options.grokResearch
      ? await options.grokResearch(clusters)
      : await researchEvents(clusters);

  const gated = processPackets({
    clusters,
    packets: research.packets,
    runId,
    seenKeys,
    nowMs: Date.now(),
  });
  const rejected = [...(research.rejected ?? []), ...gated.rejected];
  const incomplete = research.incomplete ?? [];
  if (incomplete.length) {
    logStep(`research incomplete on ${incomplete.length} games (${incomplete.map((row) => row.event).join("; ")}) — not treated as rejected`);
  }

  const reconciled = reconcileSignals({
    incoming: [...gated.signals, ...gated.contextSignals],
    previous,
    nowIso,
  });
  const incomingKeys = new Set(reconciled.active.map(signalDedupeKey));
  const primary = reconciled.active.filter((signal) =>
    gated.signals.some((row) => signalDedupeKey(row) === signalDedupeKey(signal))
  );
  const context = reconciled.active.filter((signal) =>
    gated.contextSignals.some((row) => signalDedupeKey(row) === signalDedupeKey(signal))
  );

  const resolved = [...readResolvedSignals(root), ...reconciled.resolved];
  writeActiveSignals(reconciled.active, root);
  writeResolvedSignals(resolved, root);
  appendRejected(rejected, root);
  writeOutcomes([...readOutcomes(root), ...reconciled.pendingOutcomes], root);
  writeCredibility(
    {
      ...readCredibility(root),
      ...Object.fromEntries(
        [...primary, ...context].flatMap((signal) =>
          signal.sources.map((source) => [source.outlet.toLowerCase(), source.credibility] as const)
        )
      ),
    },
    root
  );

  const report: RunReport = {
    runId,
    runDate,
    generatedAt: nowIso,
    marketsAnalyzed: markets.length,
    sportsAnalyzed,
    eventsResearched: clusters.length,
    model: research.model,
    signals: primary,
    contextSignals: context,
    watchlist: gated.watchlist,
    rejected,
    incomplete,
  };
  const markdown = renderIntelligenceMarkdown(report);
  const { mdPath } = writeRunReport(report, markdown, root);
  logStep(`wrote ${path.relative(process.cwd(), mdPath)}`);
  if (!options.quiet) {
    console.log(formatTerminalSummary(report, path.relative(process.cwd(), mdPath)));
  }
  void incomingKeys;
  return report;
}

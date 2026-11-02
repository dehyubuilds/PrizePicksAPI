import path from "path";
import { scanProjectionsForEdges } from "@/lib/edge-finder/categorize";
import { inferSportTagsFromProjections } from "@/lib/edge-finder/infer-sport";
import { fetchKalshiMarketsForEdgeScan } from "@/lib/edge-finder/kalshi-markets";
import { enrichScanResultWithPolymarket } from "@/lib/edge-finder/polymarket-enrich";
import type { EdgeScanPick, EdgeScanResult } from "@/lib/edge-finder/types";
import { INTEL_DIR } from "@/lib/prizepicks-intelligence/persist";
import { runPrizePicksIntelligence } from "@/lib/prizepicks-intelligence/run";
import { fetchPrizePicksProjections } from "@/lib/prizepicks/client";
import {
  formatPicksTerminal,
  mergeIntelAndVenue,
  opportunitiesFromSignals,
} from "./from-intelligence";
import {
  diffPicksSnapshots,
  readLastPicksSnapshot,
  snapshotFromOpportunities,
  writeLastEdgeReport,
  writeLastPicksSnapshot,
} from "./history";
import { grokConfigured, researchEdgeCandidatesWithGrok } from "./grok";
import { publishPrizePicksEdgePage } from "./publish-page";
import { mergeGrokOpportunities, opportunitiesFromMechanical } from "./rank";
import { nextScheduledRun } from "./schedule";
import { filterProjectionsBySports, researchFallbackSlate, selectMorningBoard } from "./shortlist";
import type { EdgeOpportunity, PrizePicksEdgeCliOptions, PrizePicksEdgeReport } from "./types";

function logStep(message: string): void {
  console.error(`prizepicks-picks: ${message}`);
}

function emptyScan(): EdgeScanResult {
  return {
    summary: {
      scannedAt: new Date().toISOString(),
      projectionCount: 0,
      kalshiMarketCount: 0,
      polymarketMarketCount: 0,
      matchedCount: 0,
      prizepicksFromCache: false,
      sports: [],
    },
    picks: [],
    freePick: null,
    premiumPicks: [],
    demonWatchlist: [],
    avoidList: [],
  };
}

export async function runPrizePicksEdgeCli(options: PrizePicksEdgeCliOptions = {}): Promise<void> {
  const count = Math.min(25, Math.max(3, options.count ?? 12));
  const sports = (options.sports?.length ? options.sports : ["WNBA", "MLB"]).map((sport) =>
    sport.trim().toUpperCase()
  );
  const wantAll = sports.includes("ALL");

  logStep("pulling PrizePicks board…");
  const board = await fetchPrizePicksProjections({
    forceLive: true,
    disallowCacheFallback: false,
  });
  const scoped = filterProjectionsBySports(board.projections, sports);
  const morning = selectMorningBoard(scoped.length ? scoped : board.projections);
  logStep(
    `board ${board.projections.length} props · ${wantAll ? "all sports" : sports.join("/")} ${scoped.length} · playable ${morning.playableCount} · scanning ${morning.selected.length}`
  );

  if (options.slateOnly) {
    console.log(
      JSON.stringify(
        {
          fetchedAt: board.fetchedAt,
          boardCount: board.projections.length,
          sports,
          scannedCount: morning.selected.length,
          sample: morning.selected.slice(0, 12).map((p) => ({
            player: p.playerName,
            line: p.lineScore,
            stat: p.statDisplayName,
            oddsType: p.oddsType,
            league: p.leagueName,
            startTime: p.startTime,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  let intelOpps: EdgeOpportunity[] = [];
  let rejectedCount = 0;
  let incompleteCount = 0;
  let incompleteEvents: string[] = [];
  let researchPath: string | undefined;
  if (!options.noIntel) {
    logStep(`researching ${wantAll ? "all-sport" : sports.join("/")} news for stale lines…`);
    const intel = await runPrizePicksIntelligence({
      sports,
      projections: board.projections,
      quiet: true,
      noGrok: options.noGrok,
      maxEvents: options.maxEvents,
    });
    intelOpps = opportunitiesFromSignals({
      signals: intel.signals,
      projections: board.projections,
    });
    rejectedCount = intel.rejected.length;
    incompleteCount = intel.incomplete.length;
    incompleteEvents = intel.incomplete.map((row) => row.event);
    researchPath = path.relative(process.cwd(), path.join(INTEL_DIR, "reports", `${intel.runDate}.md`));
    logStep(
      incompleteCount
        ? `news: ${intelOpps.length} pickable · ${intel.signals.length} signals · ${incompleteCount} games incomplete (not rejected)`
        : `news: ${intelOpps.length} pickable · ${intel.signals.length} signals · ${rejectedCount} rejected`
    );
  }

  if (!morning.selected.length && !intelOpps.length) {
    throw new Error(`No playable ${wantAll ? "" : `${sports.join("/")} `}PrizePicks props on the board.`);
  }

  let scan = emptyScan();
  let shortlist: EdgeScanPick[] = [];
  if (morning.selected.length) {
    const sportTags = inferSportTagsFromProjections(morning.selected);
    logStep(`pulling Kalshi player-prop markets (${sportTags.join(", ") || "all sports"})…`);
    const kalshiMarkets = await fetchKalshiMarketsForEdgeScan(sportTags);
    logStep(`Kalshi ${kalshiMarkets.length} markets · matching…`);

    scan = scanProjectionsForEdges({
      projections: morning.selected,
      markets: kalshiMarkets,
      prizepicksFromCache: board.fromCache === true,
    });

    logStep("cross-checking Polymarket…");
    scan = await enrichScanResultWithPolymarket(scan);
    shortlist = researchFallbackSlate(scan);
    logStep(`shortlist ${shortlist.length} (venue edge + research slate)`);
  }

  let venue: EdgeOpportunity[] = shortlist.length
    ? opportunitiesFromMechanical(shortlist, count)
    : [];

  const runGrokRank =
    !options.noGrok && grokConfigured() && shortlist.length > 0 && intelOpps.length === 0;
  if (runGrokRank) {
    logStep(`asking Grok to rank ${count} venue plays…`);
    try {
      const grok = await researchEdgeCandidatesWithGrok({
        candidates: shortlist,
        pickCount: count,
      });
      venue = mergeGrokOpportunities({
        candidates: shortlist,
        grok: grok.picks,
        count,
      });
      logStep(`Grok kept ${venue.length}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logStep(`Grok rank skipped (${message}). Using Kalshi/Poly ranking.`);
    }
  } else if (!options.noGrok && !grokConfigured()) {
    logStep("no Grok key — ranking on Kalshi/Poly only");
  } else if (intelOpps.length) {
    logStep("using news-backed picks; Kalshi/Poly fills the rest");
  }

  const opportunities = mergeIntelAndVenue({ intel: intelOpps, venue, count });
  const snapshot = snapshotFromOpportunities(opportunities);
  const delta = diffPicksSnapshots(readLastPicksSnapshot(), snapshot);
  writeLastPicksSnapshot(snapshot);
  const report: PrizePicksEdgeReport = {
    generatedAt: new Date().toISOString(),
    model: intelOpps.length ? "intelligence+venues" : runGrokRank ? "grok+venues" : "mechanical",
    summary: intelOpps.length
      ? `${intelOpps.length} news-backed PrizePicks from overnight research.`
      : incompleteCount
        ? `News research did not finish on ${incompleteCount} games — not a no-news verdict. Ranked remaining board vs Kalshi/Polymarket.`
        : "No new role/usage news — ranked PrizePicks vs Kalshi/Polymarket.",
    boardCount: board.projections.length,
    scannedCount: morning.selected.length,
    kalshiMarketCount: scan.summary.kalshiMarketCount,
    polymarketMarketCount: scan.summary.polymarketMarketCount ?? 0,
    shortlistCount: shortlist.length,
    intelCount: intelOpps.length,
    rejectedCount,
    incompleteCount,
    incompleteEvents,
    opportunities,
    scan,
    delta,
    nextBotRunAt: nextScheduledRun().toISOString(),
  };
  writeLastEdgeReport(report);

  let pageUrl: string | undefined;
  if (!options.noPublish) {
    logStep("publishing S3 page…");
    const published = await publishPrizePicksEdgePage(report);
    pageUrl = published.cdnUrl;
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          generatedAt: report.generatedAt,
          model: report.model,
          summary: report.summary,
          sports,
          boardCount: report.boardCount,
          scannedCount: report.scannedCount,
          kalshiMarketCount: report.kalshiMarketCount,
          polymarketMarketCount: report.polymarketMarketCount,
          intelPicks: intelOpps.length,
          rejectedCount,
          incompleteCount,
          incompleteEvents,
          delta,
          opportunities: report.opportunities.map((row) => ({
            rank: row.rank,
            priority: row.priority,
            pickLine: row.pick.pickLine,
            explanation: row.explanation,
            xSignal: row.xSignal,
            edgePercent: row.pick.edgePercent,
            sources: row.sources,
          })),
          researchPath,
          pageUrl,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(
    formatPicksTerminal({
      opportunities,
      sports: wantAll ? ["ALL"] : sports,
      intelCount: intelOpps.length,
      rejectedCount,
      incompleteCount,
      incompleteEvents,
      pageUrl,
      researchPath,
      delta,
    })
  );
}

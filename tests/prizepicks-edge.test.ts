import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { EdgeScanPick, EdgeScanResult } from "../src/lib/edge-finder/types";
import type { PrizePicksProjection } from "../src/lib/prizepicks/types";
import {
  isActionableSignal,
  mergeIntelAndVenue,
  opportunitiesFromSignals,
} from "../src/lib/prizepicks-edge/from-intelligence";
import { diffPicksSnapshots, snapshotFromOpportunities } from "../src/lib/prizepicks-edge/history";
import { chicagoWallClockToDate, nextScheduledRun, picksScheduleCopy } from "../src/lib/prizepicks-edge/schedule";
import { mergeGrokOpportunities, opportunitiesFromMechanical } from "../src/lib/prizepicks-edge/rank";
import { renderEdgeReportHtml } from "../src/lib/prizepicks-edge/publish-page";
import {
  filterProjectionsBySports,
  mechanicalPriority,
  researchFallbackSlate,
  selectMorningBoard,
  shortlistOpportunities,
} from "../src/lib/prizepicks-edge/shortlist";
import type { PrizePicksEdgeReport } from "../src/lib/prizepicks-edge/types";
import type { IntelligenceSignal } from "../src/lib/prizepicks-intelligence/types";

function projection(partial: Partial<PrizePicksProjection> & Pick<PrizePicksProjection, "id" | "playerName">): PrizePicksProjection {
  const start = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  return {
    team: "LAD",
    opponent: "SD",
    leagueId: "2",
    leagueName: "MLB",
    statDisplayName: "Hits",
    statType: "hits",
    lineScore: 1.5,
    oddsType: "standard",
    startTime: start,
    gameId: "g1",
    status: "pre_game",
    ...partial,
  };
}

function pick(partial: Partial<EdgeScanPick> & Pick<EdgeScanPick, "id" | "playerName">): EdgeScanPick {
  const proj = projection({
    id: partial.prizepicksProjectionId ?? partial.id.split(":")[0] ?? "p1",
    playerName: partial.playerName,
  });
  return {
    prizepicksProjectionId: proj.id,
    sport: "MLB",
    team: "LAD",
    opponent: "SD",
    statDisplayName: "Hits",
    statType: "hits",
    lineScore: 1.5,
    side: "over",
    oddsType: "standard",
    startTime: proj.startTime,
    pickLine: `${partial.playerName} Over 1.5 Hits`,
    prizepicksImpliedProb: 50,
    kalshiImpliedProb: 62,
    adjustedProb: 60,
    edgePercent: 10,
    confidenceScore: 70,
    confidenceLabel: "medium",
    category: "premium",
    reasoning: "Kalshi prices this side higher than PrizePicks.",
    kalshi: {
      ticker: "KXMLB-TEST",
      marketTitle: "Player hits",
      pickedSide: "yes",
      matchScore: 80,
      market: {
        ticker: "KXMLB-TEST",
        eventTicker: "KXMLBGAME-TEST",
        title: "Player hits",
        yesSubTitle: "Yes",
        noSubTitle: "No",
        yesBidDollars: "0.62",
        yesAskDollars: "0.64",
        volumeFp: "100",
        closeTime: proj.startTime,
        rulesPrimary: "",
        sportTags: ["MLB"],
      },
    },
    projection: proj,
    ...partial,
  };
}

function emptyScan(picks: EdgeScanPick[]): EdgeScanResult {
  return {
    summary: {
      scannedAt: new Date().toISOString(),
      projectionCount: picks.length,
      kalshiMarketCount: 1,
      matchedCount: picks.length,
      prizepicksFromCache: false,
      sports: ["MLB"],
    },
    picks,
    freePick: picks[0] ?? null,
    premiumPicks: picks.slice(1, 3),
    demonWatchlist: picks.filter((row) => row.oddsType === "demon"),
    avoidList: [],
  };
}

describe("selectMorningBoard", () => {
  it("keeps one standard and one demon per player-stat slot", () => {
    const board = selectMorningBoard([
      projection({ id: "s", playerName: "Mookie Betts", oddsType: "standard", lineScore: 1.5 }),
      projection({ id: "d", playerName: "Mookie Betts", oddsType: "demon", lineScore: 2.5 }),
      projection({ id: "g", playerName: "Mookie Betts", oddsType: "goblin", lineScore: 0.5 }),
      projection({ id: "esport", playerName: "Swisher", leagueName: "League 265", leagueId: "265", oddsType: "demon" }),
    ]);
    assert.equal(board.selected.length, 3);
    assert.deepEqual(
      board.selected.map((row) => row.oddsType).sort(),
      ["demon", "goblin", "standard"]
    );
  });
});

describe("shortlist and priority", () => {
  it("drops weak unmatched avoids and keeps venue-backed edge", () => {
    const good = pick({ id: "good:over", playerName: "Shohei Ohtani", edgePercent: 8 });
    const avoid = pick({
      id: "bad:over",
      playerName: "Nobody",
      category: "avoid",
      edgePercent: -6,
      kalshi: null,
      kalshiImpliedProb: null,
    });
    const list = shortlistOpportunities(emptyScan([good, avoid]));
    assert.equal(list.some((row) => row.id === "good:over"), true);
    assert.equal(list.some((row) => row.id === "bad:over"), false);
    assert.equal(mechanicalPriority(good), "now");
  });

  it("falls back to a diverse research slate when venue matches are empty", () => {
    const unmatched = [
      pick({
        id: "u1:over",
        playerName: "Player One",
        category: "avoid",
        edgePercent: null,
        kalshi: null,
        kalshiImpliedProb: null,
        oddsType: "demon",
      }),
      pick({
        id: "u2:over",
        playerName: "Player Two",
        category: "avoid",
        edgePercent: null,
        kalshi: null,
        kalshiImpliedProb: null,
        oddsType: "standard",
      }),
    ];
    const slate = researchFallbackSlate(emptyScan(unmatched), 12);
    assert.equal(slate.length, 2);
    assert.equal(slate[0]?.playerName, "Player One");
  });
});

describe("merge Grok", () => {
  it("keeps Grok now/watch, drops vetoes, fills remaining mechanical watches", () => {
    const a = pick({ id: "a:over", prizepicksProjectionId: "a", playerName: "A", edgePercent: 9 });
    const b = pick({ id: "b:over", prizepicksProjectionId: "b", playerName: "B", edgePercent: 7 });
    const c = pick({ id: "c:over", prizepicksProjectionId: "c", playerName: "C", edgePercent: 6 });
    const merged = mergeGrokOpportunities({
      candidates: [a, b, c],
      grok: [
        {
          projectionId: "a",
          side: "over",
          rank: 1,
          priority: "now",
          confidence: 81,
          explanation: "Lineup locked and Kalshi still rich.",
          veto: false,
        },
        {
          projectionId: "b",
          side: "over",
          rank: 2,
          priority: "pass",
          confidence: 20,
          explanation: "Scratched.",
          veto: true,
          vetoReason: "Scratched",
        },
      ],
      count: 3,
    });
    assert.equal(merged[0]?.priority, "now");
    assert.equal(merged[0]?.pick.playerName, "A");
    assert.equal(merged.some((row) => row.pick.playerName === "B"), false);
    assert.equal(merged.some((row) => row.pick.playerName === "C"), true);
    assert.match(merged[0]?.explanation ?? "", /Lineup locked/);
  });

  it("mechanical ranking puts NOW ahead of WATCH", () => {
    const now = pick({ id: "n:over", playerName: "Now", edgePercent: 8 });
    const watch = pick({
      id: "w:over",
      playerName: "Watch",
      edgePercent: 3,
      kalshi: {
        ticker: "KX",
        marketTitle: "x",
        pickedSide: "yes",
        matchScore: 55,
        market: now.kalshi!.market,
      },
    });
    const rows = opportunitiesFromMechanical([watch, now], 5);
    assert.equal(rows[0]?.priority, "now");
    assert.equal(rows[0]?.pick.playerName, "Now");
  });
});

describe("edge report html", () => {
  it("renders priority, explanation, and prizepicks link", () => {
    const opp = opportunitiesFromMechanical(
      [pick({ id: "html:over", prizepicksProjectionId: "html", playerName: "Freddie Freeman", edgePercent: 8 })],
      1
    );
    const report: PrizePicksEdgeReport = {
      generatedAt: new Date().toISOString(),
      model: "grok-4.7",
      summary: "Morning MLB edges look concentrated in the Dodgers lineup.",
      boardCount: 10,
      scannedCount: 4,
      kalshiMarketCount: 2,
      polymarketMarketCount: 1,
      shortlistCount: 1,
      opportunities: opp,
      scan: emptyScan(opp.map((row) => row.pick)),
    };
    const html = renderEdgeReportHtml({
      report,
      generatedAtLabel: "Sun, Sep 27, 2:00 PM",
      canonicalUrl: "https://dropflow.us/picks/edge",
      ogImageUrl: "https://cdn.example/card.jpg",
    });
    assert.match(html, /Freddie Freeman/);
    assert.match(html, /TAKE/);
    assert.match(html, /Enter this/);
    assert.match(html, /WATCH/);
    assert.match(html, /Don’t monitor these|Don’t watch the game|SINCE LAST RUN/);
    assert.match(html, /Kalshi prices this side/);
    assert.match(html, /Bot runs/);
    assert.match(html, /8:30 AM CT/);
    assert.match(html, /12:30 PM CT/);
    assert.match(html, /4:30 PM CT/);
    assert.match(html, /9:00 AM/);
    assert.match(html, /1:00 PM/);
    assert.match(html, /5:00 PM/);
    assert.match(html, /Open this prop/);
    assert.match(html, /app\.prizepicks\.com\/board\?/);
    assert.doesNotMatch(html, /Copy ticket|Copy all picks/);
    assert.match(html, /This run/);
    assert.match(html, /1 TAKE · 0 WATCH/);
  });

  it("always shows this-run outcome when there are no picks", () => {
    const report: PrizePicksEdgeReport = {
      generatedAt: new Date().toISOString(),
      model: "mechanical",
      summary: "No new role/usage news — ranked PrizePicks vs Kalshi/Polymarket.",
      boardCount: 10261,
      scannedCount: 291,
      kalshiMarketCount: 200,
      polymarketMarketCount: 0,
      shortlistCount: 23,
      intelCount: 0,
      rejectedCount: 0,
      incompleteCount: 6,
      incompleteEvents: ["Philadelphia vs ATL", "Chicago vs HOU"],
      opportunities: [],
      scan: emptyScan([]),
    };
    const html = renderEdgeReportHtml({
      report,
      generatedAtLabel: "Mon, Sep 28, 9:13 AM",
      canonicalUrl: "https://dropflow.us/picks/edge",
      ogImageUrl: "https://cdn.example/card.jpg",
    });
    assert.match(html, /This run/);
    assert.match(html, /0 TAKE · 0 WATCH/);
    assert.match(html, /6 games research incomplete/);
    assert.match(html, /never judged/);
    assert.match(html, /291 props scanned/);
    assert.match(html, /<p class="empty">None\.<\/p>/);
  });
});

function intelSignal(partial: Partial<IntelligenceSignal> & Pick<IntelligenceSignal, "player" | "statType">): IntelligenceSignal {
  return {
    signalId: "sig_test",
    marketId: "mlb-1",
    sport: "MLB",
    event: "NYY vs BOS",
    team: "NYY",
    opponent: "BOS",
    projection: 1.5,
    direction: "UP",
    signalType: "LINEUP",
    whyNow: "Confirmed to lead off after a late lineup change.",
    causalChain: ["Lineup posted", "Leadoff role"],
    evidenceConfidence: "HIGH",
    marketAwareness: "NEWLY_EMERGED",
    freshnessMinutes: 20,
    whatChanged: "Moved to leadoff",
    whyItMatters: "More plate appearances",
    bullCase: "Extra PA",
    bearCase: "Pitcher matchup",
    alreadyPricedArgument: "Line may not have moved yet",
    missingEvidence: "Official card",
    invalidationCondition: "Batted down",
    verdict: "UNDER_REFLECTED_CHANGE",
    sources: [],
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    isNew: true,
    ...partial,
  };
}

describe("intelligence to picks", () => {
  it("turns a newly emerged UP signal into an Over TAKE pick", () => {
    const proj = projection({ id: "mlb-1", playerName: "Aaron Judge", leagueName: "MLB" });
    const rows = opportunitiesFromSignals({
      signals: [intelSignal({ player: "Aaron Judge", statType: "Hits", marketId: "mlb-1" })],
      projections: [proj],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.priority, "now");
    assert.equal(rows[0]?.pick.side, "over");
    assert.match(rows[0]?.pick.pickLine ?? "", /Aaron Judge Over 1\.5 Hits/);
  });

  it("skips already-known and unclear signals", () => {
    const proj = projection({ id: "mlb-1", playerName: "Aaron Judge" });
    assert.equal(
      isActionableSignal(
        intelSignal({
          player: "Aaron Judge",
          statType: "Hits",
          marketAwareness: "BROADLY_KNOWN",
          verdict: "LIKELY_ALREADY_REFLECTED",
        })
      ),
      false
    );
    const rows = opportunitiesFromSignals({
      signals: [
        intelSignal({
          player: "Aaron Judge",
          statType: "Hits",
          direction: "UNCLEAR",
          marketAwareness: "NEWLY_EMERGED",
        }),
      ],
      projections: [proj],
    });
    assert.equal(rows.length, 0);
  });

  it("puts news TAKE picks ahead of Kalshi ranking", () => {
    const proj = projection({ id: "mlb-1", playerName: "Aaron Judge" });
    const intel = opportunitiesFromSignals({
      signals: [intelSignal({ player: "Aaron Judge", statType: "Hits", marketId: "mlb-1" })],
      projections: [proj],
    });
    const venue = opportunitiesFromMechanical(
      [pick({ id: "venue:over", playerName: "Venue Star", edgePercent: 12 })],
      5
    );
    const merged = mergeIntelAndVenue({ intel, venue, count: 5 });
    assert.equal(merged[0]?.pick.playerName, "Aaron Judge");
    assert.equal(merged[1]?.pick.playerName, "Venue Star");
  });

  it("can limit the morning board to WNBA and MLB", () => {
    const rows = filterProjectionsBySports(
      [
        projection({ id: "mlb", playerName: "Judge", leagueName: "MLB", leagueId: "2" }),
        projection({
          id: "wnba",
          playerName: "Wilson",
          leagueName: "WNBA",
          leagueId: "3",
          statDisplayName: "Points",
          statType: "points",
        }),
        projection({
          id: "nfl",
          playerName: "QB",
          leagueName: "NFL",
          leagueId: "9",
          statDisplayName: "Pass Yards",
          statType: "pass yards",
        }),
      ],
      ["WNBA", "MLB"]
    );
    assert.deepEqual(rows.map((row) => row.leagueName).sort(), ["MLB", "WNBA"]);
  });
});

describe("pick history", () => {
  it("promotes a WATCH to TAKE and drops vanished picks", () => {
    const watch = opportunitiesFromMechanical(
      [pick({ id: "g:over", prizepicksProjectionId: "g", playerName: "Allisha Gray", edgePercent: 3 })],
      1
    ).map((row) => ({ ...row, priority: "watch" as const }));
    const take = opportunitiesFromMechanical(
      [pick({ id: "g:over", prizepicksProjectionId: "g", playerName: "Allisha Gray", edgePercent: 8 })],
      1
    );
    const gone = opportunitiesFromMechanical(
      [pick({ id: "r:over", prizepicksProjectionId: "r", playerName: "Angel Reese", edgePercent: 4 })],
      1
    ).map((row) => ({ ...row, priority: "watch" as const }));
    const previous = snapshotFromOpportunities([...watch, ...gone], "2026-09-27T16:00:00.000Z");
    const current = snapshotFromOpportunities(take, "2026-09-27T20:00:00.000Z");
    const delta = diffPicksSnapshots(previous, current);
    assert.equal(delta.firstRun, false);
    assert.equal(delta.promoted[0]?.pickLine.includes("Allisha Gray"), true);
    assert.equal(delta.dropped[0]?.pickLine.includes("Angel Reese"), true);
  });

  it("says first run when there is no prior board", () => {
    const delta = diffPicksSnapshots(null, snapshotFromOpportunities([]));
    assert.equal(delta.firstRun, true);
  });
});

describe("bot schedule", () => {
  it("starts 8:30 / 12:30 / 4:30 CT so the board is ready at 9 / 1 / 5", () => {
    assert.match(picksScheduleCopy(), /8:30 AM, 12:30 PM, and 4:30 PM CT/);
    const afterTen = nextScheduledRun(chicagoWallClockToDate(2026, 9, 27, 10, 5));
    assert.equal(afterTen.toISOString(), chicagoWallClockToDate(2026, 9, 27, 12, 30).toISOString());
    const afterEvening = nextScheduledRun(chicagoWallClockToDate(2026, 9, 27, 16, 31));
    assert.equal(afterEvening.toISOString(), chicagoWallClockToDate(2026, 9, 28, 8, 30).toISOString());
  });
});

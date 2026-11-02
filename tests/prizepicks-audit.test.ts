import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import type { PrizePicksProjection } from "../src/lib/prizepicks/types";
import { classifyComparison } from "../src/lib/prizepicks-audit/compare";
import { buildCoverage } from "../src/lib/prizepicks-audit/coverage";
import { buildInventory } from "../src/lib/prizepicks-audit/inventory";
import { settleWithoutHindsight, summarizeObservations } from "../src/lib/prizepicks-audit/longitudinal";
import { probeMarkets } from "../src/lib/prizepicks-audit/probe";
import { renderAuditMarkdown } from "../src/lib/prizepicks-audit/report";
import { parseAuditArgs, runPrizePicksAudit } from "../src/lib/prizepicks-audit/run";
import { scoreCategory } from "../src/lib/prizepicks-audit/scorecard";
import { sourcesFromGrok } from "../src/lib/prizepicks-audit/sources";
import { parseScope, scopesComparable } from "../src/lib/prizepicks-audit/taxonomy";
import type { InefficiencyObservation } from "../src/lib/prizepicks-audit/types";

const now = "2026-10-11T18:00:00.000Z";
const start = "2026-10-11T23:00:00.000Z";

function projection(partial: Partial<PrizePicksProjection> & Pick<PrizePicksProjection, "playerName" | "statDisplayName" | "leagueId">): PrizePicksProjection {
  return {
    id: partial.id ?? partial.playerName,
    team: "Alpha",
    opponent: "Beta",
    leagueName: "League",
    statType: partial.statDisplayName,
    lineScore: 1.5,
    oddsType: "standard",
    startTime: start,
    gameId: "g1",
    status: "pre_game",
    ...partial,
  };
}

function observation(partial: Partial<InefficiencyObservation> = {}): InefficiencyObservation {
  return {
    observedAt: now,
    categoryId: "9",
    displayName: "NFL",
    propFamily: "Receptions",
    scopeLabel: "full game",
    eventId: "g1",
    player: "A",
    prizePicksLine: 6.5,
    oddsType: "standard",
    sportsbookLine: 5.5,
    sportsbookPrices: null,
    bookmakerCount: 4,
    quoteTimestamp: now,
    comparisonMethod: "threshold_only",
    comparison: "VERIFIED_MARKET_DISCREPANCY",
    rejectionReason: null,
    discrepancyPoints: 1,
    direction: "higher_line",
    independentEventKey: "9:g1",
    ...partial,
  };
}

describe("prizepicks audit", () => {
  it("keeps an unknown category and does not invent its sport", () => {
    const inventory = buildInventory(
      [
        projection({ playerName: "New Player", statDisplayName: "TNC", leagueId: "999", lineScore: 2 }),
        projection({ playerName: "Receiver", statDisplayName: "Receptions", leagueId: "9", leagueName: "NFL" }),
      ],
      [],
      now
    );
    const unknown = inventory.find((category) => category.categoryId === "999");
    assert.ok(unknown);
    assert.equal(unknown?.displayName, "League 999");
    assert.equal(unknown?.nameResolution, "unresolved");
    assert.equal(unknown?.sportOrGame, null);
    assert.equal(unknown?.propFamilies[0]?.abbreviationUnexpanded, true);
    assert.equal(unknown?.propFamilies[0]?.normalizedFamily, "TNC");
  });

  it("separates map scope from a full match and periods from full game", () => {
    const maps = parseScope("MAPS 1-2 Kills");
    const one = parseScope("MAP 1 Kills");
    const quarter = parseScope("1st Quarter Points");
    assert.equal(maps.scope.kind, "maps");
    assert.equal(one.scope.kind, "map");
    assert.equal(scopesComparable(maps.scope, one.scope), false);
    assert.equal(scopesComparable(maps.scope, { kind: "match", label: "full game" }), false);
    assert.equal(quarter.scope.kind, "quarter");
    assert.equal(scopesComparable(quarter.scope, { kind: "match", label: "full game" }), false);
    const coverage = buildCoverage(
      buildInventory([projection({ playerName: "Receiver", statDisplayName: "1st Quarter Receptions", leagueId: "9" })], [], now),
      [{ key: "americanfootball_nfl", title: "NFL" }],
      new Map()
    );
    assert.equal(coverage[0]?.families[0]?.coverage, "RELATED_MARKET_ONLY");
  });

  it("uses a provider name and classifies coverage without dropping promo lines from the inventory", () => {
    const inventory = buildInventory(
      [
        projection({ playerName: "Striker", statDisplayName: "Shots", leagueId: "14", oddsType: "demon" }),
        projection({ playerName: "Striker", statDisplayName: "Shots", leagueId: "14", id: "s2" }),
      ],
      [{ id: "14", name: "Premier League", providerSport: "soccer", projectionsCount: 2, active: true }],
      now
    );
    assert.equal(inventory[0]?.displayName, "Premier League");
    assert.equal(inventory[0]?.nameResolution, "provider");
    assert.equal(inventory[0]?.promotionalPropCount, 1);
    assert.equal(inventory[0]?.standardPropCount, 1);
    const named = buildCoverage(
      buildInventory([projection({ playerName: "Receiver", statDisplayName: "Receptions", leagueId: "9" })], [], now),
      [{ key: "americanfootball_nfl", title: "NFL" }],
      new Map([["9", ["player_receptions"]]])
    );
    assert.equal(named[0]?.families[0]?.coverage, "EXACT_COMPARABLE_MARKET");
  });

  it("rejects promotional, cross-scope, and unpriced integer comparisons", () => {
    assert.equal(classifyComparison({ promotional: true, scopesMatch: true, line: 1.5, bookLine: 1.5, books: 4, bookRangePoints: 1, quotesFound: true, integerLine: false, integerPushKnown: false }).comparison, "INVALID_COMPARISON");
    assert.equal(classifyComparison({ promotional: false, scopesMatch: false, line: 1.5, bookLine: 1.5, books: 4, bookRangePoints: 1, quotesFound: true, integerLine: false, integerPushKnown: false }).comparison, "INVALID_COMPARISON");
    assert.equal(classifyComparison({ promotional: false, scopesMatch: true, line: 2, bookLine: 2, books: 4, bookRangePoints: 1, quotesFound: true, integerLine: true, integerPushKnown: false }).comparison, "INSUFFICIENT_COMPARABLE_DATA");
    assert.equal(classifyComparison({ promotional: false, scopesMatch: true, line: 6.5, bookLine: 5.5, books: 4, bookRangePoints: 2, quotesFound: true, integerLine: false, integerPushKnown: false }).comparison, "VERIFIED_MARKET_DISCREPANCY");
    assert.equal(classifyComparison({ promotional: false, scopesMatch: true, line: 6.5, bookLine: 6.5, books: 4, bookRangePoints: 2, quotesFound: true, integerLine: false, integerPushKnown: false }).comparison, "MARKET_ALREADY_ADJUSTED");
  });

  it("does not treat one match or one day as a repeated inefficiency", () => {
    const sameGame = [observation(), observation({ player: "B", independentEventKey: "9:g1" })];
    const once = summarizeObservations(sameGame);
    assert.equal(once.independentEvents, 1);
    assert.equal(once.eventDiscrepancyRate, "UNKNOWN");
    const settled = settleWithoutHindsight(observation(), null);
    assert.equal(settled.status, "missing");
    assert.equal(settleWithoutHindsight(observation(), { availableAt: "2026-10-11T17:00:00.000Z", actual: 7 }).status, "hindsight");
    assert.equal(settleWithoutHindsight(observation(), { availableAt: "2026-10-12T02:00:00.000Z", actual: 7 }).status, "settled");
    const inventory = buildInventory([projection({ playerName: "Receiver", statDisplayName: "Receptions", leagueId: "9" })], [], now);
    const card = scoreCategory({
      category: inventory[0]!,
      sources: [],
      coverage: undefined,
      observations: sameGame,
      creditsForCategory: null,
    });
    assert.equal(card.claimsRepeatableInefficiency, false);
    assert.equal(card.dimensions.discrepancyPersistence.score, "UNKNOWN");
    assert.equal(card.dimensions.historicalDepth.score, "UNKNOWN");
    assert.equal(card.dimensions.modelingFeasibility.score, "UNKNOWN");
  });

  it("keeps Grok sources untested and does not invent a price", () => {
    const sources = sourcesFromGrok(
      { sources: [{ provider: "Example Feed", url: "https://example.com", categories: ["NFL"], access: "paid", price: null, statCoverage: "plays" }] },
      new Map([["nfl", "9"]])
    );
    assert.equal(sources[0]?.status, "REQUIRES_SUBSCRIPTION");
    assert.equal(sources[0]?.tested, false);
    assert.equal(sources[0]?.price, null);
    assert.equal(sources[0]?.commercialUse, "unknown");
  });

  it("stops sportsbook probes when the credit budget is already spent", async () => {
    let calls = 0;
    const inventory = buildInventory([projection({ playerName: "Receiver", statDisplayName: "Receptions", leagueId: "9" })], [], now);
    const result = await probeMarkets({
      categories: inventory,
      projections: [projection({ playerName: "Receiver", statDisplayName: "Receptions", leagueId: "9" })],
      sportsListed: new Map([["9", "americanfootball_nfl"]]),
      fetchOdds: async () => {
        calls += 1;
        return { json: [], remaining: 0, used: 0, lastCost: 1, fromCache: false };
      },
      nowIso: now,
      maxCredits: 0,
      maxCategories: 5,
    });
    assert.equal(calls, 0);
    assert.equal(result.credits, 0);
  });

  it("parses the CLI, writes a report, and does not wager or publish", async () => {
    assert.equal(parseAuditArgs(["--mode", "inventory"]).mode, "inventory");
    assert.equal(parseAuditArgs([]).mode, "inventory");
    assert.throws(() => parseAuditArgs(["--mode", "picks"]), /Unknown mode/);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pp-audit-"));
    const report = await runPrizePicksAudit(
      { mode: "inventory", dryRun: false, estimate: true },
      {
        now: new Date(now),
        write: false,
        root,
        projections: [projection({ playerName: "Receiver", statDisplayName: "Receptions", leagueId: "9" }), projection({ playerName: "Mystery", statDisplayName: "ZZ", leagueId: "4242" })],
        catalog: [],
        sports: [{ key: "americanfootball_nfl", title: "NFL" }],
        research: async () => {
          throw new Error("paid research should not run");
        },
        fetchOdds: async () => {
          throw new Error("paid odds should not run");
        },
      }
    );
    assert.equal(report.placesWagers, false);
    assert.equal(report.publishes, false);
    assert.equal(report.grokCalls, 0);
    assert.equal(report.oddsRequests, 0);
    assert.equal(report.categories.length, 2);
    assert.equal(report.empiricalRanking.length, 0);
    const markdown = renderAuditMarkdown(report);
    assert.match(markdown, /League 4242/);
    assert.match(markdown, /not a pick sheet/);
    assert.doesNotMatch(markdown, /place a bet|guaranteed edge|positive EV/i);
    const script = fs.readFileSync(path.resolve("scripts/prizepicks-audit.mjs"), "utf8");
    assert.doesNotMatch(script, /kalshi|publishPrizePicks|buyCombo/);
  });
});

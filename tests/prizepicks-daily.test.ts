import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { formatBacktest } from "../src/lib/prizepicks-odds/backtest";
import { buildDailyReport, formatDailyReport } from "../src/lib/prizepicks-odds/daily";
import { candidateEntry } from "../src/lib/prizepicks-odds/entries";
import { evaluateProp, type ScanPropInput } from "../src/lib/prizepicks-odds/evaluate";
import { exceedsCreditBudget } from "../src/lib/prizepicks-odds/markets";
import { estimateAtLine } from "../src/lib/prizepicks-odds/probability";
import { expectedValue, UNVERIFIED_PAYOUTS, type PayoutBook } from "../src/lib/prizepicks-odds/payouts";
import { scoreSettlements } from "../src/lib/prizepicks-odds/scoring";
import { diffSnapshots, toSnapshot, writeSnapshot } from "../src/lib/prizepicks-odds/snapshots";
import type { BookQuote } from "../src/lib/prizepicks-odds/consensus";

function prop(partial: Partial<ScanPropInput> & Pick<ScanPropInput, "playerName" | "line">): ScanPropInput {
  return {
    id: partial.id ?? partial.playerName,
    team: partial.team ?? "A",
    opponent: partial.opponent ?? "B",
    league: partial.league ?? "NBA",
    stat: partial.stat ?? "Points",
    market: partial.market ?? "player_points",
    oddsType: partial.oddsType ?? "standard",
    startTime: partial.startTime ?? "2026-10-09T23:00:00.000Z",
    gameId: partial.gameId ?? "game-1",
    quotes: partial.quotes ?? [],
    otherLines: partial.otherLines ?? [],
    ...partial,
  };
}

const tightFavorite: BookQuote[] = [
  { book: "draftkings", overPrice: -300, underPrice: 210 },
  { book: "fanduel", overPrice: -290, underPrice: 200 },
];

const coinFlip: BookQuote[] = [
  { book: "draftkings", overPrice: -110, underPrice: -110 },
  { book: "fanduel", overPrice: -115, underPrice: -105 },
];

describe("daily prop engine", () => {
  it("prices a half-point line from the median no-vig books and refuses an integer push", () => {
    const priced = estimateAtLine(tightFavorite, 22.5);
    assert.ok(priced);
    assert.equal(priced?.side, "over");
    assert.ok((priced?.marketProbability ?? 0) > 65);
    assert.equal(priced?.pushProbability, 0);
    assert.equal(estimateAtLine(tightFavorite, 22), null);
    const integer = evaluateProp(prop({ playerName: "Integer", line: 22, quotes: tightFavorite }), "2026-10-09T15:00:00.000Z");
    assert.ok(integer.rejectionReasons.includes("push_unidentified"));
    assert.equal(integer.marketProbability, null);
    assert.equal(integer.modelProbability, null);
    assert.equal(integer.estimatedEv, null);
  });

  it("does not turn a moved book number into a hit probability", () => {
    const moved = evaluateProp(
      prop({
        playerName: "Moved",
        line: 22.5,
        otherLines: [
          { book: "draftkings", point: 26.5, overPrice: -110, underPrice: -110 },
          { book: "fanduel", point: 26.5, overPrice: -115, underPrice: -105 },
        ],
      }),
      "2026-10-09T15:00:00.000Z"
    );
    assert.ok(moved.rejectionReasons.includes("exact_line_not_priced"));
    assert.equal(moved.marketProbability, null);
    assert.match(moved.explanation, /not a hit probability/);
  });

  it("ranks one prop per player by market probability and withholds EV", () => {
    const report = buildDailyReport({
      generatedAt: "2026-10-09T15:00:00.000Z",
      creditsSpent: 0,
      remaining: 19000,
      countPerSport: 5,
      props: [
        prop({ playerName: "A'ja Wilson", line: 22.5, quotes: tightFavorite, gameId: "w1" }),
        prop({ playerName: "A'ja Wilson", line: 8.5, stat: "Rebounds", market: "player_rebounds", quotes: coinFlip, gameId: "w1" }),
        prop({ playerName: "Caitlin Clark", line: 18.5, quotes: coinFlip, gameId: "w2", league: "WNBA" }),
        prop({ playerName: "Unpriced", line: 10.5 }),
      ],
    });
    assert.deepEqual(
      report.boards.NBA?.map((leg) => leg.playerName),
      ["A'ja Wilson"]
    );
    assert.equal(report.boards.WNBA?.[0]?.playerName, "Caitlin Clark");
    assert.equal(report.crossSportEv, null);
    assert.equal(report.entry.estimatedEv, null);
    assert.ok(report.rejections.some((row) => row.reason === "unpriced"));
    const text = formatDailyReport(report);
    assert.equal(report.picks[0]?.player, "A'ja Wilson");
    assert.equal(report.picks.some((pick) => pick.player === "Caitlin Clark"), false);
    assert.match(text, /Market-implied hit chance/);
    assert.match(text, /Expected value: unavailable/);
    assert.match(text, /not a calibrated player model/);
  });

  it("flags a same-game entry and does not publish a joint probability", () => {
    const first = evaluateProp(prop({ playerName: "One", line: 22.5, quotes: tightFavorite }), "2026-10-09T15:00:00.000Z");
    const second = evaluateProp(
      prop({ playerName: "Two", line: 18.5, quotes: coinFlip, gameId: "game-1" }),
      "2026-10-09T15:00:00.000Z"
    );
    const entry = candidateEntry([first, second], 2);
    assert.equal(entry.legs.length, 2);
    assert.ok(entry.dependencies.some((row) => row.kind === "same_game"));
    assert.equal(entry.jointProbability, null);
  });

  it("scores a verified fixture payout and refuses the live book", () => {
    const live = expectedValue({
      book: UNVERIFIED_PAYOUTS,
      ruleId: "fixture",
      outcomeProbabilities: { 2: 1 },
    });
    assert.equal(live.status, "unavailable");
    assert.equal(live.expectedNetPerUnit, null);
    const fixture: PayoutBook = {
      verified: true,
      provenance: "Test fixture, not a PrizePicks rule.",
      rules: [
        {
          id: "fixture-2",
          effectiveFrom: "2026-01-01",
          provenance: "Test fixture, not a PrizePicks rule.",
          verified: true,
          legs: 2,
          allowsDemon: false,
          allowsGoblin: false,
          tiers: [
            { hits: 2, multiplier: 3 },
            { hits: 1, multiplier: 0 },
            { hits: 0, multiplier: 0 },
          ],
        },
      ],
    };
    const scored = expectedValue({
      book: fixture,
      ruleId: "fixture-2",
      outcomeProbabilities: { 2: 0.4, 1: 0.4, 0: 0.2 },
    });
    assert.equal(scored.expectedReturn, 1.2);
    assert.equal(scored.expectedNetPerUnit, 0.2);
    assert.equal(scored.lossProbability, 0.6);
    const unknownJoint = expectedValue({ book: fixture, ruleId: "fixture-2", outcomeProbabilities: null });
    assert.equal(unknownJoint.status, "unavailable");
  });

  it("scores settlements without claiming ROI", () => {
    const report = scoreSettlements([
      {
        propId: "a",
        sport: "NBA",
        stat: "Points",
        oddsType: "standard",
        probability: 70,
        hit: 1,
        modelVersion: "market-median-v1",
        predictedAt: "2026-10-01T12:00:00.000Z",
        settledAt: "2026-10-02T03:00:00.000Z",
        closingLine: 22.5,
      },
      {
        propId: "b",
        sport: "NBA",
        stat: "Points",
        oddsType: "standard",
        probability: 70,
        hit: 0,
        modelVersion: "market-median-v1",
        predictedAt: "2026-10-01T12:00:00.000Z",
        settledAt: "2026-10-02T03:00:00.000Z",
        closingLine: 22.5,
      },
      {
        propId: "c",
        sport: "NBA",
        stat: "Points",
        oddsType: "standard",
        probability: 50,
        hit: "push",
        modelVersion: "market-median-v1",
        predictedAt: "2026-10-01T12:00:00.000Z",
        settledAt: "2026-10-02T03:00:00.000Z",
        closingLine: null,
      },
    ]);
    assert.equal(report.sampleSize, 2);
    assert.equal(report.excludedPushes, 1);
    assert.equal(report.brier, 0.29);
    assert.equal(report.roi, null);
    assert.match(formatBacktest(report), /ROI: unavailable/);
  });

  it("diffs snapshots and stops only when a credit budget is set", () => {
    const priced = evaluateProp(prop({ playerName: "One", line: 22.5, quotes: tightFavorite }), "2026-10-09T15:00:00.000Z");
    const before = toSnapshot({
      generatedAt: "2026-10-09T14:00:00.000Z",
      modelVersion: "market-median-v1",
      creditsSpent: 1,
      remaining: 10,
      props: [priced],
    });
    assert.equal(before.legs[0].projectionId, priced.projectionId);
    const after = toSnapshot({
      generatedAt: "2026-10-09T15:00:00.000Z",
      modelVersion: "market-median-v1",
      creditsSpent: 1,
      remaining: 10,
      props: [{ ...priced, marketProbability: 80, line: 23.5 }],
    });
    const changes = diffSnapshots(before, after);
    assert.ok(changes.some((change) => change.kind === "probability"));
    assert.ok(changes.some((change) => change.kind === "line"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odds-snap-"));
    writeSnapshot(after, dir);
    assert.equal(fs.existsSync(path.join(dir, "latest.json")), true);
    assert.equal(exceedsCreditBudget(10, 5, 12), true);
    assert.equal(exceedsCreditBudget(10, 5), false);
  });
});

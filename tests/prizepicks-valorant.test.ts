import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import type { PrizePicksProjection } from "../src/lib/prizepicks/types";
import { evaluateBacktest, leaks, timeSplit } from "../src/lib/prizepicks-valorant/backtest";
import { matchIdentity } from "../src/lib/prizepicks-valorant/identity";
import { applyInformation, dispersionRatio, projectMaps12 } from "../src/lib/prizepicks-valorant/model";
import { renderValorantMarkdown } from "../src/lib/prizepicks-valorant/report";
import { parseValorantArgs, runValorant } from "../src/lib/prizepicks-valorant/run";
import { discoverValorantProps, isMaps12Kills } from "../src/lib/prizepicks-valorant/scope";
import { acceptHandle, classifyEvidence, interpretSignal } from "../src/lib/prizepicks-valorant/signals";
import type { MapAppearance, ValorantProp } from "../src/lib/prizepicks-valorant/types";

const now = "2026-10-11T20:00:00.000Z";
const start = "2026-10-11T23:00:00.000Z";

function projection(partial: Partial<PrizePicksProjection> & Pick<PrizePicksProjection, "playerName" | "statDisplayName">): PrizePicksProjection {
  return {
    id: partial.playerName,
    team: "Alpha",
    opponent: "Beta",
    leagueId: "159",
    leagueName: "League 159",
    statType: partial.statDisplayName,
    lineScore: 28.5,
    oddsType: "standard",
    startTime: start,
    gameId: "match-1",
    status: "pre_game",
    ...partial,
  };
}

function appearance(partial: Partial<MapAppearance> = {}): MapAppearance {
  return {
    provider: "fixture",
    providerPlayerId: "p1",
    playerName: "AscentKing",
    team: "Alpha",
    opponent: "Beta",
    map: "Ascent",
    seriesPosition: 1,
    rounds: 22,
    kills: 16,
    agent: "Jett",
    matchDate: "2026-10-01T00:00:00.000Z",
    format: "bo3",
    patch: null,
    retrievedAt: now,
    ...partial,
  };
}

function rowsFor(player = "AscentKing"): MapAppearance[] {
  const rows: MapAppearance[] = [];
  for (let i = 0; i < 6; i++) {
    rows.push(appearance({ matchDate: `2026-09-0${i + 1}T00:00:00.000Z`, seriesPosition: 1, rounds: 20 + i, kills: 14 }));
    rows.push(appearance({ matchDate: `2026-09-1${i}T00:00:00.000Z`, seriesPosition: 2, rounds: 18 + i, kills: 12, map: "Bind" }));
  }
  return rows.map((row) => ({ ...row, playerName: player }));
}

describe("prizepicks valorant", () => {
  it("discovers the VAL category and keeps Maps 1–2 kills separate from other scopes", () => {
    assert.equal(isMaps12Kills("MAPS 1-2 Kills"), true);
    assert.equal(isMaps12Kills("MAPS 1-3 Kills"), false);
    assert.equal(isMaps12Kills("MAPS 1-2 Kills (Combo)"), false);
    const names = new Map([["159", "VAL"], ["121", "LoL"]]);
    const props = discoverValorantProps(
      [
        projection({ playerName: "AscentKing", statDisplayName: "MAPS 1-2 Kills" }),
        projection({ playerName: "Duo", statDisplayName: "MAPS 1-2 Kills (Combo)", id: "combo" }),
        projection({ playerName: "Demon", statDisplayName: "MAPS 1-2 Kills", oddsType: "demon", id: "demon" }),
        projection({ playerName: "LolPlayer", statDisplayName: "MAPS 1-3 Kills", leagueId: "121" }),
      ],
      names,
      now
    );
    assert.equal(props.length, 2);
    assert.equal(props.filter((prop) => prop.eligible).length, 1);
    assert.equal(props.find((prop) => prop.player === "Demon")?.propClass, "demon");
    assert.equal(props.every((prop) => prop.scope === "maps_1_2"), true);
  });

  it("matches one gamer tag and refuses duplicates, aliases, and unverified handles", () => {
    assert.deepEqual(matchIdentity("Ascent King", "Alpha", [{ id: "1", name: "ascentking", team: "Alpha" }]), { status: "high", id: "1" });
    assert.equal(matchIdentity("AscentKing", "Alpha", [{ id: "1", name: "ascentking", team: "Alpha" }, { id: "2", name: "AscentKing", team: "Alpha" }]).status, "ambiguous");
    assert.equal(matchIdentity("AscentKing", "Alpha", [{ id: "9", name: "OtherTag", team: "Alpha" }]).status, "unmatched");
    assert.equal(acceptHandle("ValorantEsports", "https://x.com/ValorantEsports/status/1"), "ValorantEsports");
    assert.equal(acceptHandle("madeup", "https://example.com/madeup"), null);
    assert.equal(classifyEvidence({ url: "https://valorantesports.com/news/1", publishedAt: now, nowIso: now, supportingUrls: [], contradicted: false }), "CONFIRMED");
    assert.equal(classifyEvidence({ url: "https://x.com/someone/status/1", publishedAt: "2026-10-01T00:00:00.000Z", nowIso: now, supportingUrls: [], contradicted: false }), "STALE");
  });

  it("does not add kills for a roster change and withholds probabilities without map positions", () => {
    const prop: ValorantProp = {
      projectionId: "p",
      player: "AscentKing",
      playerKey: "ascentking",
      team: "Alpha",
      opponent: "Beta",
      eventId: "match-1",
      startTime: start,
      scope: "maps_1_2",
      statLabel: "MAPS 1-2 Kills",
      line: 28.5,
      propClass: "standard",
      eligible: true,
    };
    const missing = projectMaps12(prop, [appearance({ seriesPosition: null })], now, "high");
    assert.equal(missing.status, "INSUFFICIENT_HISTORICAL_DATA");
    assert.equal(missing.probabilityMore, null);
    assert.equal(missing.probabilityPush, null);
    const projected = projectMaps12(prop, rowsFor(), now, "high");
    assert.equal(projected.status, "projected");
    assert.equal(projected.probabilityMore, null);
    assert.ok(projected.baselineExpected != null);
    const signal = interpretSignal({ url: "https://valorantesports.com/roster", publishedAt: now, claim: "starter substituted", kind: "roster", player: "AscentKing" }, "match-1", now);
    assert.equal(signal.status, "CONFIRMED");
    assert.equal(signal.measuredKillDelta, null);
    const adjusted = applyInformation(projected, [signal.effect]);
    assert.equal(adjusted.adjustedExpected, projected.baselineExpected);
    assert.equal(adjusted.verdict, "ROLE_CHANGE_RISK");
    assert.equal(dispersionRatio([1, 2, 3]).poissonRejected, true);
  });

  it("keeps backtests free of leakage and does not crown model B on a short sample", () => {
    const rows = [
      { id: "1", observedAt: "2026-10-01T00:00:00.000Z", featuresAvailableAt: "2026-10-02T00:00:00.000Z", line: 20, actualMaps12Kills: 18, modelA: 19, modelB: 19, baselineAverage: 17, probabilityMore: null },
      { id: "2", observedAt: "2026-10-03T00:00:00.000Z", featuresAvailableAt: "2026-10-02T00:00:00.000Z", line: 20, actualMaps12Kills: 22, modelA: 21, modelB: 21, baselineAverage: 19, probabilityMore: 0.6 },
    ];
    assert.equal(leaks(rows[0]!), true);
    const split = timeSplit(rows.filter((row) => !leaks(row)));
    assert.equal(split.test.length + split.train.length, 1);
    const result = evaluateBacktest(rows);
    assert.equal(result.status, "insufficient_history");
    assert.equal(result.modelBImproved, false);
    assert.equal(result.brier, null);
  });

  it("parses the CLI, skips paid calls on estimate, and does not wager", async () => {
    assert.equal(parseValorantArgs([]).mode, "board");
    assert.throws(() => parseValorantArgs(["--mode", "picks"]), /Unknown mode/);
    const report = await runValorant(
      { mode: "full", estimate: true, maxGrokSpend: 2, maxGrokCalls: 6, maxMatches: 5 },
      {
        now: new Date(now),
        write: false,
        catalog: [{ id: "159", name: "VAL", providerSport: null, projectionsCount: 1, active: true }],
        projections: [projection({ playerName: "AscentKing", statDisplayName: "MAPS 1-2 Kills" })],
        researchMatch: async () => {
          throw new Error("paid research should not run");
        },
        fetchImpl: async () => {
          throw new Error("paid fetch should not run");
        },
      }
    );
    assert.equal(report.placesWagers, false);
    assert.equal(report.publishes, false);
    assert.equal(report.grokCalls, 0);
    assert.equal(report.props.length, 1);
    assert.equal(report.projections[0]?.status, "INSUFFICIENT_HISTORICAL_DATA");
    const markdown = renderValorantMarkdown(report);
    assert.match(markdown, /not expected value/);
    assert.doesNotMatch(markdown, /positive EV|guaranteed/);
    const script = fs.readFileSync(path.resolve("scripts/prizepicks-valorant.mjs"), "utf8");
    assert.doesNotMatch(script, /kalshi|buyCombo|publishPrizePicks/);
  });
});

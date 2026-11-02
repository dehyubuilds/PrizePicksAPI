import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PrizePicksProjection } from "../src/lib/prizepicks/types";
import { buildFlex32Candidates } from "../src/lib/prizepicks-flex32/score";
import { selectFlex32Lineup } from "../src/lib/prizepicks-flex32/select";

function proj(
  partial: Partial<PrizePicksProjection> &
    Pick<PrizePicksProjection, "playerName" | "lineScore" | "oddsType" | "statDisplayName" | "leagueId">
): PrizePicksProjection {
  return {
    id: partial.id ?? `${partial.playerName}-${partial.statDisplayName}-${partial.lineScore}-${partial.oddsType}`,
    playerName: partial.playerName,
    team: partial.team ?? "T",
    opponent: partial.opponent ?? "O",
    leagueId: partial.leagueId,
    leagueName: partial.leagueName ?? "",
    statDisplayName: partial.statDisplayName,
    statType: partial.statType ?? partial.statDisplayName,
    lineScore: partial.lineScore,
    oddsType: partial.oddsType,
    startTime: partial.startTime ?? "2026-10-24T00:00:00.000Z",
    gameId: partial.gameId ?? "g1",
    status: partial.status ?? "pre_game",
  };
}

const nowMs = Date.parse("2026-10-23T15:00:00.000Z");

describe("prizepicks flex 3-2", () => {
  it("scores goblins under the main higher than the main itself", () => {
    const projections = [
      proj({ playerName: "A Reese", leagueId: "3", statDisplayName: "Rebounds", lineScore: 12, oddsType: "standard", gameId: "wnba1" }),
      proj({ playerName: "A Reese", leagueId: "3", statDisplayName: "Rebounds", lineScore: 9.5, oddsType: "goblin", gameId: "wnba1" }),
      proj({ playerName: "J Canada", leagueId: "3", statDisplayName: "Assists", lineScore: 7, oddsType: "standard", gameId: "wnba1" }),
      proj({ playerName: "J Canada", leagueId: "3", statDisplayName: "Assists", lineScore: 5.5, oddsType: "goblin", gameId: "wnba1" }),
      proj({ playerName: "D White", leagueId: "7", statDisplayName: "Rebounds", lineScore: 3.5, oddsType: "standard", gameId: "nba1", startTime: "2026-10-23T23:00:00.000Z" }),
      proj({ playerName: "G Allen", leagueId: "7", statDisplayName: "Rebounds", lineScore: 2.5, oddsType: "standard", gameId: "nba1", startTime: "2026-10-23T23:00:00.000Z" }),
      proj({ playerName: "M Robinson", leagueId: "7", statDisplayName: "Assists", lineScore: 0.5, oddsType: "standard", gameId: "nba1", startTime: "2026-10-23T23:00:00.000Z" }),
      proj({ playerName: "K Towns", leagueId: "7", statDisplayName: "Rebounds", lineScore: 11.5, oddsType: "standard", gameId: "nba1", startTime: "2026-10-23T23:00:00.000Z" }),
      proj({ playerName: "K Towns", leagueId: "7", statDisplayName: "Rebounds", lineScore: 7.5, oddsType: "goblin", gameId: "nba1", startTime: "2026-10-23T23:00:00.000Z" }),
    ];

    const candidates = buildFlex32Candidates(projections, {
      nowMs,
      horizonHours: 48,
      sports: ["WNBA", "NBA"],
    });

    const reeseGoblin = candidates.find(
      (c) => c.projection.playerName === "A Reese" && c.bucket === "goblin"
    );
    const reeseMain = candidates.find(
      (c) => c.projection.playerName === "A Reese" && c.bucket === "standard"
    );
    assert.ok(reeseGoblin);
    assert.ok(reeseMain);
    assert.ok((reeseGoblin?.softnessScore ?? 0) > (reeseMain?.softnessScore ?? 0));
  });

  it("selects 3 goblin + 2 standard when the board is deep enough", () => {
    const projections = [
      proj({ playerName: "P1", leagueId: "7", statDisplayName: "Rebounds", lineScore: 10, oddsType: "standard", gameId: "a" }),
      proj({ playerName: "P1", leagueId: "7", statDisplayName: "Points", lineScore: 16, oddsType: "standard", gameId: "a" }),
      proj({ playerName: "P1", leagueId: "7", statDisplayName: "Rebounds", lineScore: 6.5, oddsType: "goblin", gameId: "a" }),
      proj({ playerName: "P2", leagueId: "7", statDisplayName: "Assists", lineScore: 8, oddsType: "standard", gameId: "a" }),
      proj({ playerName: "P2", leagueId: "7", statDisplayName: "Points", lineScore: 18, oddsType: "standard", gameId: "a" }),
      proj({ playerName: "P2", leagueId: "7", statDisplayName: "Assists", lineScore: 4.5, oddsType: "goblin", gameId: "a" }),
      proj({ playerName: "P3", leagueId: "3", statDisplayName: "Points", lineScore: 18, oddsType: "standard", gameId: "b", startTime: "2026-10-24T17:00:00.000Z" }),
      proj({ playerName: "P3", leagueId: "3", statDisplayName: "Points", lineScore: 11.5, oddsType: "goblin", gameId: "b", startTime: "2026-10-24T17:00:00.000Z" }),
      proj({ playerName: "P4", leagueId: "7", statDisplayName: "Rebounds", lineScore: 5, oddsType: "standard", gameId: "c" }),
      proj({ playerName: "P4", leagueId: "7", statDisplayName: "Points", lineScore: 14, oddsType: "standard", gameId: "c" }),
      proj({ playerName: "P5", leagueId: "2", statDisplayName: "Ks", lineScore: 3, oddsType: "standard", gameId: "d", startTime: "2026-10-24T01:00:00.000Z" }),
      proj({ playerName: "P6", leagueId: "9", statDisplayName: "Receptions", lineScore: 4.5, oddsType: "standard", gameId: "e", startTime: "2026-10-25T17:00:00.000Z" }),
      proj({ playerName: "P6", leagueId: "9", statDisplayName: "Receptions", lineScore: 2.5, oddsType: "goblin", gameId: "e", startTime: "2026-10-25T17:00:00.000Z" }),
    ];

    const candidates = buildFlex32Candidates(projections, {
      nowMs,
      horizonHours: 72,
      sports: ["MLB", "WNBA", "NBA", "NFL"],
    });
    const selected = selectFlex32Lineup(candidates);
    assert.equal(selected.mix, "3g2s");
    assert.equal(selected.picks.length, 5);
    assert.equal(selected.picks.filter((p) => p.bucket === "goblin").length, 3);
    assert.equal(selected.picks.filter((p) => p.bucket === "standard").length, 2);
    assert.equal(selected.picks.filter((p) => p.bucket === "demon").length, 0);
  });

  it("falls back to 3 goblin + 1 standard + 1 mild demon", () => {
    const projections = [
      proj({ playerName: "G1", leagueId: "7", statDisplayName: "Rebounds", lineScore: 11, oddsType: "standard", gameId: "g" }),
      proj({ playerName: "G1", leagueId: "7", statDisplayName: "Points", lineScore: 15, oddsType: "standard", gameId: "g" }),
      proj({ playerName: "G1", leagueId: "7", statDisplayName: "Rebounds", lineScore: 7.5, oddsType: "goblin", gameId: "g" }),
      proj({ playerName: "G2", leagueId: "7", statDisplayName: "Assists", lineScore: 6, oddsType: "standard", gameId: "g" }),
      proj({ playerName: "G2", leagueId: "7", statDisplayName: "Points", lineScore: 16, oddsType: "standard", gameId: "g" }),
      proj({ playerName: "G2", leagueId: "7", statDisplayName: "Assists", lineScore: 4.5, oddsType: "goblin", gameId: "g" }),
      proj({ playerName: "G3", leagueId: "7", statDisplayName: "Points", lineScore: 20, oddsType: "standard", gameId: "h" }),
      proj({ playerName: "G3", leagueId: "7", statDisplayName: "Points", lineScore: 14.5, oddsType: "goblin", gameId: "h" }),
      // Only one soft-ish standard left after goblins consume players… use distinct standard + mild demon
      proj({ playerName: "S1", leagueId: "7", statDisplayName: "Rebounds", lineScore: 5, oddsType: "standard", gameId: "i" }),
      proj({ playerName: "S1", leagueId: "7", statDisplayName: "Points", lineScore: 12, oddsType: "standard", gameId: "i" }),
      proj({ playerName: "D1", leagueId: "7", statDisplayName: "Assists", lineScore: 5, oddsType: "standard", gameId: "i" }),
      proj({ playerName: "D1", leagueId: "7", statDisplayName: "Points", lineScore: 14, oddsType: "standard", gameId: "i" }),
      proj({ playerName: "D1", leagueId: "7", statDisplayName: "Assists", lineScore: 6.5, oddsType: "demon", gameId: "i" }),
    ];

    const candidates = buildFlex32Candidates(projections, {
      nowMs,
      horizonHours: 48,
      sports: ["NBA"],
    });
    // Remove extra soft standards so 3g2s fails: keep only S1 as usable standard besides mains tied to goblin players
    const slim = candidates.filter((c) => {
      if (c.bucket === "goblin") return true;
      if (c.bucket === "standard" && c.projection.playerName === "S1") return true;
      if (c.bucket === "demon" && c.projection.playerName === "D1") return true;
      return false;
    });

    const selected = selectFlex32Lineup(slim);
    assert.equal(selected.mix, "3g1s1d");
    assert.equal(selected.picks.filter((p) => p.bucket === "goblin").length, 3);
    assert.equal(selected.picks.filter((p) => p.bucket === "standard").length, 1);
    assert.equal(selected.picks.filter((p) => p.bucket === "demon").length, 1);
  });

  it("rejects demons more than +2 over the main", () => {
    const projections = [
      proj({ playerName: "X", leagueId: "7", statDisplayName: "Points", lineScore: 20, oddsType: "standard" }),
      proj({ playerName: "X", leagueId: "7", statDisplayName: "Points", lineScore: 25.5, oddsType: "demon" }),
    ];
    const candidates = buildFlex32Candidates(projections, {
      nowMs,
      horizonHours: 48,
      sports: ["NBA"],
    });
    assert.equal(
      candidates.filter((c) => c.bucket === "demon").length,
      0
    );
  });
});

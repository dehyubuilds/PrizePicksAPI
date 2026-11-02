import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  inferLeagueIdForProjection,
  leagueNameForId,
  projectionNeedsLeagueId,
} from "../src/lib/prizepicks/leagues";

describe("prizepicks leagues", () => {
  it("maps known league ids to names", () => {
    assert.equal(leagueNameForId("7"), "NBA");
    assert.equal(leagueNameForId("2"), "MLB");
  });

  it("detects missing league ids", () => {
    assert.equal(projectionNeedsLeagueId({ leagueId: "" }), true);
    assert.equal(projectionNeedsLeagueId({ leagueId: "7" }), false);
  });

  it("infers MLB from baseball stat names", () => {
    assert.equal(
      inferLeagueIdForProjection({
        statDisplayName: "Strikeouts",
        statType: "pitcher_strikeouts",
      }),
      "2"
    );
  });

  it("does not guess NBA vs WNBA from shared basketball stats", () => {
    assert.equal(
      inferLeagueIdForProjection({
        statDisplayName: "Points",
        statType: "points",
      }),
      ""
    );
  });
});

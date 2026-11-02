import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { agreedBookLine, fairFromBooks, priceSides } from "../src/lib/prizepicks-odds/consensus";
import { marketForStat, normalizePlayerName, resolveOddsSports } from "../src/lib/prizepicks-odds/markets";
import { renderOddsBoardHtml } from "../src/lib/prizepicks-odds/publish-page";
import { renderOddsShareCard } from "../src/lib/prizepicks-odds/share-card";
import { lineIsStale, selectBiggestGaps } from "../src/lib/prizepicks-odds/select";
import { eventMatchesTeams, teamMatches } from "../src/lib/prizepicks-odds/teams";
import type { OddsLeg } from "../src/lib/prizepicks-odds/select";

function leg(partial: Partial<OddsLeg> & Pick<OddsLeg, "sport" | "edge">): OddsLeg {
  return {
    player: partial.player ?? `${partial.sport} Player`,
    stat: partial.stat ?? "Points",
    line: partial.line ?? 20.5,
    side: partial.side ?? "over",
    fairPct: partial.fairPct ?? 58,
    ppPct: partial.ppPct ?? 50,
    books: partial.books ?? 4,
    oddsType: partial.oddsType ?? "standard",
    projectionId: partial.projectionId ?? partial.sport,
    bookLine: partial.bookLine ?? `${partial.sport} line`,
    ...partial,
  };
}

describe("sportsbook consensus", () => {
  it("defaults the scan to every supported sport", () => {
    assert.ok(resolveOddsSports().includes("WNBA"));
    assert.ok(resolveOddsSports().includes("NHL"));
    assert.ok(resolveOddsSports().includes("NFL"));
    assert.deepEqual(resolveOddsSports(["nba", "nfl"]), ["NBA", "NFL"]);
    assert.throws(() => resolveOddsSports(["CRICKET"]), /Unknown sports/);
  });

  it("maps combo stats before the single stat inside them", () => {
    assert.equal(marketForStat("WNBA", "Pts+Rebs+Asts", "pra"), "player_points_rebounds_assists");
    assert.equal(marketForStat("MLB", "Hits+Runs+RBIs", "hrr"), "batter_hits_runs_rbis");
    assert.equal(marketForStat("NFL", "Receiving Yards", "rec_yds"), "player_reception_yds");
    assert.equal(marketForStat("WNBA", "1Q Points", "points"), null);
    assert.equal(marketForStat("NFL", "Halves w/100+ Pass Yds", "passing_yards"), null);
    assert.equal(normalizePlayerName("A'ja Wilson Jr."), "aja wilson");
  });

  it("matches abbreviations to full sportsbook team names", () => {
    assert.equal(teamMatches("LVA", "Las Vegas Aces"), true);
    assert.equal(
      eventMatchesTeams({ team: "LVA", opponent: "IND", home: "Indiana Fever", away: "Las Vegas Aces" }),
      true
    );
  });

  it("requires two books and prices the over against a 50% PrizePicks standard", () => {
    const fair = fairFromBooks([
      { book: "draftkings", overPrice: -120, underPrice: 100 },
      { book: "fanduel", overPrice: -115, underPrice: -105 },
    ]);
    assert.ok(fair);
    assert.equal(fair?.books, 2);
    const sides = priceSides({ fair: fair!, oddsType: "standard" });
    const over = sides.find((side) => side.side === "over");
    assert.ok((over?.fairPct ?? 0) > 50);
    assert.equal(fairFromBooks([{ book: "draftkings", overPrice: -120, underPrice: 100 }]), null);
  });

  it("keeps the largest gaps across sports and drops a +6 lean", () => {
    const picked = selectBiggestGaps(
      [
        leg({ sport: "NBA", edge: 23, player: "A" }),
        leg({ sport: "NBA", edge: 14, player: "B" }),
        leg({ sport: "MLB", edge: 7 }),
        leg({ sport: "NFL", edge: 4 }),
        leg({ sport: "NHL", edge: 13, player: "C" }),
        leg({
          sport: "WNBA",
          edge: 4,
          player: "D",
          line: 22.5,
          gapKind: "line",
          bookPoint: 26.5,
        }),
      ],
      6,
      12
    );
    assert.deepEqual(
      picked.map((row) => row.player),
      ["A", "D", "B", "C"]
    );
  });

  it("treats a moved book number as the disagreement when the PrizePicks line is not priced", () => {
    const agreed = agreedBookLine([
      { book: "draftkings", point: 26.5, overPrice: -110, underPrice: -110 },
      { book: "fanduel", point: 26.5, overPrice: -115, underPrice: -105 },
      { book: "betmgm", point: 23.5, overPrice: -110, underPrice: -110 },
    ]);
    assert.equal(lineIsStale(22.5, 26.5), true);
    assert.equal(lineIsStale(1.5, 279.5), false);
    assert.equal(agreed?.point, 26.5);
    assert.equal(agreed?.books, 2);
  });

  it("renders an open-prop link for each saved leg", () => {
    const html = renderOddsBoardHtml({
      generatedAtLabel: "Fri, Oct 2, 10:00 PM",
      ogImageUrl: "https://cdn.example/picks/odds/card.jpg",
      pageUrl: "https://dropflow.us/picks/odds",
      board: {
        generatedAt: "2026-10-03T03:00:00.000Z",
        minEdge: 6,
        creditsSpent: 40,
        remaining: 460,
        truncated: false,
        legs: [leg({ sport: "WNBA", edge: 8, player: "A'ja Wilson", projectionId: "15261430", bookLine: "A'ja Wilson Over 22.5 Points" })],
      },
    });
    assert.match(html, /A&#39;ja Wilson Over 22.5 Points/);
    assert.match(html, /Open this prop/);
    assert.match(html, /league_id=3/);
    assert.match(html, /projId=15261430/);
    assert.match(html, /og:image/);
  });

  it("renders a jpeg share card", async () => {
    const card = await renderOddsShareCard({
      dateLabel: "Fri, Oct 2, 11:02 PM",
      legs: [leg({ sport: "NFL", edge: 12, player: "Tyler Warren", bookLine: "Tyler Warren Over 5.5 Recs" })],
    });
    assert.ok(card.length > 1000);
    assert.equal(card[0], 0xff);
    assert.equal(card[1], 0xd8);
  });
});

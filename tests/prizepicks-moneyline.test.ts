import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { confidenceExplanation, parseMoneylineBoard, pickToWin, renderMoneylineHtml, type MoneylineGame } from "../src/lib/prizepicks-odds/moneyline";
import { renderMoneylineShareCard } from "../src/lib/prizepicks-odds/share-card";

describe("cfb moneyline", () => {
  it("keeps a two-book moneyline and drops a one-sided price", async () => {
    const games = parseMoneylineBoard([
      {
        id: "g1",
        home_team: "Ohio State Buckeyes",
        away_team: "Michigan Wolverines",
        commence_time: "2026-10-10T23:30:00Z",
        bookmakers: [
          { markets: [{ key: "h2h", outcomes: [{ name: "Ohio State Buckeyes", price: -180 }, { name: "Michigan Wolverines", price: 155 }] }] },
          { markets: [{ key: "h2h", outcomes: [{ name: "Ohio State Buckeyes", price: -170 }, { name: "Michigan Wolverines", price: 145 }] }] },
          { markets: [{ key: "spreads", outcomes: [{ name: "Ohio State Buckeyes", price: -110, point: -3.5 }] }] },
        ],
      },
      {
        id: "g2",
        home_team: "Texas Longhorns",
        away_team: "Oklahoma Sooners",
        commence_time: "2026-10-11T00:00:00Z",
        bookmakers: [
          { markets: [{ key: "h2h", outcomes: [{ name: "Texas Longhorns", price: -150 }] }] },
        ],
      },
    ]);
    assert.equal(games.length, 1);
    assert.equal(games[0]?.books, 2);
    assert.ok(Math.abs(games[0]!.homeFair + games[0]!.awayFair - 100) < 0.2);
    assert.ok(games[0]!.homeFair > games[0]!.awayFair);
    assert.equal(pickToWin(games[0]!), "Ohio State Buckeyes");
    assert.match(renderMoneylineHtml(games, "CFB", "now"), /Starts Sat, Oct 10, 6:30 PM CDT/);
    const shared = renderMoneylineHtml(games, "CFB", "now", {
      pageUrl: "https://cdn.example/picks/cfb-moneyline/index.html",
      ogImageUrl: "https://cdn.example/picks/cfb-moneyline/card.jpg",
    });
    assert.match(shared, /property="og:image" content="https:\/\/cdn\.example\/picks\/cfb-moneyline\/card\.jpg"/);
    assert.match(shared, /twitter:card" content="summary_large_image"/);
    const card = await renderMoneylineShareCard({
      sport: "CFB",
      gameCount: 1,
      dateLabel: "Sat, Oct 10, 2:36 PM CDT",
      lines: [{ pick: "Ohio State Buckeyes", start: "Sat, Oct 10, 6:30 PM CDT" }],
    });
    assert.equal(card[0], 0xff);
    assert.equal(card[1], 0xd8);
    assert.match(confidenceExplanation(games[0]!), /lean, not a sure win/);
    assert.match(confidenceExplanation(games[0]!), /Only 2 sportsbooks/);
  });

  it("explains a heavy favorite, a close game, and a wide disagreement in plain language", () => {
    const heavy = game({ home: "Toledo Rockets", away: "Buffalo Bulls", homeFair: 88.7, books: 11, fairRange: 2.2 });
    const close = game({ home: "Ohio Bobcats", away: "Central Michigan Chippewas", homeFair: 55.5, books: 11, fairRange: 1.5 });
    const split = game({ home: "Nebraska Cornhuskers", away: "Indiana Hoosiers", homeFair: 26.5, books: 6, fairRange: 24.7 });
    assert.match(confidenceExplanation(heavy), /very sure about the Toledo Rockets/);
    assert.match(confidenceExplanation(heavy), /9 times out of 10/);
    assert.match(confidenceExplanation(heavy), /steady read/);
    assert.match(confidenceExplanation(close), /close/);
    assert.match(confidenceExplanation(close), /small but steady/);
    assert.match(confidenceExplanation(split), /clearly favor the Indiana Hoosiers/);
    assert.match(confidenceExplanation(split), /3 times out of 4/);
    assert.match(confidenceExplanation(split), /disagree a lot/);
    assert.doesNotMatch(confidenceExplanation(heavy), /expected value|lock|guaranteed/i);
  });
});

function game(partial: Pick<MoneylineGame, "home" | "away" | "homeFair" | "books" | "fairRange">): MoneylineGame {
  return {
    id: "t",
    home: partial.home,
    away: partial.away,
    start: "2026-10-10T19:30:00Z",
    books: partial.books,
    homeAmerican: -200,
    awayAmerican: 170,
    homeFair: partial.homeFair,
    awayFair: Math.round((100 - partial.homeFair) * 10) / 10,
    fairRange: partial.fairRange,
  };
}

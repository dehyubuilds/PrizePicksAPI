import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import sharp from "sharp";
import os from "os";
import path from "path";
import { buildDailyReport, formatDailyReport } from "../src/lib/prizepicks-odds/daily";
import { renderDailyPicksHtml } from "../src/lib/prizepicks-odds/publish-page";
import { renderDailyShareCard } from "../src/lib/prizepicks-odds/share-card";
import { evaluateProp, type ScanPropInput } from "../src/lib/prizepicks-odds/evaluate";
import { rankBestPicks } from "../src/lib/prizepicks-odds/best-picks";
import { dailyResearchPlan } from "../src/lib/prizepicks-odds/research";
import { writeDailyArtifacts } from "../src/lib/prizepicks-odds/report-store";
import { scoreSettlements } from "../src/lib/prizepicks-odds/scoring";
import type { BookQuote } from "../src/lib/prizepicks-odds/consensus";

const at = "2026-10-09T15:00:00.000Z";
const freshAt = "2026-10-09T14:50:00.000Z";

const tight: BookQuote[] = [
  { book: "draftkings", overPrice: -300, underPrice: 210, lastUpdate: freshAt },
  { book: "fanduel", overPrice: -290, underPrice: 200, lastUpdate: freshAt },
  { book: "betmgm", overPrice: -280, underPrice: 200, lastUpdate: freshAt },
  { book: "caesars", overPrice: -300, underPrice: 210, lastUpdate: freshAt },
];

const coin: BookQuote[] = [
  { book: "draftkings", overPrice: -110, underPrice: -110, lastUpdate: freshAt },
  { book: "fanduel", overPrice: -115, underPrice: -105, lastUpdate: freshAt },
];

function row(partial: Partial<ScanPropInput> & Pick<ScanPropInput, "playerName" | "line">): ScanPropInput {
  return {
    id: partial.playerName,
    team: "Aces",
    opponent: "Liberty",
    league: "NBA",
    stat: "Points",
    market: "player_points",
    oddsType: "standard",
    startTime: "2026-10-09T23:00:00.000Z",
    gameId: "g1",
    quotes: [],
    otherLines: [],
    ...partial,
  };
}

describe("daily best picks", () => {
  it("ranks a fresh direct price ahead of a higher interpolated price", () => {
    const direct = evaluateProp(row({ playerName: "Direct", line: 22.5, quotes: tight }), at);
    const interpolated = evaluateProp(
      row({
        playerName: "Bracket",
        line: 22.5,
        quotes: [],
        otherLines: [
          ...tight.map((quote) => ({ ...quote, point: 21.5 })),
          ...coin.map((quote) => ({ ...quote, point: 23.5 })),
        ],
        gameId: "g2",
      }),
      at
    );
    assert.equal(direct.probabilitySource, "direct");
    assert.equal(interpolated.probabilitySource, "interpolated");
    const boosted = { ...interpolated, marketProbability: 90 };
    const ranked = rankBestPicks([boosted, direct], at);
    assert.equal(ranked[0]?.player, "Direct");
    assert.equal(ranked[0]?.evidenceQuality, "high");
    assert.equal(ranked[0]?.pricingMethod, "direct");
    assert.notEqual(ranked[0]?.marketProbability, ranked[0]?.evidenceQuality);
  });

  it("keeps one side of a market and still allows a different stat", () => {
    const points = evaluateProp(row({ playerName: "A'ja Wilson", line: 22.5, quotes: tight }), at);
    const otherSide = { ...points, side: "under" as const, marketProbability: 80, id: "under" };
    const rebounds = evaluateProp(
      row({
        playerName: "A'ja Wilson",
        line: 8.5,
        stat: "Rebounds",
        market: "player_rebounds",
        quotes: tight,
      }),
      at
    );
    const ranked = rankBestPicks([points, otherSide, rebounds], at);
    const sides = ranked.filter((pick) => pick.market === "player_points").map((pick) => pick.side);
    assert.equal(sides.length, 1);
    assert.equal(ranked.some((pick) => pick.market === "player_rebounds"), true);
  });

  it("does not force a pick per sport and succeeds on an empty day", () => {
    const report = buildDailyReport({
      generatedAt: at,
      creditsSpent: 3,
      remaining: 100,
      props: [
        row({ playerName: "Coin", line: 10.5, quotes: coin, league: "NHL" }),
        row({ playerName: "Gap", line: 18.5, league: "MLB", gameId: "g9" }),
      ],
    });
    assert.equal(report.picks.length, 0);
    assert.ok(report.sportsConsidered.includes("NHL"));
    const text = formatDailyReport(report);
    assert.match(text, /No qualifying picks today/);
    assert.match(text, /Expected value: unavailable/);
    assert.doesNotMatch(text, /LOCK|GUARANTEED/);
  });

  it("drops a started game and flags a moved line", () => {
    const live = evaluateProp(
      row({ playerName: "Late", line: 22.5, quotes: tight, startTime: "2026-10-09T14:00:00.000Z" }),
      at
    );
    assert.equal(rankBestPicks([live], at).length, 0);
    const current = evaluateProp(row({ playerName: "Moved", line: 24.5, quotes: tight }), at);
    const ranked = rankBestPicks([current], at, undefined, {
      generatedAt: "2026-10-09T12:00:00.000Z",
      modelVersion: "market-median-v1",
      creditsSpent: 0,
      remaining: null,
      legs: [
        {
          id: "old",
          sport: "NBA",
          label: "Moved",
          line: 20.5,
          side: "over",
          marketProbability: 60,
          modelVersion: "market-median-v1",
          sourceTimestamp: "2026-10-09T12:00:00.000Z",
          playerName: "Moved",
          market: "player_points",
          eventId: "g1",
        },
      ],
    });
    assert.match(ranked[0]?.warnings.join(" ") ?? "", /moved this line from 20.5 to 24.5/);
  });

  it("skips research unless a price and a cap exist, and stores the report", () => {
    const savedPrice = process.env.XAI_USD_PER_RESEARCH;
    const savedCap = process.env.DAILY_MAX_GROK_SPEND;
    delete process.env.XAI_USD_PER_RESEARCH;
    delete process.env.DAILY_MAX_GROK_SPEND;
    try {
      const plan = dailyResearchPlan({ mode: "daily", research: "auto", maxGrokSpend: 2 });
      assert.equal(plan.run, false);
      assert.match(plan.note, /skipped/i);
    } finally {
      if (savedPrice == null) delete process.env.XAI_USD_PER_RESEARCH;
      else process.env.XAI_USD_PER_RESEARCH = savedPrice;
      if (savedCap == null) delete process.env.DAILY_MAX_GROK_SPEND;
      else process.env.DAILY_MAX_GROK_SPEND = savedCap;
    }
    const report = buildDailyReport({
      generatedAt: at,
      creditsSpent: 0,
      remaining: null,
      props: [row({ playerName: "Direct", line: 22.5, quotes: tight })],
    });
    const dir = writeDailyArtifacts(report, formatDailyReport(report), fs.mkdtempSync(path.join(os.tmpdir(), "picks-")));
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8")) as { picks: Array<{ marketProbability: number; evidenceQuality: string }> };
    assert.equal(saved.picks[0]?.evidenceQuality, "high");
    assert.equal(typeof saved.picks[0]?.marketProbability, "number");
    assert.equal(fs.existsSync(path.join(dir, "report.txt")), true);
    assert.equal(fs.existsSync(path.join(dir, "rejected.json")), true);
  });

  it("renders a share page and a jpeg for texting", async () => {
    const report = buildDailyReport({
      generatedAt: at,
      creditsSpent: 0,
      remaining: null,
      props: [row({ playerName: "A'ja Wilson", line: 22.5, quotes: tight, id: "15261430", league: "WNBA" })],
    });
    const pick = report.picks[0];
    assert.ok(pick);
    const html = renderDailyPicksHtml({
      picks: [pick],
      generatedAtLabel: "Fri, Oct 9, 10:00 AM",
      ogImageUrl: "https://cdn.example/picks/daily/card.jpg",
      pageUrl: "https://dropflow.us/picks/daily",
    });
    assert.match(html, /A&#39;ja Wilson Over 22.5 Points/);
    assert.match(html, /69%/);
    assert.match(html, /og:image/);
    assert.match(html, /Open this prop/);
    assert.match(html, /league_id=3/);
    const card = await renderDailyShareCard({ picks: [pick], dateLabel: "Fri, Oct 9, 10:00 AM" });
    assert.ok(card.length > 1000);
    assert.equal(card[0], 0xff);
    assert.equal(card[1], 0xd8);
    const full = Array.from({ length: 8 }, (_, index) => ({
      ...pick,
      rank: index + 1,
      player: index === 7 ? "Mark Scheifele" : pick.player,
      stat: index === 4 ? "Pass TDs" : pick.stat,
      line: index === 4 ? 1.5 : pick.line,
    }));
    const fullHtml = renderDailyPicksHtml({ picks: full, generatedAtLabel: "Fri, Oct 9, 11:33 AM" });
    assert.match(fullHtml, /Mark Scheifele/);
    assert.match(fullHtml, /Pass TDs/);
    assert.equal(fullHtml.match(/class="chance"/g)?.length, 8);
    assert.doesNotMatch(fullHtml, /more/);
    const fullCard = await renderDailyShareCard({ picks: full, dateLabel: "Fri, Oct 9, 11:33 AM" });
    const meta = await sharp(fullCard).metadata();
    assert.ok((meta.height ?? 0) > 630);
  });

  it("scores top ranks without treating a short sample as proof", () => {
    const scored = scoreSettlements([
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
        rank: 1,
        evidenceQuality: "high",
      },
      {
        propId: "b",
        sport: "NHL",
        stat: "Shots",
        oddsType: "standard",
        probability: 60,
        hit: 0,
        modelVersion: "market-median-v1",
        predictedAt: "2026-10-01T12:00:00.000Z",
        settledAt: "2026-10-02T03:00:00.000Z",
        closingLine: 2.5,
        rank: 2,
        evidenceQuality: "moderate",
      },
    ]);
    assert.equal(scored.meaningful, false);
    assert.equal(scored.top.top1.hits, 1);
    assert.equal(scored.top.top1.sampleSize, 1);
    assert.equal(scored.roi, null);
  });
});

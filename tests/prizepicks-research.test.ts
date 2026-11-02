import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { diffSnapshots, toSnapshot, type OddsSnapshot } from "../src/lib/prizepicks-odds/snapshots";
import { evaluateProp, type ScanPropInput } from "../src/lib/prizepicks-odds/evaluate";
import { alternateMarket } from "../src/lib/prizepicks-odds/markets";
import { interpolateOver } from "../src/lib/prizepicks-odds/interpolate";
import { validateEvidence, researchDecision } from "../src/lib/prizepicks-odds/evidence";
import { applyFinding, parseResearch, researchShortlist, selectResearchTargets } from "../src/lib/prizepicks-odds/research";
import { payoutBookFromJson, UNVERIFIED_PAYOUTS } from "../src/lib/prizepicks-odds/payouts";
import { canSettleMarket, gradeStat, parseSummary, playerStat } from "../src/lib/prizepicks-odds/espn-boxscore";
import { mergeSettlements, rowFromActual, settleStoredSnapshots } from "../src/lib/prizepicks-odds/settle";
import { runPrizePicksOddsCli } from "../src/lib/prizepicks-odds/run";
import type { BookQuote, PointQuote } from "../src/lib/prizepicks-odds/consensus";

const favorite: BookQuote[] = [
  { book: "draftkings", overPrice: -300, underPrice: 210 },
  { book: "fanduel", overPrice: -290, underPrice: 200 },
];

const coin: BookQuote[] = [
  { book: "draftkings", overPrice: -110, underPrice: -110 },
  { book: "fanduel", overPrice: -115, underPrice: -105 },
];

function point(rows: BookQuote[], line: number): PointQuote[] {
  return rows.map((row) => ({ ...row, point: line }));
}

function input(partial: Partial<ScanPropInput> & Pick<ScanPropInput, "playerName" | "line">): ScanPropInput {
  return {
    id: partial.playerName,
    team: "Las Vegas Aces",
    opponent: "New York Liberty",
    league: "NBA",
    stat: "Points",
    market: "player_points",
    oddsType: "standard",
    startTime: "2026-10-09T23:00:00.000Z",
    gameId: "game-1",
    quotes: [],
    otherLines: [],
    ...partial,
  };
}

describe("alternate lines and interpolation", () => {
  it("maps only documented alternate markets", () => {
    assert.equal(alternateMarket("NBA", "player_points"), "player_points_alternate");
    assert.equal(alternateMarket("WNBA", "player_rebounds"), "player_rebounds_alternate");
    assert.equal(alternateMarket("NCAAB", "player_points"), null);
    assert.equal(alternateMarket("NCAAF", "player_pass_yds"), null);
    assert.equal(alternateMarket("MLB", "pitcher_strikeouts"), "pitcher_strikeouts_alternate");
  });

  it("interpolates inside a two-point bracket and refuses extrapolation", () => {
    const quotes = [...point(favorite, 21.5), ...point(coin, 23.5)];
    const mid = interpolateOver(quotes, 22.5);
    assert.ok(mid);
    assert.equal(mid?.lower, 21.5);
    assert.equal(mid?.upper, 23.5);
    assert.ok((mid?.overProbability ?? 0) > 0.5);
    assert.ok((mid?.overProbability ?? 1) < 0.8);
    assert.equal(interpolateOver(quotes, 24.5), null);
    assert.equal(interpolateOver([...point(favorite, 18.5), ...point(coin, 22.5)], 20.5), null);
    const priced = evaluateProp(
      input({ playerName: "Bracket", line: 22.5, quotes: [], otherLines: quotes }),
      "2026-10-09T15:00:00.000Z"
    );
    assert.equal(priced.probabilitySource, "interpolated");
    assert.equal(priced.modelProbability, null);
    assert.notEqual(priced.modelVersion, "market-median-v1");
  });

  it("does not turn a stale quote into a ranking", () => {
    const stale = favorite.map((row) => ({ ...row, lastUpdate: "2026-10-01T00:00:00.000Z" }));
    const prop = evaluateProp(
      input({ playerName: "Stale", line: 22.5, quotes: stale }),
      "2026-10-09T15:00:00.000Z"
    );
    assert.ok(prop.rejectionReasons.includes("stale_quote"));
    assert.equal(prop.marketProbability, null);
  });

  it("requires two timestamped snapshots before calling a move", () => {
    const priced = evaluateProp(input({ playerName: "One", line: 22.5, quotes: favorite }), "2026-10-09T15:00:00.000Z");
    const next = toSnapshot({
      generatedAt: "2026-10-09T15:00:00.000Z",
      modelVersion: "market-median-v1",
      creditsSpent: 1,
      remaining: 1,
      props: [{ ...priced, marketProbability: 80 }],
    });
    const unordered: OddsSnapshot = { ...next, generatedAt: "2026-10-09T16:00:00.000Z" };
    assert.deepEqual(diffSnapshots(unordered, next), []);
  });
});

describe("grok research gates", () => {
  it("parses the research schema and ignores a missing prop shape", () => {
    const parsed = parseResearch(
      {
        availability: { status: "questionable", evidence: [{ sourceUrl: "https://www.nba.com/news", publisher: "NBA", publishedAt: "2026-10-09T12:00:00.000Z", claim: "listed questionable" }] },
        injuryImpact: { summary: "ankle", relevant: true, evidence: [] },
        playingTime: { summary: "", restrictionsReported: null, evidence: [] },
        matchup: { summary: "", relevantFactors: [], evidence: [] },
        marketExplanation: { summary: "monitor", possibleCauses: [], evidence: [] },
        risks: ["ankle"],
        confidence: "low",
      },
      "prop-1"
    );
    assert.equal(parsed?.availability.status, "questionable");
    assert.equal(parsed?.confidence, "low");
    assert.equal(parseResearch({ availability: { status: "maybe" } }, "prop-1"), null);
  });

  it("rejects a verified scratch and leaves an unverified rumor unchanged", () => {
    const evidence = validateEvidence({
      evidence: {
        sourceUrl: "https://www.nba.com/news/wilson-out",
        publisher: "NBA",
        publishedAt: "2026-10-09T12:00:00.000Z",
        claim: "Wilson ruled out tonight",
        verificationStatus: "unverified",
      },
      playerName: "A'ja Wilson",
      eventStart: "2026-10-09T23:00:00.000Z",
      pageText: "A'ja Wilson ruled out tonight with an ankle injury.",
    });
    assert.equal(evidence.verificationStatus, "verified");
    const decision = researchDecision({
      availability: "out",
      evidence: [evidence],
      restrictionsReported: false,
      eventStart: "2026-10-09T23:00:00.000Z",
    });
    assert.equal(decision.rejectUnavailable, true);
    const rumor = validateEvidence({
      evidence: {
        sourceUrl: "https://x.com/someone/status/1",
        publisher: "X",
        publishedAt: "2026-10-09T12:00:00.000Z",
        claim: "Wilson might be hurt",
        verificationStatus: "unverified",
      },
      playerName: "A'ja Wilson",
      eventStart: "2026-10-09T23:00:00.000Z",
      pageText: "Wilson might be hurt",
    });
    assert.equal(rumor.verificationStatus, "unverified");
    const base = evaluateProp(input({ playerName: "A'ja Wilson", line: 22.5, quotes: favorite }), "2026-10-09T15:00:00.000Z");
    const kept = applyFinding(base, {
      status: "failed",
      reason: "grok_timeout",
    });
    assert.equal(kept.marketProbability, base.marketProbability);
    assert.ok(kept.researchFlags.includes("research_unavailable"));
  });

  it("stops when the grok dollar budget is exhausted", async () => {
    const base = evaluateProp(input({ playerName: "A'ja Wilson", line: 22.5, quotes: favorite }), "2026-10-09T15:00:00.000Z");
    const other = evaluateProp(
      input({ playerName: "Breanna Stewart", line: 18.5, quotes: coin, gameId: "game-2" }),
      "2026-10-09T15:00:00.000Z"
    );
    const targets = selectResearchTargets([base, other], 5, 10);
    let calls = 0;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-cache-"));
    const result = await researchShortlist(targets, {
      maxSpend: 1,
      usdPerCall: 1,
      cacheDir: dir,
      call: async () => {
        calls += 1;
        return {
          model: "test",
          text: "{}",
          parsed: {
            availability: { status: "unknown", evidence: [] },
            confidence: "unknown",
            risks: [],
          },
        };
      },
    });
    assert.equal(calls, 1);
    assert.ok(Object.values(result.findings).some((row) => row.status === "failed" && row.reason === "grok_budget"));
  });
});

describe("payouts, entries, and settlement", () => {
  it("accepts only a sourced payout book", () => {
    assert.equal(payoutBookFromJson({ verified: true, provenance: "notes", rules: [] }).verified, false);
    const book = payoutBookFromJson({
      verified: true,
      provenance: "https://example.com/payouts",
      rules: [
        {
          id: "operator",
          effectiveFrom: "2026-10-01",
          provenance: "https://example.com/payouts",
          verified: true,
          legs: 2,
          allowsDemon: false,
          allowsGoblin: false,
          tiers: [{ hits: 2, multiplier: 3 }],
        },
      ],
    });
    assert.equal(book.verified, true);
    assert.equal(UNVERIFIED_PAYOUTS.verified, false);
  });

  it("grades a basketball box score and leaves baseball unsettled", () => {
    assert.equal(canSettleMarket("MLB", "batter_hits"), false);
    assert.equal(canSettleMarket("NBA", "player_points"), true);
    const box = parseSummary(
      {
        header: { competitions: [{ status: { type: { completed: true } } }] },
        boxscore: {
          players: [
            {
              team: { displayName: "Las Vegas Aces" },
              statistics: [
                {
                  names: ["MIN", "PTS", "REB", "3PT"],
                  athletes: [{ athlete: { displayName: "A'ja Wilson" }, stats: ["32", "24", "10", "2-5"] }],
                },
              ],
            },
          ],
        },
      },
      "NBA"
    );
    assert.equal(playerStat(box!, "A'ja Wilson", "player_points"), 24);
    assert.equal(playerStat(box!, "A'ja Wilson", "player_threes"), 2);
    assert.equal(playerStat(box!, "Someone Else", "player_points"), null);
    assert.equal(gradeStat("over", 22.5, 24), "win");
    assert.equal(gradeStat("over", 22, 22), "push");
    const leg = {
      id: "leg-1",
      sport: "NBA",
      label: "A'ja Wilson Over 22.5 Points",
      line: 22.5,
      side: "over" as const,
      marketProbability: 69,
      modelVersion: "market-median-v1",
      sourceTimestamp: "2026-10-09T15:00:00.000Z",
      playerName: "A'ja Wilson",
      stat: "Points",
      market: "player_points",
      startTime: "2026-10-09T23:00:00.000Z",
      probabilitySource: "direct" as const,
    };
    const row = rowFromActual({ leg, predictedAt: "2026-10-09T15:00:00.000Z", actual: 24, settledAt: "2026-10-10T03:00:00.000Z" });
    assert.equal(row?.hit, 1);
    assert.equal(rowFromActual({ leg, predictedAt: "2026-10-10T01:00:00.000Z", actual: 24, settledAt: "2026-10-10T03:00:00.000Z" }), null);
    const merged = mergeSettlements([row!], [row!]);
    assert.equal(merged.length, 1);
  });

  it("writes a settlement once from a fixture scoreboard", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odds-settle-"));
    const file = path.join(dir, "settlements.json");
    const snapshot: OddsSnapshot = {
      generatedAt: "2026-10-09T15:00:00.000Z",
      modelVersion: "market-median-v1",
      creditsSpent: 0,
      remaining: null,
      legs: [
        {
          id: "leg-1",
          sport: "NBA",
          label: "A'ja Wilson Over 22.5 Points",
          line: 22.5,
          side: "over",
          marketProbability: 69,
          modelVersion: "market-median-v1",
          sourceTimestamp: "2026-10-09T15:00:00.000Z",
          playerName: "A'ja Wilson",
          team: "Las Vegas Aces",
          opponent: "New York Liberty",
          stat: "Points",
          market: "player_points",
          startTime: "2026-10-09T23:00:00.000Z",
          probabilitySource: "direct",
        },
      ],
    };
    fs.writeFileSync(path.join(dir, "2026-10-09.json"), JSON.stringify(snapshot));
    const fetchImpl = async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("scoreboard")) {
        return new Response(
          JSON.stringify({
            events: [
              {
                id: "401",
                name: "Las Vegas Aces at New York Liberty",
                competitions: [
                  {
                    status: { type: { completed: true } },
                    competitors: [
                      { team: { displayName: "Las Vegas Aces" } },
                      { team: { displayName: "New York Liberty" } },
                    ],
                  },
                ],
              },
            ],
          })
        );
      }
      return new Response(
        JSON.stringify({
          header: { competitions: [{ status: { type: { completed: true } } }] },
          boxscore: {
            players: [
              {
                team: { displayName: "Las Vegas Aces" },
                statistics: [{ names: ["PTS"], athletes: [{ athlete: { displayName: "A'ja Wilson" }, stats: ["24"] }] }],
              },
            ],
          },
        })
      );
    };
    const first = await settleStoredSnapshots({
      dir,
      file,
      nowIso: "2026-10-10T04:00:00.000Z",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const second = await settleStoredSnapshots({
      dir,
      file,
      nowIso: "2026-10-10T05:00:00.000Z",
      fetchImpl: fetchImpl as typeof fetch,
    });
    assert.equal(first.added, 1);
    assert.equal(second.added, 0);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).length, 1);
  });
});

describe("cli mode guard", () => {
  it("rejects an unknown mode before any provider call", async () => {
    await assert.rejects(() => runPrizePicksOddsCli({ mode: "sideways" as "daily" }), /mode must be/);
  });
});

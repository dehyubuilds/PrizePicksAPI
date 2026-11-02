import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import type { PrizePicksProjection } from "../src/lib/prizepicks/types";
import type { OddsResponse } from "../src/lib/prizepicks-odds/client";
import { findPlayerProps, indexBoard } from "../src/lib/prizepicks-news/board";
import { dedupeNewsEvents, discoveryTasks, parseDiscoveredEvents } from "../src/lib/prizepicks-news/discover";
import { emptyFunnel, renderNewsMarkdown, writeNewsReport } from "../src/lib/prizepicks-news/report";
import { annotateCandidate, buildShortlist, groupBoard, mergeCandidates, priceMarketProp, selectGroups } from "../src/lib/prizepicks-news/market-discover";
import { parseNewsArgs, researchAttempt, runPrizePicksNews } from "../src/lib/prizepicks-news/run";
import { priceIntegerFromAdjacent } from "../src/lib/prizepicks-news/integer-price";
import { newsMarketForStat, resolveNewsSports } from "../src/lib/prizepicks-news/scope";
import { assignSoccerSportKeys, soccerEventMatches } from "../src/lib/prizepicks-news/soccer";
import { decideVerdict } from "../src/lib/prizepicks-news/verdict";
import type { IndexedProp, NewsEvent, NewsReport } from "../src/lib/prizepicks-news/types";

const now = "2026-10-10T18:00:00.000Z";
const start = "2026-10-10T23:00:00.000Z";
const freshQuote = "2026-10-10T17:40:00.000Z";

function prop(partial: Partial<PrizePicksProjection> & Pick<PrizePicksProjection, "playerName" | "statDisplayName" | "leagueName">): PrizePicksProjection {
  return {
    id: partial.playerName,
    team: "Atlanta",
    opponent: "New York",
    leagueId: partial.leagueName === "MLB" ? "2" : partial.leagueName === "NFL" ? "9" : "3",
    statType: partial.statDisplayName,
    lineScore: 6.5,
    oddsType: "standard",
    startTime: start,
    gameId: "g1",
    status: "pre_game",
    ...partial,
  };
}

function event(partial: Partial<NewsEvent> = {}): NewsEvent {
  return {
    id: "e1",
    sport: "WNBA",
    teamIds: ["Atlanta"],
    playerIds: ["A'ja Wilson"],
    eventType: "injury",
    summary: "A starter is out.",
    direction: "down",
    evidenceStatus: "official",
    sources: [{ url: "https://www.wnba.com/news/starter-out", author: "WNBA", publishedAt: "2026-10-10T16:00:00.000Z" }],
    sourceUrls: ["https://www.wnba.com/news/starter-out"],
    publishedAt: "2026-10-10T16:00:00.000Z",
    discoveredAt: now,
    roleChange: false,
    ...partial,
  };
}

function indexed(partial: Partial<IndexedProp> = {}): IndexedProp {
  return {
    projectionId: "p1",
    sport: "WNBA",
    player: "A'ja Wilson",
    playerKey: "aja wilson",
    team: "Atlanta",
    opponent: "New York",
    gameId: "g1",
    market: "player_rebounds",
    stat: "Rebounds",
    line: 10.5,
    oddsType: "standard",
    startTime: start,
    ...partial,
  };
}

const tight = [
  { book: "draftkings", overPrice: -150, underPrice: 130, lastUpdate: freshQuote },
  { book: "fanduel", overPrice: -140, underPrice: 120, lastUpdate: freshQuote },
];

function oddsResponse(json: unknown, cost = 1): OddsResponse {
  return { json, remaining: 100, used: 1, lastCost: cost, fromCache: false };
}

describe("prizepicks news", () => {
  it("rejects sports outside MLB, WNBA, and NFL", () => {
    assert.deepEqual(resolveNewsSports(), ["MLB", "WNBA", "NFL"]);
    assert.deepEqual(resolveNewsSports(["SOCCER"]), ["SOCCER"]);
    assert.throws(() => resolveNewsSports(["NBA"]), /MLB, WNBA, and NFL/);
    assert.throws(() => resolveNewsSports(["NHL"]), /Rejected: NHL/);
  });

  it("prices soccer shots, shots on target, and assists only", () => {
    assert.equal(newsMarketForStat("SOCCER", "SOT", "SOT").market, "player_shots_on_target");
    assert.equal(newsMarketForStat("SOCCER", "Shots", "Shots").market, "player_shots");
    assert.equal(newsMarketForStat("SOCCER", "Assists", "Assists").market, "player_assists");
    assert.equal(newsMarketForStat("SOCCER", "Goals", "Goals").market, null);
    assert.equal(newsMarketForStat("SOCCER", "Goal + Assist", "Goal + Assist").market, null);
    const board = indexBoard(
      [
        prop({ playerName: "Mo Salah", statDisplayName: "Shots", leagueName: "EPL", leagueId: "14", team: "Liverpool FC", opponent: "Man City" }),
        prop({ playerName: "Combo Side", statDisplayName: "Shots", leagueName: "SOCCER", leagueId: "82", team: "Pumas/Cruz Azul", opponent: "Cruz Azul/Pumas" }),
        prop({ playerName: "Tackler", statDisplayName: "Tackles", leagueName: "SOCCER", leagueId: "82", team: "AC Milan", opponent: "Sassuolo" }),
      ],
      ["SOCCER"],
      now
    );
    assert.equal(board.props.length, 1);
    assert.equal(board.props[0]?.oddsSportKey, "soccer_epl");
    assert.equal(
      soccerEventMatches({ team: "Liverpool FC", opponent: "Man City", home: "Liverpool", away: "Manchester City" }),
      true
    );
    const assigned = assignSoccerSportKeys(
      [indexed({ sport: "SOCCER", team: "AC Milan", opponent: "Sassuolo", gameId: "milan", oddsSportKey: undefined })],
      new Map([["soccer_italy_serie_a", [{ id: "e", home_team: "AC Milan", away_team: "Sassuolo", commence_time: start }]]])
    );
    assert.equal(assigned[0]?.oddsSportKey, "soccer_italy_serie_a");
  });

  it("keeps MLB on pitcher strikeouts and allows WNBA and NFL props", () => {
    assert.deepEqual(newsMarketForStat("MLB", "Strikeouts", "Strikeouts"), { market: "pitcher_strikeouts", rejectedMlb: false });
    assert.equal(newsMarketForStat("MLB", "Hits", "Hits").rejectedMlb, true);
    assert.equal(newsMarketForStat("MLB", "Hitter Ks", "Hitter Strikeouts").market, null);
    const boardProps = indexBoard(
      [prop({ playerName: "Kyler Murray", statDisplayName: "Rushing Yards", leagueName: "NFL", team: "Arizona", opponent: "Minnesota" })],
      ["NFL"],
      now
    ).props;
    assert.equal(findPlayerProps(boardProps, "NFL", "Eric Murray").length, 0);
    assert.equal(findPlayerProps(boardProps, "NFL", "Kyler Murray").length, 1);
    assert.equal(newsMarketForStat("MLB", "Total Bases", "Total Bases").market, null);
    assert.equal(newsMarketForStat("WNBA", "Rebounds", "Rebounds").market, "player_rebounds");
    assert.equal(newsMarketForStat("NFL", "Receptions", "Receptions").market, "player_receptions");
    assert.equal(newsMarketForStat("NFL", "Rushing Attempts", "Rushing Attempts").market, "player_rush_attempts");
    const board = indexBoard(
      [
        prop({ playerName: "Tarik Skubal", statDisplayName: "Strikeouts", leagueName: "MLB" }),
        prop({ playerName: "Steven Kwan", statDisplayName: "Hits", leagueName: "MLB" }),
        prop({ playerName: "A'ja Wilson", statDisplayName: "Rebounds", leagueName: "WNBA" }),
        prop({ playerName: "CeeDee Lamb", statDisplayName: "Receptions", leagueName: "NFL", team: "Dallas", opponent: "Philadelphia" }),
        prop({ playerName: "Connor McDavid", statDisplayName: "Assists", leagueName: "NHL", leagueId: "8" }),
      ],
      ["MLB", "WNBA", "NFL"],
      now
    );
    assert.equal(board.rejectedMlb, 1);
    assert.deepEqual(board.props.map((row) => row.player).sort(), ["A'ja Wilson", "CeeDee Lamb", "Tarik Skubal"]);
  });

  it("dedupes reposts and keeps a contradiction", () => {
    const parsed = parseDiscoveredEvents(
      {
        events: [
          {
            eventType: "injury",
            summary: "Starter is out.",
            players: ["A'ja Wilson"],
            teams: ["Atlanta"],
            direction: "down",
            sources: [{ url: "https://www.espn.com/wnba/story/1", author: "ESPN", publishedAt: "2026-10-10T16:00:00.000Z" }],
          },
          {
            eventType: "injury",
            summary: "Starter is out.",
            players: ["A'ja Wilson"],
            teams: ["Atlanta"],
            direction: "down",
            sources: [{ url: "https://www.nytimes.com/2026/10/10/sports/wilson.html", author: "NYT", publishedAt: "2026-10-10T16:05:00.000Z" }],
          },
        ],
      },
      "WNBA",
      now
    );
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.evidenceStatus, "corroborated");
    assert.equal(parsed[0]?.sourceUrls.length, 2);
    const fight = dedupeNewsEvents(
      [
        {
          direction: "up",
          event: {
            sport: "WNBA",
            teamIds: ["Atlanta"],
            playerIds: ["A'ja Wilson"],
            eventType: "injury",
            summary: "Starter is out.",
            direction: "up",
            sources: [{ url: "https://www.wnba.com/news/starter-out", author: "WNBA", publishedAt: "2026-10-10T16:00:00.000Z" }],
            sourceUrls: ["https://www.wnba.com/news/starter-out"],
            publishedAt: "2026-10-10T16:00:00.000Z",
            discoveredAt: now,
            roleChange: false,
          },
        },
        {
          direction: "down",
          event: {
            sport: "WNBA",
            teamIds: ["Atlanta"],
            playerIds: ["A'ja Wilson"],
            eventType: "injury",
            summary: "She is playing.",
            direction: "down",
            sources: [{ url: "https://www.espn.com/wnba/story/playing", author: "ESPN", publishedAt: "2026-10-10T16:10:00.000Z" }],
            sourceUrls: ["https://www.espn.com/wnba/story/playing"],
            publishedAt: "2026-10-10T16:10:00.000Z",
            discoveredAt: now,
            roleChange: false,
          },
        },
      ],
      now
    );
    assert.equal(fight.length, 1);
    assert.equal(fight[0]?.evidenceStatus, "contradicted");
  });

  it("does not turn a role change into a flipped side", () => {
    const decision = decideVerdict({
      now,
      event: event({ eventType: "workload_limit", roleChange: true, sport: "MLB", playerIds: ["Tarik Skubal"] }),
      prop: indexed({ sport: "MLB", market: "pitcher_strikeouts", stat: "Strikeouts", player: "Tarik Skubal" }),
      quotes: tight,
    });
    assert.equal(decision.verdict, "needs_verification");
    assert.match(decision.risks.join(" "), /not reversed/);
    assert.notEqual(decision.estimate?.side, "down");
  });

  it("labels fresh official news as a market chance and old news as already adjusted", () => {
    const fresh = decideVerdict({ now, event: event(), prop: indexed(), quotes: tight });
    assert.equal(fresh.verdict, "supported_opportunity");
    assert.match(fresh.reason, /not expected value/);
    const old = decideVerdict({
      now,
      event: event({ publishedAt: "2026-10-10T08:00:00.000Z" }),
      prop: indexed(),
      quotes: tight,
    });
    assert.equal(old.verdict, "market_already_adjusted");
  });

  it("rejects integer lines, stale quotes, and a missing prop", () => {
    assert.equal(decideVerdict({ now, event: event(), prop: indexed({ line: 10 }), quotes: tight }).verdict, "insufficient_data");
    assert.equal(decideVerdict({ now, event: event(), prop: indexed({ line: 10 }), quotes: tight }).code, "INTEGER_PUSH_PROBABILITY_UNKNOWN");
    assert.equal(
      decideVerdict({
        now,
        event: event(),
        prop: indexed(),
        quotes: tight.map((quote) => ({ ...quote, lastUpdate: "2026-10-10T08:00:00.000Z" })),
      }).verdict,
      "invalid_market_comparison"
    );
    assert.equal(decideVerdict({ now, event: event(), prop: null, quotes: null }).reason, "No eligible PrizePicks market.");
  });

  it("runs news-first without calling odds when no prop matches", async () => {
    const calls: string[] = [];
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pp-news-"));
    const report = await withKeys(() =>
      runPrizePicksNews(
        { sports: ["MLB"], maxEvents: 5, maxOddsCredits: 40 },
        {
          now: new Date(now),
          root,
          projections: [
            prop({ playerName: "Tarik Skubal", statDisplayName: "Strikeouts", leagueName: "MLB" }),
            prop({ playerName: "Steven Kwan", statDisplayName: "Hits", leagueName: "MLB" }),
          ],
          researchSport: async () => ({
            events: [
              {
                eventType: "injury",
                summary: "Kwan is day to day.",
                players: ["Steven Kwan"],
                direction: "down",
                sources: [{ url: "https://www.mlb.com/news/kwan", author: "MLB", publishedAt: "2026-10-10T16:00:00.000Z" }],
              },
            ],
          }),
          fetchOdds: async (pathAndQuery) => {
            calls.push(pathAndQuery);
            return oddsResponse([]);
          },
        }
      )
    );
    assert.equal(calls.length, 0);
    assert.equal(report.rejected[0]?.verdict, "no_eligible_prop");
    assert.equal(report.oddsRequests, 0);
  });

  it("prices only the matched market and stops when the credit budget is zero", async () => {
    const calls: string[] = [];
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pp-news-"));
    const research = {
      events: [
        {
          eventType: "absence",
          summary: "A starter will sit.",
          players: ["A'ja Wilson"],
          teams: ["Atlanta"],
          direction: "up",
          sources: [{ url: "https://www.wnba.com/news/sit", author: "WNBA", publishedAt: "2026-10-10T17:00:00.000Z" }],
        },
      ],
    };
    const board = [prop({ playerName: "A'ja Wilson", statDisplayName: "Rebounds", leagueName: "WNBA", lineScore: 10.5 })];
    const blocked = await withKeys(() =>
      runPrizePicksNews(
        { sports: ["WNBA"], maxOddsCredits: 0 },
        { now: new Date(now), root, projections: board, researchSport: async () => research, fetchOdds: async () => oddsResponse([]) }
      )
    );
    assert.equal(blocked.oddsRequests, 0);
    assert.match(blocked.stories[0]?.reason ?? blocked.rejected[0]?.reason ?? "", /Budget exhausted/);

    const priced = await withKeys(() =>
      runPrizePicksNews(
        { sports: ["WNBA"], maxOddsCredits: 40 },
        {
          now: new Date(now),
          root: fs.mkdtempSync(path.join(os.tmpdir(), "pp-news-")),
          projections: board,
          researchSport: async () => research,
          fetchOdds: async (pathAndQuery) => {
            calls.push(pathAndQuery);
            if (pathAndQuery.includes("/odds?")) {
              return oddsResponse({
                bookmakers: [
                  {
                    key: "draftkings",
                    markets: [{ key: "player_rebounds", last_update: freshQuote, outcomes: [
                      { name: "Over", description: "A'ja Wilson", price: -150, point: 10.5 },
                      { name: "Under", description: "A'ja Wilson", price: 130, point: 10.5 },
                    ] }],
                  },
                  {
                    key: "fanduel",
                    markets: [{ key: "player_rebounds", last_update: freshQuote, outcomes: [
                      { name: "Over", description: "A'ja Wilson", price: -140, point: 10.5 },
                      { name: "Under", description: "A'ja Wilson", price: 120, point: 10.5 },
                    ] }],
                  },
                ],
              });
            }
            return oddsResponse([{ id: "ev1", home_team: "Atlanta Dream", away_team: "New York Liberty", commence_time: start }]);
          },
        }
      )
    );
    assert.equal(calls.length, 2);
    assert.match(calls[1] ?? "", /player_rebounds/);
    assert.equal(priced.stories[0]?.verdict, "supported_opportunity");
    assert.equal(priced.live, true);
    assert.ok(priced.stories[0]?.marketProbability);
  });

  it("skips paid calls for an empty slate, estimate, dry-run, and a zero Grok cap", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pp-news-"));
    let grok = 0;
    const empty = await withKeys(() =>
      runPrizePicksNews(
        { sports: ["NFL"] },
        {
          now: new Date(now),
          root,
          projections: [prop({ playerName: "CeeDee Lamb", statDisplayName: "Receptions", leagueName: "NFL", startTime: "2026-10-10T12:00:00.000Z" })],
          researchSport: async () => {
            grok += 1;
            return { events: [] };
          },
        }
      )
    );
    assert.equal(empty.eligibleGames, 0);
    assert.equal(grok, 0);

    const estimate = await runPrizePicksNews(
      { estimate: true, sports: ["WNBA"] },
      { now: new Date(now), write: false, projections: [prop({ playerName: "A'ja Wilson", statDisplayName: "Rebounds", leagueName: "WNBA" })] }
    );
    assert.equal(estimate.mode, "estimate");
    assert.equal(estimate.grokCalls, 0);
    assert.equal(estimate.eligibleGames, 1);

    const dry = await runPrizePicksNews({ dryRun: true }, { now: new Date(now), write: false, projections: [] });
    assert.equal(dry.mode, "dry-run");
    assert.equal(dry.live, false);

    await withKeys(() =>
      runPrizePicksNews(
        { sports: ["WNBA"], maxGrokSpend: 0 },
        {
          now: new Date(now),
          root: fs.mkdtempSync(path.join(os.tmpdir(), "pp-news-")),
          projections: [prop({ playerName: "A'ja Wilson", statDisplayName: "Rebounds", leagueName: "WNBA" })],
          researchSport: async () => {
            grok += 1;
            return { events: [] };
          },
        }
      )
    );
    assert.equal(grok, 0);
  });

  it("fails clearly when live credentials are missing and writes both reports", async () => {
    const previous = {
      XAI_API_KEY: process.env.XAI_API_KEY,
      GROK_API_KEY: process.env.GROK_API_KEY,
      DROPFLOW_XAI_API_KEY: process.env.DROPFLOW_XAI_API_KEY,
      THE_ODDS_API_KEY: process.env.THE_ODDS_API_KEY,
    };
    delete process.env.XAI_API_KEY;
    delete process.env.GROK_API_KEY;
    delete process.env.DROPFLOW_XAI_API_KEY;
    delete process.env.THE_ODDS_API_KEY;
    await assert.rejects(() => runPrizePicksNews({ sports: ["MLB"] }, { projections: [], write: false }), /XAI_API_KEY/);
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    const report: NewsReport = {
      startedAt: now,
      endedAt: now,
      mode: "live",
      live: true,
      sportsChecked: ["WNBA"],
      eligibleGames: 1,
      sourcesQueried: ["@WNBA"],
      newsEventsDiscovered: 1,
      uniqueEvents: 1,
      affectedPlayers: 1,
      propsMatched: 1,
      oddsRequests: 1,
      oddsCredits: 2,
      grokCalls: 1,
      grokCostUsd: null,
      budgetNote: "capped",
      funnel: emptyFunnel({ eligibleGames: 1 }),
      stories: [],
      rejected: [],
    };
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pp-news-"));
    const paths = writeNewsReport(report, [{ id: "e1" }], root);
    const saved = JSON.parse(fs.readFileSync(paths.jsonPath, "utf8")) as NewsReport;
    assert.equal(saved.grokCalls, 1);
    assert.match(renderNewsMarkdown(report), /did not call Grok|uses live source/);
    assert.match(fs.readFileSync(paths.mdPath, "utf8"), /Run summary/);
    assert.match(fs.readFileSync(path.join(root, "events.jsonl"), "utf8"), /e1/);
  });

  it("prices an integer strikeout line from the surrounding half points", () => {
    const low = [
      { book: "draftkings", overPrice: -150, underPrice: 130, lastUpdate: freshQuote },
      { book: "fanduel", overPrice: -140, underPrice: 120, lastUpdate: freshQuote },
    ];
    const high = [
      { book: "draftkings", overPrice: 120, underPrice: -140, lastUpdate: freshQuote },
      { book: "fanduel", overPrice: 110, underPrice: -130, lastUpdate: freshQuote },
    ];
    const priced = priceIntegerFromAdjacent(7, low, high);
    assert.ok("pLessWin" in priced);
    if (!("pLessWin" in priced)) return;
    assert.ok(Math.abs(priced.pLessWin + priced.pPush + priced.pMoreWin - 1) < 0.02);
    assert.ok(priced.pPush >= 0);
    const decision = decideVerdict({
      now,
      event: event({ sport: "MLB", playerIds: ["Tarik Skubal"], publishedAt: "2026-10-10T17:30:00.000Z", sources: [{ url: "https://www.mlb.com/news/starter", author: "MLB", publishedAt: "2026-10-10T17:30:00.000Z" }], sourceUrls: ["https://www.mlb.com/news/starter"] }),
      prop: indexed({ sport: "MLB", market: "pitcher_strikeouts", stat: "Ks", line: 7, player: "Tarik Skubal" }),
      quotes: null,
      adjacentLow: low,
      adjacentHigh: high,
    });
    assert.equal(decision.verdict, "supported_opportunity");
    assert.equal(decision.pricingMethod, "adjacent_half_points");
    const swapped = priceIntegerFromAdjacent(7, high, low);
    assert.equal("code" in swapped ? swapped.code : "", "INCONSISTENT_ALT_LINES");
    assert.equal(decideVerdict({ now, event: event(), prop: indexed({ line: 16, sport: "WNBA" }), quotes: null, adjacentLow: [], adjacentHigh: [] }).code, "NO_COMPATIBLE_ALT_LINES");
  });

  it("keeps partial NFL results when one search times out", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pp-news-"));
    let calls = 0;
    const report = await withKeys(() =>
      runPrizePicksNews(
        { sports: ["NFL"], maxEvents: 5, verbose: true },
        {
          now: new Date(now),
          root,
          projections: [prop({ playerName: "CeeDee Lamb", statDisplayName: "Receptions", leagueName: "NFL", team: "Dallas", opponent: "Philadelphia", lineScore: 6.5 })],
          researchSport: async () => {
            calls += 1;
            if (calls === 1) {
              const error = new Error("The operation was aborted due to timeout");
              error.name = "TimeoutError";
              throw error;
            }
            return { events: [] };
          },
          fetchOdds: async () => oddsResponse([]),
        }
      )
    );
    assert.equal(discoveryTasks("NFL").length, 4);
    assert.ok(calls >= 2);
    assert.ok(report.funnel.newsSearchesTimedOut >= 1);
    assert.ok(report.funnel.newsSearchesCompleted >= 1);
    assert.equal(report.grokCalls >= 2, true);
  });

  it("retries a timeout as a shorter web-only search", () => {
    const first = researchAttempt(0);
    const retry = researchAttempt(1);
    assert.equal(first.maxTurns, 2);
    assert.deepEqual(first.tools.map((tool) => tool.type), ["web_search", "x_search"]);
    assert.equal(retry.maxTurns, 1);
    assert.deepEqual(retry.tools, [{ type: "web_search" }]);
    assert.ok(retry.gameLimit < first.gameLimit);
    assert.ok(retry.timeoutMs < first.timeoutMs);
  });

  it("prices a market-only prop without news and does not invent edge", () => {
    const row = priceMarketProp(indexed(), tight, null, null, now);
    assert.equal(row.discoveryMethod, "MARKET");
    assert.equal(row.tier, "B");
    assert.equal(row.edgeStatus, "UNVERIFIED_PAYOUT");
    assert.equal(row.estimatedEdge, null);
    assert.equal(row.entryExpectedValue, null);
    assert.match(row.summary, /no material news/i);
    assert.ok(row.marketProbability);
    const weak = priceMarketProp(indexed({ line: 10.5, player: "Other" }), [{ book: "draftkings", overPrice: 100, underPrice: -120, lastUpdate: freshQuote }], null, null, now);
    assert.notEqual(weak.tier, "A");
  });

  it("keeps MLB strikeouts ahead of other markets and batches one request per game", () => {
    const props = [
      indexed({ sport: "MLB", market: "pitcher_strikeouts", stat: "Ks", gameId: "mlb", player: "Tarik Skubal", startTime: "2026-10-11T20:00:00.000Z" }),
      indexed({ sport: "WNBA", market: "player_points", stat: "Points", gameId: "wnba", player: "A'ja Wilson", startTime: "2026-10-12T00:00:00.000Z" }),
      indexed({ sport: "WNBA", market: "player_rebounds", stat: "Rebounds", gameId: "wnba", player: "A'ja Wilson", projectionId: "p2", startTime: "2026-10-12T00:00:00.000Z" }),
    ];
    const groups = groupBoard(props, now);
    assert.equal(groups.length, 2);
    const picked = selectGroups(groups, { maxEvents: 1, maxRequests: 20, creditsUsed: 0, maxCredits: 40 });
    assert.equal(picked.chosen[0]?.sportKey, "baseball_mlb");
    assert.equal(picked.chosen.length, 1);
    const both = selectGroups(groups, { maxEvents: 10, maxRequests: 20, creditsUsed: 0, maxCredits: 40 });
    const wnba = both.chosen.find((group) => group.gameId === "wnba");
    assert.ok(wnba && wnba.markets.includes("player_rebounds") && wnba.markets.includes("player_points"));
    const blocked = selectGroups(groups, { maxEvents: 10, maxRequests: 20, creditsUsed: 0, maxCredits: 0 });
    assert.equal(blocked.chosen.length, 0);
    assert.equal(blocked.truncated, true);
  });

  it("merges the same prop from news and the market scan once", () => {
    const news = annotateCandidate({
      ...priceMarketProp(indexed(), tight, null, null, now),
      discoveryMethod: "NEWS",
      eventId: "e1",
      summary: "A starter is out.",
      sourceUrls: ["https://www.wnba.com/news/starter-out"],
      evidenceStatus: "official",
    });
    const market = priceMarketProp(indexed(), tight, null, null, now);
    const merged = mergeCandidates([news, market]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.discoveryMethod, "BOTH");
    assert.match(merged[0]?.summary ?? "", /starter is out/);
    const shortlist = buildShortlist(merged.map((row) => annotateCandidate(row)), 5);
    assert.equal(shortlist.length, 1);
    assert.notEqual(shortlist[0]?.tier, "A");
  });

  it("runs market mode without Grok and keeps a no-news candidate", async () => {
    let grok = 0;
    const calls: string[] = [];
    const report = await withKeys(() =>
      runPrizePicksNews(
        { sports: ["WNBA", "MLB"], discoveryMode: "market", maxMarketEvents: 2, maxOddsCredits: 10, targetPicks: 5 },
        {
          now: new Date(now),
          write: false,
          projections: [
            prop({ playerName: "A'ja Wilson", statDisplayName: "Rebounds", leagueName: "WNBA", lineScore: 10.5 }),
            prop({ playerName: "Tarik Skubal", statDisplayName: "Hits", leagueName: "MLB", lineScore: 1.5, gameId: "mlb" }),
            prop({ playerName: "Tarik Skubal", statDisplayName: "Strikeouts", leagueName: "MLB", lineScore: 6.5, gameId: "mlb" }),
          ],
          researchSport: async () => {
            grok += 1;
            return { events: [] };
          },
          fetchOdds: async (pathAndQuery) => {
            calls.push(pathAndQuery);
            if (pathAndQuery.includes("/odds?")) {
              return oddsResponse({
                bookmakers: ["draftkings", "fanduel"].map((key) => ({
                  key,
                  markets: [
                    { key: "player_rebounds", last_update: freshQuote, outcomes: [
                      { name: "Over", description: "A'ja Wilson", price: -150, point: 10.5 },
                      { name: "Under", description: "A'ja Wilson", price: 130, point: 10.5 },
                    ] },
                    { key: "pitcher_strikeouts", last_update: freshQuote, outcomes: [
                      { name: "Over", description: "Tarik Skubal", price: -130, point: 6.5 },
                      { name: "Under", description: "Tarik Skubal", price: 110, point: 6.5 },
                    ] },
                  ],
                })),
              });
            }
            if (pathAndQuery.includes("baseball_mlb")) return oddsResponse([{ id: "mlb1", home_team: "Atlanta", away_team: "New York", commence_time: start }]);
            return oddsResponse([{ id: "wnba1", home_team: "Atlanta Dream", away_team: "New York Liberty", commence_time: start }]);
          },
        }
      )
    );
    assert.equal(grok, 0);
    assert.equal(report.discoveryMode, "market");
    assert.equal(report.tierA, 0);
    assert.ok((report.tierB ?? 0) >= 1);
    assert.ok(report.stories.some((row) => row.player === "A'ja Wilson" && row.discoveryMethod === "MARKET"));
    assert.ok(report.stories.some((row) => row.player === "Tarik Skubal" && row.market === "pitcher_strikeouts"));
    assert.ok(!report.stories.some((row) => row.market !== "pitcher_strikeouts" && row.sport === "MLB"));
    assert.ok(report.shortlist?.every((row) => row.estimatedEdge == null));
    assert.ok(calls.some((call) => call.includes("/odds?")));
    const oddsCalls = calls.filter((call) => call.includes("/odds?"));
    assert.equal(oddsCalls.length, new Set(oddsCalls).size);
  });

  it("continues into the market pass when NFL news times out", async () => {
    const report = await withKeys(() =>
      runPrizePicksNews(
        { sports: ["NFL"], discoveryMode: "hybrid", minCandidates: 5, maxMarketEvents: 1, maxOddsCredits: 10 },
        {
          now: new Date(now),
          write: false,
          projections: [prop({ playerName: "CeeDee Lamb", statDisplayName: "Receptions", leagueName: "NFL", lineScore: 6.5, team: "Dallas", opponent: "Philadelphia" })],
          researchSport: async () => {
            throw new Error("The operation was aborted due to timeout");
          },
          fetchOdds: async (pathAndQuery) => {
            if (pathAndQuery.includes("/odds?")) {
              return oddsResponse({
                bookmakers: ["draftkings", "fanduel"].map((key) => ({
                  key,
                  markets: [{ key: "player_receptions", last_update: freshQuote, outcomes: [
                    { name: "Over", description: "CeeDee Lamb", price: -140, point: 6.5 },
                    { name: "Under", description: "CeeDee Lamb", price: 120, point: 6.5 },
                  ] }],
                })),
              });
            }
            return oddsResponse([{ id: "nfl1", home_team: "Dallas Cowboys", away_team: "Philadelphia Eagles", commence_time: start }]);
          },
        }
      )
    );
    assert.ok((report.funnel.newsSearchesTimedOut ?? 0) >= 1);
    assert.equal(report.tierA, 0);
    assert.ok(report.stories.some((row) => row.player === "CeeDee Lamb" && row.discoveryMethod === "MARKET"));
    assert.ok((report.oddsCredits ?? 0) > 0);
  });

  it("parses the CLI and does not wager or publish", () => {
    const parsed = parseNewsArgs(["--sport", "MLB", "--max-events", "10", "--max-odds-credits", "40", "--estimate", "--check-odds", "--verbose"]);
    assert.equal(parsed.estimate, true);
    assert.equal(parsed.checkOdds, true);
    assert.equal(parsed.verbose, true);
    assert.deepEqual(parsed.sports, ["MLB"]);
    assert.equal(parsed.maxEvents, 10);
    assert.equal(parsed.discoveryMode, "hybrid");
    assert.equal(parseNewsArgs(["--mode", "market"]).discoveryMode, "market");
    assert.equal(parseNewsArgs(["--mode", "news", "--target-picks", "5", "--always-market-pass"]).alwaysMarketPass, true);
    const source = [
      fs.readFileSync("src/lib/prizepicks-news/run.ts", "utf8"),
      fs.readFileSync("scripts/prizepicks-news.mjs", "utf8"),
    ].join("\n");
    assert.doesNotMatch(source, /publishDailyPicks|PutObjectCommand|placeOrder|submitEntry/);
  });
});

async function withKeys<T>(fn: () => Promise<T>): Promise<T> {
  const previous = {
    XAI_API_KEY: process.env.XAI_API_KEY,
    THE_ODDS_API_KEY: process.env.THE_ODDS_API_KEY,
  };
  process.env.XAI_API_KEY = process.env.XAI_API_KEY || "test-key";
  process.env.THE_ODDS_API_KEY = process.env.THE_ODDS_API_KEY || "test-key";
  try {
    return await fn();
  } finally {
    if (previous.XAI_API_KEY == null) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = previous.XAI_API_KEY;
    if (previous.THE_ODDS_API_KEY == null) delete process.env.THE_ODDS_API_KEY;
    else process.env.THE_ODDS_API_KEY = previous.THE_ODDS_API_KEY;
  }
}

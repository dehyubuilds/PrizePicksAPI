import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import type { PrizePicksProjection } from "../src/lib/prizepicks/types";
import { classifyMarketAwareness } from "../src/lib/prizepicks-intelligence/awareness";
import { clusterEvents, isComboOrPeriodMarket } from "../src/lib/prizepicks-intelligence/cluster";
import { processPackets } from "../src/lib/prizepicks-intelligence/gates";
import { isResearchHorizonProjection, normalizeMarket, normalizeSlate } from "../src/lib/prizepicks-intelligence/ingest";
import { appendRejected, readActiveSignals, writeActiveSignals, writeRunReport } from "../src/lib/prizepicks-intelligence/persist";
import { promoteWatchlist, reconcileSignals, signalDedupeKey } from "../src/lib/prizepicks-intelligence/reconcile";
import { researchEvents } from "../src/lib/prizepicks-intelligence/grok-research";
import { renderIntelligenceMarkdown } from "../src/lib/prizepicks-intelligence/report-md";
import { causalVariablesForFamily, resolveSportFamily } from "../src/lib/prizepicks-intelligence/sport-context";
import { credibilityForSourceType, normalizeSourceType, parseSource } from "../src/lib/prizepicks-intelligence/validate";
import type {
  EventCluster,
  GrokChange,
  GrokEventPacket,
  IntelligenceSignal,
  NormalizedMarket,
  RunReport,
} from "../src/lib/prizepicks-intelligence/types";

function startSoon(): string {
  return new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
}

function projection(
  partial: Partial<PrizePicksProjection> & Pick<PrizePicksProjection, "id" | "playerName">
): PrizePicksProjection {
  return {
    team: "DAL",
    opponent: "HOU",
    leagueId: "7",
    leagueName: "NBA",
    statDisplayName: "Assists",
    statType: "assists",
    lineScore: 6.5,
    oddsType: "standard",
    startTime: startSoon(),
    gameId: "g-nba-1",
    status: "pre_game",
    ...partial,
  };
}

function source(partial: Partial<ReturnType<typeof parseSource>> & { publishedAt: string; url: string }) {
  return parseSource({
    author: "Tim MacMahon",
    outlet: "ESPN",
    sourceType: "BEAT_REPORTER",
    ...partial,
  })!;
}

function change(partial: Partial<GrokChange> & Pick<GrokChange, "eventKey" | "whatChanged" | "whyNow">): GrokChange {
  const publishedAt = partial.sources?.[0]?.publishedAt ?? new Date(Date.now() - 30 * 60_000).toISOString();
  return {
    player: "Player X",
    statType: "Assists",
    signalType: "ROLE_CHANGE",
    direction: "UP",
    causalChain: ["Starter unavailable", "Player X absorbs creation", "Assists expectation rises"],
    bullCase: "Primary ballhandler absence increases Player X creation burden.",
    bearCase: "Team may split creation between two guards.",
    alreadyPricedArgument: "PrizePicks may have already moved the line.",
    missingEvidence: "Official starting lineup not yet posted.",
    invalidationCondition: "Starter is cleared or Player X stays in a bench role.",
    sources: [
      source({
        publishedAt,
        url: "https://example.com/news",
        sourceType: "COACH_QUOTE",
        author: "Coach",
        outlet: "Team official",
      }),
    ],
    ...partial,
  };
}

function clusterFrom(markets: NormalizedMarket[]): EventCluster {
  const clusters = clusterEvents(markets, 10);
  assert.ok(clusters[0]);
  return clusters[0]!;
}

function packet(eventKey: string, rows: { changes?: GrokChange[]; watch?: GrokChange[]; rejected?: GrokChange[] }): GrokEventPacket {
  return { eventKey, ...rows };
}

describe("normalize and sport context", () => {
  it("normalizes known and unknown leagues without dropping sports", () => {
    const nba = normalizeMarket(projection({ id: "1", playerName: "Luka Doncic" }));
    assert.equal(nba.sport, "NBA");
    assert.equal(nba.sportFamily, "basketball");
    assert.equal(nba.source, "PrizePicks");
    assert.equal(nba.projection, 6.5);

    const unknown = normalizeMarket(
      projection({
        id: "2",
        playerName: "Swisher",
        leagueName: "League 265",
        leagueId: "265",
        statDisplayName: "MAP 3 Kills",
        statType: "kills",
        team: "A",
        opponent: "B",
      })
    );
    assert.equal(unknown.sportFamily, "unknown");
    assert.match(unknown.sport, /League 265|UNKNOWN/i);
  });

  it("keeps tip-off-soon and in-play rows on the research horizon", () => {
    const soon = projection({
      id: "soon",
      playerName: "Soon",
      startTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
    const live = projection({
      id: "live",
      playerName: "Live",
      status: "in_play",
      startTime: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    });
    const finished = projection({
      id: "done",
      playerName: "Done",
      status: "in_play",
      startTime: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    });
    assert.equal(isResearchHorizonProjection(soon), true);
    assert.equal(isResearchHorizonProjection(live), true);
    assert.equal(isResearchHorizonProjection(finished), false);
  });

  it("prefers the standard line and keeps demon variants on raw", () => {
    const slate = normalizeSlate([
      projection({ id: "std", playerName: "Luka Doncic", oddsType: "standard", lineScore: 6.5 }),
      projection({ id: "dem", playerName: "Luka Doncic", oddsType: "demon", lineScore: 8.5 }),
    ]);
    assert.equal(slate.length, 1);
    assert.equal(slate[0]?.projection, 6.5);
    assert.equal(slate[0]?.raw.variants?.[0]?.id, "dem");
  });

  it("resolves sport families and causal lists", () => {
    assert.equal(resolveSportFamily({ leagueName: "NFL" }), "football");
    assert.equal(resolveSportFamily({ leagueName: "MLB" }), "baseball");
    assert.equal(resolveSportFamily({ leagueName: "NHL" }), "hockey");
    assert.equal(resolveSportFamily({ leagueName: "MLS" }), "soccer");
    assert.ok(causalVariablesForFamily("basketball").includes("minutes"));
    assert.ok(causalVariablesForFamily("football").includes("snap share"));
    assert.ok(causalVariablesForFamily("unknown").includes("role"));
  });
});

describe("event clustering", () => {
  it("skips combo and quarter lines", () => {
    const combo = normalizeMarket(
      projection({
        id: "combo",
        playerName: "Combo Prop",
        leagueName: "NFL",
        leagueId: "9",
        event: undefined,
        team: "ARI/SF",
        opponent: "SF/ARI 1Q",
        gameId: "CMBO_combo_abc",
        statDisplayName: "Pass Yards",
        statType: "pass yards",
      })
    );
    assert.equal(isComboOrPeriodMarket(combo), true);
    assert.equal(clusterEvents([combo], 10).length, 0);

    const mlbMatchup = normalizeMarket(
      projection({
        id: "mlb-slash",
        playerName: "Aaron Judge",
        leagueName: "MLB",
        leagueId: "2",
        statDisplayName: "Hits",
        statType: "hits",
        team: "NYY",
        opponent: "NYY / BOS",
        gameId: "MLB_game_slash",
      })
    );
    assert.equal(isComboOrPeriodMarket(mlbMatchup), false);
    assert.equal(clusterEvents([mlbMatchup], 10, ["WNBA", "MLB"]).length, 1);
  });

  it("merges the same game under one key and prefers NFL/MLB/WNBA", () => {
    const mlbNamed = normalizeMarket(
      projection({
        id: "mlb-a",
        playerName: "Shohei Ohtani",
        leagueName: "MLB",
        leagueId: "2",
        statDisplayName: "Hits",
        statType: "hits",
        team: "LAD",
        opponent: "SD",
        gameId: "MLB_game_same",
      })
    );
    const mlbAlias = normalizeMarket(
      projection({
        id: "mlb-b",
        playerName: "Mookie Betts",
        leagueName: "League 231",
        leagueId: "231",
        statDisplayName: "Hits",
        statType: "hits",
        team: "LAD",
        opponent: "SD",
        gameId: "MLB_game_same",
      })
    );
    const esport = normalizeMarket(
      projection({
        id: "cs",
        playerName: "Swisher",
        leagueName: "League 265",
        leagueId: "265",
        statDisplayName: "MAP 3 Kills",
        statType: "kills",
        team: "Liquid",
        opponent: "Wildcard",
        gameId: "CS2_match_xyz",
      })
    );
    const clusters = clusterEvents([mlbNamed, mlbAlias, esport], 10);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0]?.sport, "MLB");
    assert.equal(clusters[0]?.markets.length, 2);
  });

  it("can limit research to WNBA and MLB", () => {
    const wnba = normalizeMarket(
      projection({
        id: "wnba",
        playerName: "A'ja Wilson",
        leagueName: "WNBA",
        leagueId: "3",
        statDisplayName: "Points",
        statType: "points",
        team: "LV",
        opponent: "NY",
        gameId: "WNBA_game_1",
      })
    );
    const nfl = normalizeMarket(
      projection({
        id: "nfl",
        playerName: "QB",
        leagueName: "NFL",
        leagueId: "9",
        statDisplayName: "Pass Yards",
        statType: "pass yards",
        team: "KC",
        opponent: "BUF",
        gameId: "NFL_game_1",
      })
    );
    const clusters = clusterEvents([wnba, nfl], 10, ["WNBA", "MLB"]);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0]?.sport, "WNBA");
  });
});

describe("source credibility", () => {
  it("marks official high and anonymous low", () => {
    assert.equal(normalizeSourceType("coach quote"), "COACH_QUOTE");
    assert.equal(credibilityForSourceType("OFFICIAL"), "HIGH");
    assert.equal(credibilityForSourceType("ANONYMOUS"), "LOW");
    assert.equal(parseSource({ url: "", publishedAt: "2026-09-27T12:00:00Z", sourceType: "OFFICIAL" }), null);
  });
});

describe("signal fixtures", () => {
  const now = Date.now();
  const fresh = new Date(now - 34 * 60_000).toISOString();
  const stale = new Date(now - 10 * 60 * 60_000).toISOString();

  function run(markets: NormalizedMarket[], packets: GrokEventPacket[]) {
    return processPackets({
      clusters: clusterEvents(markets, 20),
      packets,
      runId: "ppi_test",
      nowMs: now,
    });
  }

  it("keeps an NBA role-change as newly emerged", () => {
    const market = normalizeMarket(projection({ id: "nba-role", playerName: "Player X" }));
    const eventKey = clusterFrom([market]).eventKey;
    const result = run(
      [market],
      [
        packet(eventKey, {
          changes: [
            change({
              eventKey,
              player: "Player X",
              statType: "Assists",
              whatChanged: "Starting PG ruled out",
              whyNow: "Starting PG was ruled out 47 minutes ago and the coach confirmed Player X will initiate the second unit.",
              sources: [source({ publishedAt: fresh, url: "https://example.com/nba", sourceType: "COACH_QUOTE" })],
            }),
          ],
        }),
      ]
    );
    assert.equal(result.signals.length, 1);
    assert.equal(result.signals[0]?.marketAwareness, "NEWLY_EMERGED");
    assert.equal(result.signals[0]?.verdict, "UNDER_REFLECTED_CHANGE");
    assert.ok((result.signals[0]?.causalChain.length ?? 0) >= 2);
  });

  it("keeps NFL / MLB / NHL / soccer role changes when sourced", () => {
    const fixtures: Array<{ proj: PrizePicksProjection; player: string; stat: string; what: string }> = [
      {
        proj: projection({
          id: "nfl",
          playerName: "Receiver Y",
          leagueName: "NFL",
          leagueId: "9",
          statDisplayName: "Receptions",
          statType: "receptions",
          team: "KC",
          opponent: "BUF",
          gameId: "g-nfl",
        }),
        player: "Receiver Y",
        stat: "Receptions",
        what: "Elevated into full-time route role after WR1 injury",
      },
      {
        proj: projection({
          id: "mlb",
          playerName: "Hitter Z",
          leagueName: "MLB",
          leagueId: "2",
          statDisplayName: "Hits",
          statType: "hits",
          team: "NYY",
          opponent: "BOS",
          gameId: "g-mlb",
        }),
        player: "Hitter Z",
        stat: "Hits",
        what: "Moved into leadoff against a LHP",
      },
      {
        proj: projection({
          id: "nhl",
          playerName: "Winger Q",
          leagueName: "NHL",
          leagueId: "8",
          statDisplayName: "Shots on Goal",
          statType: "sog",
          team: "COL",
          opponent: "DAL",
          gameId: "g-nhl",
        }),
        player: "Winger Q",
        stat: "Shots on Goal",
        what: "Promoted to first power-play unit",
      },
      {
        proj: projection({
          id: "mls",
          playerName: "Forward S",
          leagueName: "MLS",
          leagueId: "6",
          statDisplayName: "Shots",
          statType: "shots",
          team: "LAFC",
          opponent: "SEA",
          gameId: "g-mls",
        }),
        player: "Forward S",
        stat: "Shots",
        what: "Confirmed in starting XI after rotation chatter",
      },
    ];

    for (const fixture of fixtures) {
      const market = normalizeMarket(fixture.proj);
      const eventKey = clusterFrom([market]).eventKey;
      const result = run(
        [market],
        [
          packet(eventKey, {
            changes: [
              change({
                eventKey,
                player: fixture.player,
                statType: fixture.stat,
                whatChanged: fixture.what,
                whyNow: `${fixture.what} announced 40 minutes ago.`,
                sources: [source({ publishedAt: fresh, url: `https://example.com/${fixture.proj.id}`, sourceType: "BEAT_REPORTER" })],
              }),
            ],
          }),
        ]
      );
      assert.equal(result.signals.length, 1, fixture.player);
    }
  });

  it("rejects a fake anonymous rumor", () => {
    const market = normalizeMarket(projection({ id: "rumor", playerName: "Star Player" }));
    const eventKey = clusterFrom([market]).eventKey;
    const result = run(
      [market],
      [
        packet(eventKey, {
          changes: [
            change({
              eventKey,
              player: "Star Player",
              whatChanged: "Anonymous account says minutes will explode",
              whyNow: "Tweet 10 minutes ago from unverified insider",
              sources: [
                source({
                  publishedAt: fresh,
                  url: "https://x.com/anoninsider",
                  sourceType: "ANONYMOUS",
                  author: "anon",
                  outlet: "unknown",
                }),
              ],
            }),
          ],
        }),
      ]
    );
    assert.equal(result.signals.length, 0);
    assert.ok(result.rejected.some((row) => /source|anonymous|usable/i.test(row.whyRejected)));
  });

  it("does not mark a widely known injury as newly emerged", () => {
    const market = normalizeMarket(
      projection({
        id: "known-inj",
        playerName: "Injured Star",
        updatedAt: new Date(now - 2 * 60 * 60_000).toISOString(),
      })
    );
    const eventKey = clusterFrom([market]).eventKey;
    const result = run(
      [market],
      [
        packet(eventKey, {
          changes: [
            change({
              eventKey,
              player: "Injured Star",
              whatChanged: "Star ruled out; replacement gets usage",
              whyNow: "Injury was posted this morning and has circulated for hours.",
              sources: [source({ publishedAt: stale, url: "https://example.com/old-injury", sourceType: "INJURY_REPORT" })],
            }),
          ],
        }),
      ]
    );
    assert.equal(result.signals.filter((row) => row.marketAwareness === "NEWLY_EMERGED").length, 0);
    assert.ok(result.contextSignals.some((row) => row.marketAwareness === "BROADLY_KNOWN") || result.signals.every((row) => row.marketAwareness !== "NEWLY_EMERGED"));
  });

  it("requires whyNow and excludes LOW confidence", () => {
    const market = normalizeMarket(projection({ id: "nowhy", playerName: "No Why" }));
    const eventKey = clusterFrom([market]).eventKey;
    const missing = run(
      [market],
      [packet(eventKey, { changes: [change({ eventKey, player: "No Why", whatChanged: "Maybe more usage", whyNow: "" })] })]
    );
    assert.ok(missing.rejected.some((row) => /whyNow/i.test(row.whyRejected)));

    const low = classifyMarketAwareness({ sources: [], nowMs: now });
    assert.equal(low, "SPECULATIVE");
  });
});

describe("historical reconcile and persistence", () => {
  it("marks duplicates as not new and records evolution", () => {
    const base: IntelligenceSignal = {
      signalId: "sig_old",
      marketId: "m1",
      sport: "NBA",
      event: "DAL vs HOU",
      player: "Player X",
      team: "DAL",
      opponent: "HOU",
      statType: "Assists",
      projection: 6.5,
      direction: "UP",
      signalType: "ROLE_CHANGE",
      whyNow: "PG out",
      causalChain: ["PG out", "usage up"],
      evidenceConfidence: "MEDIUM",
      marketAwareness: "POSSIBLY_UNDER_REFLECTED",
      freshnessMinutes: 40,
      whatChanged: "Starting PG ruled out",
      whyItMatters: "Creation",
      bullCase: "b",
      bearCase: "c",
      alreadyPricedArgument: "d",
      missingEvidence: "e",
      invalidationCondition: "f",
      verdict: "POSSIBLY_UNDER_REFLECTED",
      sources: [],
      firstSeenAt: "2026-09-26T12:00:00.000Z",
      lastSeenAt: "2026-09-26T12:00:00.000Z",
      isNew: true,
    };
    const incoming = { ...base, signalId: "sig_new", evidenceConfidence: "HIGH" as const, isNew: true };
    const result = reconcileSignals({ incoming: [incoming], previous: [base], nowIso: "2026-09-27T12:00:00.000Z" });
    assert.equal(result.active[0]?.isNew, false);
    assert.equal(result.active[0]?.signalId, "sig_old");
    assert.match(result.active[0]?.signalEvolution ?? "", /MEDIUM/);
    assert.equal(signalDedupeKey(base), signalDedupeKey(incoming));
  });

  it("promotes a watchlist item when confirmation arrives", () => {
    const promoted = promoteWatchlist({
      previousWatch: ["player x|assists|pg out"],
      confirmedKeys: ["player x|assists|pg out"],
    });
    assert.deepEqual(promoted, ["player x|assists|pg out"]);
  });

  it("persists rejected theses and reports", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ppi-"));
    appendRejected(
      [{ player: "A", market: "Assists 6.5", initialHypothesis: "minutes up", whyRejected: "anonymous", evidenceReviewed: "tweet" }],
      root
    );
    const report: RunReport = {
      runId: "ppi_x",
      runDate: "2026-09-27",
      generatedAt: "2026-09-27T19:00:00.000Z",
      marketsAnalyzed: 12,
      sportsAnalyzed: ["NBA"],
      eventsResearched: 1,
      signals: [],
      contextSignals: [],
      watchlist: [],
      rejected: [{ player: "A", market: "Assists 6.5", initialHypothesis: "minutes up", whyRejected: "anonymous", evidenceReviewed: "tweet" }],
      incomplete: [],
    };
    const markdown = renderIntelligenceMarkdown(report);
    assert.match(markdown, /No defensible market dislocations/);
    assert.doesNotMatch(markdown, /LOCK|BEST BET|FREE MONEY/);
    writeRunReport(report, markdown, root);
    writeActiveSignals([], root);
    assert.equal(readActiveSignals(root).length, 0);
    assert.ok(fs.existsSync(path.join(root, "reports", "2026-09-27.md")));
  });
});

describe("grok research retries", () => {
  it("retries a timeout and never files it as rejected", async () => {
    const cluster = clusterFrom([
      normalizeMarket(
        projection({
          id: "retry-1",
          playerName: "Retry Player",
          leagueName: "MLB",
          leagueId: "2",
          team: "NYY",
          opponent: "BOS",
        })
      ),
    ]);
    let calls = 0;
    const result = await researchEvents([cluster], async () => {
      calls += 1;
      if (calls === 1) throw new Error("The operation was aborted due to timeout");
      return { packets: [packet(cluster.eventKey, { changes: [] })], model: "test" };
    });
    assert.equal(calls, 2);
    assert.equal(result.rejected.length, 0);
    assert.equal(result.incomplete.length, 0);
    assert.equal(result.packets.length, 1);
  });

  it("marks a second timeout as incomplete, not rejected", async () => {
    const cluster = clusterFrom([
      normalizeMarket(
        projection({
          id: "timeout-1",
          playerName: "Timeout Player",
          leagueName: "MLB",
          leagueId: "2",
          team: "NYY",
          opponent: "BOS",
        })
      ),
    ]);
    const result = await researchEvents([cluster], async () => {
      throw new Error("The operation was aborted due to timeout");
    });
    assert.equal(result.rejected.length, 0);
    assert.equal(result.incomplete.length, 1);
    assert.equal(result.incomplete[0]?.reason, "GROK_TIMEOUT");
    const markdown = renderIntelligenceMarkdown({
      runId: "ppi_timeout",
      runDate: "2026-09-28",
      generatedAt: "2026-09-28T14:13:51.160Z",
      marketsAnalyzed: 1,
      sportsAnalyzed: ["MLB"],
      eventsResearched: 1,
      signals: [],
      contextSignals: [],
      watchlist: [],
      rejected: [],
      incomplete: result.incomplete,
    });
    assert.match(markdown, /INCOMPLETE RESEARCH/);
    assert.match(markdown, /never judged/);
    assert.doesNotMatch(markdown, /rejected because GROK_TIMEOUT/);
  });
});

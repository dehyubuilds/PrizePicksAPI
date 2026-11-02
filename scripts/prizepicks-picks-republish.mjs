#!/usr/bin/env node
/** Rebuild the public edge page from the last local run (or last S3 snapshot). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "./env-lib.mjs";

loadEnvFile(".env.local");
loadEnvFile("../Dropflow/.env.local", { override: false });
loadEnvFile("../Statics/.env.local", { override: false });

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LAST_REPORT = path.join(ROOT, "tmp/prizepicks-picks/last-report.json");
const LATEST = "https://df31ebpsie5st.cloudfront.net/picks/edge/latest.json";

function parseLineScore(token) {
  const n = Number(String(token).replace("p", "."));
  return Number.isFinite(n) ? n : 0;
}

function parseRawBlock(block) {
  const token = block.match(/projId=([0-9]+)(?:-([ou])-([0-9p]+))?/i);
  const projectionId = token?.[1] ?? "";
  const side = token?.[2] === "u" ? "under" : "over";
  const lineScore = parseLineScore(token?.[3] ?? "0");
  return { projectionId, side, lineScore };
}

const FALLBACK_IDS = {
  "Allisha Gray Over 26.5 PRA (demon)": "15261430",
  "Angel Reese Over 32.5 PRA (demon)": "15259535",
  "Allisha Gray + Sonia Citron Over 34 Points": "15218665",
  "Sonia Citron Over 25.5 PRA (demon)": "15262567",
};

function pickFromPublished(row, raw) {
  const parsed = parseRawBlock(raw);
  if (!parsed.projectionId) parsed.projectionId = FALLBACK_IDS[row.pickLine] ?? "";
  const playerName = String(row.pickLine ?? "").replace(/\s+(Over|Under)\s+.*/i, "").trim();
  return {
    rank: row.rank,
    priority: row.priority,
    explanation: row.explanation,
    xSignal: row.xSignal,
    grokConfidence: undefined,
    sources: row.sources,
    pick: {
      id: `${parsed.projectionId}:${parsed.side}`,
      prizepicksProjectionId: parsed.projectionId,
      playerName,
      sport: row.sport ?? "WNBA",
      team: "",
      opponent: "",
      statDisplayName: row.pickLine ?? "",
      statType: row.pickLine ?? "",
      lineScore: parsed.lineScore,
      side: parsed.side,
      oddsType: row.oddsType ?? "standard",
      startTime: "",
      pickLine: row.pickLine,
      prizepicksImpliedProb: 50,
      kalshiImpliedProb: null,
      adjustedProb: null,
      edgePercent: row.edgePercent ?? null,
      confidenceScore: 50,
      confidenceLabel: "medium",
      category: "premium",
      reasoning: row.explanation ?? "",
      kalshi: null,
      projection: {
        id: parsed.projectionId,
        playerName,
        team: "",
        opponent: "",
        leagueId: row.sport === "WNBA" ? "3" : row.sport === "MLB" ? "2" : "",
        leagueName: row.sport ?? "",
        statDisplayName: row.pickLine ?? "",
        statType: "",
        lineScore: parsed.lineScore,
        oddsType: row.oddsType ?? "standard",
        startTime: "",
        gameId: "",
        status: "pre_game",
      },
    },
  };
}

const { nextScheduledRun } = await import("../src/lib/prizepicks-edge/schedule.ts");
const { publishPrizePicksEdgePage } = await import("../src/lib/prizepicks-edge/publish-page.ts");

let report;
if (fs.existsSync(LAST_REPORT)) {
  report = JSON.parse(fs.readFileSync(LAST_REPORT, "utf8"));
  report.nextBotRunAt = nextScheduledRun().toISOString();
} else {
  const res = await fetch(LATEST);
  if (!res.ok) throw new Error(`Could not read ${LATEST}: ${res.status}`);
  const doc = await res.json();
  const blocks = String(doc.rawPicks ?? "").split(/\n\n+/);
  const opportunities = (doc.opportunities ?? []).map((row, i) => pickFromPublished(row, blocks[i] ?? ""));
  report = {
    generatedAt: doc.generatedAt,
    model: doc.model,
    summary: doc.summary,
    boardCount: doc.boardCount ?? 0,
    scannedCount: doc.scannedCount ?? 0,
    kalshiMarketCount: doc.kalshiMarketCount ?? 0,
    polymarketMarketCount: doc.polymarketMarketCount ?? 0,
    shortlistCount: opportunities.length,
    intelCount: doc.intelCount ?? 0,
    rejectedCount: doc.rejectedCount ?? 0,
    opportunities,
    nextBotRunAt: nextScheduledRun().toISOString(),
    scan: {
      summary: {
        scannedAt: doc.generatedAt,
        projectionCount: 0,
        kalshiMarketCount: doc.kalshiMarketCount ?? 0,
        polymarketMarketCount: doc.polymarketMarketCount ?? 0,
        matchedCount: 0,
        prizepicksFromCache: true,
        sports: ["WNBA"],
      },
      picks: [],
      freePick: null,
      premiumPicks: [],
      demonWatchlist: [],
      avoidList: [],
    },
  };
}

const published = await publishPrizePicksEdgePage(report);
console.log(published.cdnUrl);

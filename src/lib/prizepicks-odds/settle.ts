import fs from "fs";
import path from "path";
import { readSettlements, SETTLEMENTS_FILE } from "./backtest";
import {
  canSettleMarket,
  espnPath,
  gradeStat,
  matchCompletedGame,
  parseScoreboardGames,
  parseSummary,
  playerStat,
} from "./espn-boxscore";
import type { SettlementRow } from "./scoring";
import { SNAPSHOT_DIR, type OddsSnapshot, type SnapshotLeg } from "./snapshots";

export function mergeSettlements(existing: SettlementRow[], incoming: SettlementRow[]): SettlementRow[] {
  const map = new Map(existing.map((row) => [row.propId, row]));
  for (const row of incoming) {
    if (!map.has(row.propId)) map.set(row.propId, row);
  }
  return [...map.values()];
}

export function rowFromActual(params: {
  leg: SnapshotLeg;
  predictedAt: string;
  actual: number;
  settledAt: string;
}): SettlementRow | null {
  const leg = params.leg;
  if (leg.side !== "over" && leg.side !== "under") return null;
  if (leg.marketProbability == null || !leg.playerName || !leg.stat || !leg.startTime) return null;
  const predicted = Date.parse(params.predictedAt);
  const start = Date.parse(leg.startTime);
  if (!Number.isFinite(predicted) || !Number.isFinite(start) || predicted > start) return null;
  const graded = gradeStat(leg.side, leg.line, params.actual);
  return {
    propId: leg.id,
    sport: leg.sport,
    stat: leg.stat,
    oddsType: leg.oddsType || "standard",
    probability: leg.marketProbability,
    hit: graded === "win" ? 1 : graded === "loss" ? 0 : "push",
    modelVersion: leg.modelVersion,
    predictedAt: params.predictedAt,
    settledAt: params.settledAt,
    closingLine: leg.line,
    probabilitySource: leg.probabilitySource ?? "unknown",
    research: "none",
    evidenceQuality: leg.evidenceQuality,
    rank: leg.selectionRank,
  };
}

export function listSnapshots(dir = SNAPSHOT_DIR): OddsSnapshot[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((file) => file.endsWith(".json") && file !== "latest.json");
  const snapshots: OddsSnapshot[] = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as OddsSnapshot;
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.legs)) continue;
      snapshots.push(parsed);
    } catch {
      // skip a damaged snapshot
    }
  }
  return snapshots;
}

export async function settleStoredSnapshots(options: {
  dir?: string;
  file?: string;
  nowIso?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<{ added: number; pending: number; rows: SettlementRow[] }> {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const snapshots = listSnapshots(options.dir);
  const existing = readSettlements(options.file);
  const known = new Set(existing.map((row) => row.propId));
  const fetchImpl = options.fetchImpl ?? fetch;
  const incoming: SettlementRow[] = [];
  let pending = 0;
  const boards = new Map<string, Array<{ id: string; name: string; completed: boolean }>>();
  const boxes = new Map<string, ReturnType<typeof parseSummary>>();
  for (const snapshot of snapshots) {
    if (!Array.isArray(snapshot?.legs)) continue;
    for (const leg of snapshot.legs) {
      if (known.has(leg.id) || incoming.some((row) => row.propId === leg.id)) continue;
      if (!leg.startTime || Date.parse(leg.startTime) > Date.parse(nowIso)) {
        pending += 1;
        continue;
      }
      if (!leg.market || !canSettleMarket(leg.sport, leg.market) || !espnPath(leg.sport)) {
        pending += 1;
        continue;
      }
      const actual = await actualStat(leg, fetchImpl, boards, boxes);
      if (actual == null) {
        pending += 1;
        continue;
      }
      const row = rowFromActual({ leg, predictedAt: snapshot.generatedAt, actual, settledAt: nowIso });
      if (!row) {
        pending += 1;
        continue;
      }
      incoming.push(row);
    }
  }
  const rows = mergeSettlements(existing, incoming);
  const file = options.file ?? SETTLEMENTS_FILE;
  if (incoming.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(rows, null, 2)}\n`);
  }
  return { added: incoming.length, pending, rows };
}

async function actualStat(
  leg: SnapshotLeg,
  fetchImpl: typeof fetch,
  boards: Map<string, Array<{ id: string; name: string; completed: boolean }>>,
  boxes: Map<string, ReturnType<typeof parseSummary>>
): Promise<number | null> {
  const sportPath = espnPath(leg.sport);
  if (!sportPath || !leg.team || !leg.opponent || !leg.startTime || !leg.playerName || !leg.market) return null;
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(leg.startTime))
    .replaceAll("-", "");
  const boardKey = `${leg.sport}:${date}`;
  let games = boards.get(boardKey);
  if (!games) {
    const response = await fetchImpl(`https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard?dates=${date}`);
    if (!response.ok) return null;
    games = parseScoreboardGames(await response.json());
    boards.set(boardKey, games);
  }
  const game = matchCompletedGame(leg.team, leg.opponent, games);
  if (!game?.completed) return null;
  const summaryKey = `${leg.sport}:${game.id}`;
  let box = boxes.get(summaryKey);
  if (!box) {
    const response = await fetchImpl(`https://site.api.espn.com/apis/site/v2/sports/${sportPath}/summary?event=${game.id}`);
    if (!response.ok) return null;
    box = parseSummary(await response.json(), leg.sport);
    boxes.set(summaryKey, box);
  }
  if (!box?.completed) return null;
  return playerStat(box, leg.playerName, leg.market);
}

export function formatSettle(result: { added: number; pending: number }): string {
  return [
    "SETTLE",
    result.added
      ? `Recorded ${result.added} new result${result.added === 1 ? "" : "s"} from ESPN box scores.`
      : "No new result was recorded.",
    `${result.pending} snapshot legs are still unsettled. MLB, NHL, combo stats, and unmatched players are left open.`,
  ].join("\n");
}

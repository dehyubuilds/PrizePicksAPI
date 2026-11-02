import fs from "fs";
import path from "path";
import { fetchPrizePicksLeagueCatalog, fetchPrizePicksProjections } from "@/lib/prizepicks/client";
import type { PrizePicksLeagueCatalogEntry } from "@/lib/prizepicks/client";
import type { PrizePicksProjection } from "@/lib/prizepicks/types";
import { grokSpendBlocked, usdPerResearch } from "@/lib/prizepicks-odds/research";
import { callGrokResponses } from "@/lib/xai/client";
import { evaluateBacktest, type BacktestRow } from "./backtest";
import { matchIdentity } from "./identity";
import { applyInformation, projectMaps12 } from "./model";
import { writeValorant, readValorant } from "./persist";
import { renderValorantMarkdown } from "./report";
import { discoverValorantProps } from "./scope";
import { interpretSignal, type RawSignal } from "./signals";
import { handleRecord, pageRecord, REGISTERED_PAGES } from "./sources";
import type { IntelItem, MapAppearance, ValorantMode, ValorantReport } from "./types";
import { SCHEMA_VERSION } from "./types";

export type ValorantOptions = {
  mode?: ValorantMode;
  estimate?: boolean;
  dryRun?: boolean;
  maxGrokSpend?: number;
  maxGrokCalls?: number;
  maxMatches?: number;
  verbose?: boolean;
};

export type ValorantDeps = {
  now?: Date;
  projections?: PrizePicksProjection[];
  catalog?: PrizePicksLeagueCatalogEntry[];
  history?: MapAppearance[];
  fetchImpl?: typeof fetch;
  researchMatch?: (match: string) => Promise<unknown>;
  write?: boolean;
  root?: string;
};

const INSTRUCTIONS = [
  "Return JSON only: {\"signals\":[{\"url\":null,\"author\":null,\"handle\":null,\"publishedAt\":null,\"player\":null,\"team\":null,\"claim\":\"\",\"supportingUrls\":[],\"contradicted\":false,\"kind\":\"roster\"}],\"handles\":[{\"handle\":\"\",\"url\":\"\"}]}",
  "One match only. Use post URLs you actually opened. Do not invent X handles.",
  "Do not assign a kill number to a roster or agent change.",
].join(" ");

export function parseValorantArgs(argv: string[]): ValorantOptions {
  const opts: ValorantOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--estimate") opts.estimate = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--verbose") opts.verbose = true;
    else if (arg === "--mode" && argv[i + 1]) {
      const mode = argv[++i] as ValorantMode;
      if (!["sources", "board", "intelligence", "history", "model", "backtest", "report", "full"].includes(mode)) {
        throw new Error(`Unknown mode: ${mode}`);
      }
      opts.mode = mode;
    } else if (arg === "--max-grok-spend" && argv[i + 1]) opts.maxGrokSpend = Number(argv[++i]);
    else if (arg === "--max-grok-calls" && argv[i + 1]) opts.maxGrokCalls = Number(argv[++i]);
    else if (arg === "--max-matches" && argv[i + 1]) opts.maxMatches = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  opts.mode ??= "board";
  return opts;
}

export async function runValorant(options: ValorantOptions, deps: ValorantDeps = {}): Promise<ValorantReport> {
  const mode = options.mode ?? "board";
  const now = deps.now ?? new Date();
  const nowIso = now.toISOString();
  const skipped = options.estimate === true || options.dryRun === true;
  const limitations = [
    "Maps 1–2 kills are the only modeled market. Three-map and combo props are excluded.",
    "Probabilities stay withheld until a distribution is fitted and held-out calibration exists.",
    "A line gap is not expected value. PrizePicks payout rules are not applied.",
  ];
  if (mode === "report") {
    const stored = readValorant(deps.root);
    if (!stored) throw new Error("No VALORANT report is stored yet.");
    const report = blank(nowIso, mode, limitations);
    report.props = stored.props;
    report.sources = stored.sources;
    report.intelligence = stored.intelligence;
    report.history = stored.history;
    report.projections = stored.projections;
    if (deps.write !== false) writeValorant(report, deps.root);
    return report;
  }

  let projections = deps.projections;
  if (!projections) {
    const board = await fetchPrizePicksProjections(skipped ? {} : {});
    projections = board.projections;
    if (board.fromCache) limitations.push(`Board cache from ${board.fetchedAt} was used.`);
  }
  let catalog = deps.catalog;
  if (!catalog && !skipped) {
    try {
      catalog = await fetchPrizePicksLeagueCatalog();
    } catch (err) {
      catalog = [];
      limitations.push((err instanceof Error ? err.message : "League catalog failed.").slice(0, 180));
    }
  }
  const names = leagueNames(catalog ?? [], projections, deps.catalog == null);
  const props = discoverValorantProps(projections, names, nowIso);
  const matches = uniqueMatches(props).slice(0, options.maxMatches ?? 5);

  const sources = skipped || (mode !== "sources" && mode !== "full" && mode !== "history")
    ? []
    : await probeSources(nowIso, deps.fetchImpl ?? fetch);
  const blockers = sources.filter((source) => source.apiAccess !== "authorized_api").map((source) => `${source.name}: ${source.notes}`);
  const history = deps.history ?? [];
  if (!history.length) blockers.push("No authorized provider returned map-level rows. Career averages were not substituted.");

  let grokCalls = 0;
  let grokCostUsd: number | null = null;
  let grokNote = "Grok was not called.";
  const intelligence: IntelItem[] = [];
  const handles: Array<{ handle: string; url: string }> = [];
  if (!skipped && (mode === "intelligence" || mode === "full")) {
    const blocked = options.maxGrokSpend == null
      ? "Set --max-grok-spend before X research. Uncapped Grok calls are not started."
      : grokSpendBlocked(options.maxGrokSpend);
    const callCap = Math.min(options.maxGrokCalls ?? 6, matches.length);
    if (blocked || callCap <= 0) grokNote = blocked || "No upcoming VALORANT matches were available for a focused search.";
    else {
      for (const match of matches.slice(0, callCap)) {
        try {
          const payload = deps.researchMatch
            ? await deps.researchMatch(match.label)
            : (await callGrokResponses({
                instructions: INSTRUCTIONS,
                input: match.label,
                tools: [{ type: "web_search" }, { type: "x_search" }],
                maxTurns: 2,
                timeoutMs: 80_000,
              })).parsed;
          grokCalls += 1;
          const parsed = readGrok(payload, match.id, nowIso);
          intelligence.push(...parsed.signals);
          handles.push(...parsed.handles);
        } catch (err) {
          limitations.push(err instanceof Error ? err.message : "A match search failed.");
          break;
        }
      }
      const unit = usdPerResearch();
      grokCostUsd = unit == null ? null : unit * grokCalls;
      grokNote = unit == null ? `${grokCalls} Grok calls. Dollar cost is unknown because XAI_USD_PER_RESEARCH is unset.` : `${grokCalls} Grok calls at $${unit} each.`;
    }
  }
  for (const handle of handles) {
    const record = handleRecord(handle.handle, handle.url, nowIso);
    if (record) sources.push(record);
  }

  const projectionsOut = props.map((prop) => {
    const identity = matchIdentity(prop.player, prop.team, history.map((row) => ({ id: row.providerPlayerId, name: row.playerName, team: row.team })));
    const projected = projectMaps12(prop, history, nowIso, identity.status === "high" ? "high" : identity.status);
    const effects = intelligence
      .filter((item) => item.matchId === prop.eventId && (!item.player || item.player.toLowerCase() === prop.player.toLowerCase()))
      .map((item) => item.effect);
    return applyInformation(projected, effects);
  });

  const backtest = evaluateBacktest([] as BacktestRow[]);
  const report: ValorantReport = {
    ...blank(nowIso, mode, limitations),
    props,
    sources,
    intelligence,
    history,
    historyBlockers: Array.from(new Set(blockers)),
    projections: projectionsOut,
    backtest,
    grokCalls,
    grokCostUsd,
    grokNote,
  };
  if (deps.write !== false && !skipped) writeValorant(report, deps.root);
  return report;
}

function blank(nowIso: string, mode: ValorantMode, limitations: string[]): ValorantReport {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: nowIso,
    mode,
    placesWagers: false,
    publishes: false,
    props: [],
    sources: [],
    intelligence: [],
    history: [],
    historyBlockers: [],
    projections: [],
    backtest: evaluateBacktest([]),
    grokCalls: 0,
    grokCostUsd: null,
    grokNote: "Grok was not called.",
    limitations,
  };
}

function leagueNames(catalog: PrizePicksLeagueCatalogEntry[], projections: PrizePicksProjection[], allowFile: boolean): Map<string, string> {
  const names = new Map<string, string>();
  for (const row of catalog) if (row.name) names.set(row.id, row.name);
  if (names.size || !allowFile) return names;
  const file = path.resolve(process.cwd(), "tmp/prizepicks-audit/category-inventory.json");
  if (fs.existsSync(file)) {
    const rows = JSON.parse(fs.readFileSync(file, "utf8")) as Array<{ categoryId: string; displayName: string; nameResolution: string }>;
    for (const row of rows) {
      if (row.nameResolution === "provider") names.set(row.categoryId, row.displayName);
    }
  }
  for (const projection of projections) {
    if (!names.has(projection.leagueId) && projection.leagueName && !/^league\s/i.test(projection.leagueName)) {
      names.set(projection.leagueId, projection.leagueName);
    }
  }
  return names;
}

function uniqueMatches(props: ValorantReport["props"]): Array<{ id: string; label: string }> {
  const seen = new Map<string, { id: string; label: string }>();
  for (const prop of props) {
    if (!seen.has(prop.eventId)) {
      seen.set(prop.eventId, { id: prop.eventId, label: `${prop.team} vs ${prop.opponent} at ${prop.startTime}. Players: ${prop.player}` });
    } else {
      const current = seen.get(prop.eventId)!;
      current.label = `${current.label}, ${prop.player}`;
    }
  }
  return Array.from(seen.values());
}

async function probeSources(nowIso: string, fetchImpl: typeof fetch): Promise<ValorantReport["sources"]> {
  const records = [];
  for (const page of REGISTERED_PAGES) {
    const probe = await probeUrl(page.url, fetchImpl);
    records.push(pageRecord(page, probe, nowIso));
  }
  return records;
}

async function probeUrl(url: string, fetchImpl: typeof fetch): Promise<{ status: number | null; error: string | null }> {
  try {
    const response = await fetchImpl(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(12_000) });
    return { status: response.status, error: null };
  } catch (err) {
    return { status: null, error: err instanceof Error ? err.message : "request failed" };
  }
}

function readGrok(payload: unknown, matchId: string, nowIso: string): { signals: ValorantReport["intelligence"]; handles: Array<{ handle: string; url: string }> } {
  const body = payload && typeof payload === "object" ? payload as { signals?: RawSignal[]; handles?: Array<{ handle?: string; url?: string }> } : {};
  const signals = (body.signals ?? []).map((signal) => interpretSignal(signal, matchId, nowIso));
  const handles = (body.handles ?? []).flatMap((row) => (row.handle && row.url ? [{ handle: row.handle, url: row.url }] : []));
  return { signals, handles };
}

export function formatValorantSummary(report: ValorantReport): string {
  const matches = new Set(report.props.map((prop) => prop.eventId));
  return [
    `VALORANT research (${report.mode})`,
    `Matches: ${matches.size}`,
    `Maps 1–2 kill props: ${report.props.length}`,
    `Standard props: ${report.props.filter((prop) => prop.eligible).length}`,
    `Historical rows: ${report.history.length}`,
    `Projections with a number: ${report.projections.filter((row) => row.baselineExpected != null).length}`,
    `Grok calls: ${report.grokCalls}`,
    report.grokNote,
    `Backtest: ${report.backtest.status}`,
    `Wagers: no. Publishing: no.`,
  ].join("\n");
}

export { renderValorantMarkdown };

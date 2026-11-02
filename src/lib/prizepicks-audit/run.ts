import { fetchOdds } from "@/lib/prizepicks-odds/client";
import { grokSpendBlocked, usdPerResearch } from "@/lib/prizepicks-odds/research";
import { fetchPrizePicksLeagueCatalog, fetchPrizePicksProjections } from "@/lib/prizepicks/client";
import type { PrizePicksLeagueCatalogEntry } from "@/lib/prizepicks/client";
import type { PrizePicksProjection } from "@/lib/prizepicks/types";
import { callGrokResponses } from "@/lib/xai/client";
import { buildCoverage, type OddsSportRow } from "./coverage";
import { buildInventory } from "./inventory";
import { summarizeObservations } from "./longitudinal";
import { readLatestReport, readObservations, writeAudit } from "./persist";
import { probeMarkets } from "./probe";
import { empiricalOrder, investigationOrder, opportunityMatrix, scoreCategory } from "./scorecard";
import { boardSource, oddsCatalogSource, sourcesFromGrok } from "./sources";
import type { AuditMode, AuditReport, DataSourceRecord, InefficiencyObservation } from "./types";

export type AuditOptions = {
  mode?: AuditMode;
  estimate?: boolean;
  dryRun?: boolean;
  maxOddsCredits?: number;
  maxGrokSpend?: number;
  maxCategories?: number;
  category?: string;
  verbose?: boolean;
};

export type AuditDeps = {
  now?: Date;
  projections?: PrizePicksProjection[];
  boardFetchedAt?: string | null;
  boardFromCache?: boolean;
  catalog?: PrizePicksLeagueCatalogEntry[];
  catalogError?: string | null;
  sports?: OddsSportRow[] | null;
  fetchOdds?: typeof fetchOdds;
  research?: (input: string) => Promise<unknown>;
  priorObservations?: InefficiencyObservation[];
  write?: boolean;
  root?: string;
};

const GROK_INSTRUCTIONS = [
  "You find public or commercial data sources for sports and esports prop research.",
  "Return JSON only: {\"sources\":[{\"provider\":\"\",\"url\":\"\",\"categories\":[],\"statCoverage\":\"\",\"historicalDepth\":null,\"updateFrequency\":null,\"apiAvailable\":\"yes|no|unknown\",\"access\":\"free|paid|unknown\",\"price\":null,\"notes\":\"\"}]}",
  "Do not invent prices. Use null when a price is not on a page you opened.",
  "Do not claim an API works unless you opened documentation that shows the endpoint.",
  "Categories must use the display names provided. Do not add categories that were not asked.",
].join(" ");

export function parseAuditArgs(argv: string[]): AuditOptions {
  const opts: AuditOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--estimate") opts.estimate = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--verbose") opts.verbose = true;
    else if (arg === "--mode" && argv[i + 1]) {
      const mode = argv[++i] as AuditMode;
      if (!["inventory", "sources", "markets", "full", "report"].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
      opts.mode = mode;
    } else if (arg === "--max-odds-credits" && argv[i + 1]) opts.maxOddsCredits = Number(argv[++i]);
    else if (arg === "--max-grok-spend" && argv[i + 1]) opts.maxGrokSpend = Number(argv[++i]);
    else if (arg === "--max-categories" && argv[i + 1]) opts.maxCategories = Number(argv[++i]);
    else if (arg === "--category" && argv[i + 1]) opts.category = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  opts.mode ??= "inventory";
  return opts;
}

export async function runPrizePicksAudit(options: AuditOptions, deps: AuditDeps = {}): Promise<AuditReport> {
  const mode = options.mode ?? "inventory";
  const now = deps.now ?? new Date();
  const nowIso = now.toISOString();
  if (mode === "report") return refreshReport(deps.priorObservations ?? readObservations(deps.root), nowIso, deps.root);

  const paidSkipped = options.estimate === true || options.dryRun === true;
  const limitations: string[] = [
    "Demon, goblin, and promo lines are counted and kept out of sportsbook comparisons.",
    "A threshold gap is not expected value. PrizePicks payout rules are not verified here.",
    "P1 settlement, closing-line value, and calibration are not claimed from this run.",
  ];
  let boardFetchedAt = deps.boardFetchedAt ?? null;
  let boardFromCache = deps.boardFromCache === true;
  let projections = deps.projections;
  if (!projections) {
    const board = await fetchPrizePicksProjections(paidSkipped || mode !== "inventory" ? {} : { forceLive: true });
    projections = board.projections;
    boardFetchedAt = board.fetchedAt;
    boardFromCache = board.fromCache === true;
  }
  let catalog = deps.catalog ?? [];
  let catalogError = deps.catalogError ?? null;
  if (!deps.catalog && !paidSkipped) {
    const loaded = await loadLeagueCatalog();
    catalog = loaded.catalog;
    catalogError = loaded.error;
    if (catalogError) {
      const previous = readLatestReport(deps.root);
      const recovered = (previous?.categories ?? []).filter((category) => category.nameResolution === "provider");
      if (recovered.length) {
        catalog = recovered.map((category) => ({
          id: category.categoryId,
          name: category.displayName,
          providerSport: category.sportAssignment === "provider" && category.sportOrGame !== category.displayName ? category.sportOrGame : null,
          projectionsCount: category.activePropCount,
          active: true,
        }));
        limitations.push(`League catalog failed (${catalogError}). Names from the last successful catalog were kept.`);
        catalogError = null;
      } else limitations.push(`League names were not loaded: ${catalogError}`);
    }
  }
  const categories = buildInventory(projections, catalog, nowIso);
  let sports = deps.sports === undefined ? null : deps.sports;
  let oddsCredits = 0;
  let oddsRequests = 0;
  const fetchImpl = deps.fetchOdds ?? fetchOdds;
  if (sports == null && !paidSkipped) {
    try {
      const listed = await fetchImpl("/sports", "sports_catalog");
      oddsRequests += 1;
      if (!listed.fromCache) oddsCredits += listed.lastCost ?? 0;
      sports = parseSports(listed.json);
    } catch (err) {
      limitations.push(err instanceof Error ? err.message : "The Odds API sport list failed.");
      sports = null;
    }
  }
  const coverageSeed = buildCoverage(categories, sports, new Map());
  const sportsListed = new Map(coverageSeed.map((row) => [row.categoryId, row.oddsSportKey ?? ""]));
  for (const [id, key] of Array.from(sportsListed.entries())) if (!key) sportsListed.delete(id);

  const focus = options.category?.trim().toLowerCase();
  const probedCategories = categories.filter((category) => !focus || category.displayName.toLowerCase() === focus || category.categoryId === focus);
  let observations: InefficiencyObservation[] = [];
  const returned = new Map<string, string[]>();
  const creditsByCategory = new Map<string, number>();
  if (!paidSkipped && (mode === "markets" || mode === "full")) {
    try {
      const probe = await probeMarkets({
        categories: probedCategories,
        projections,
        sportsListed,
        fetchOdds: fetchImpl,
        nowIso,
        maxCredits: options.maxOddsCredits ?? 40,
        maxCategories: options.maxCategories ?? 20,
      });
      observations = probe.observations;
      for (const [id, markets] of Array.from(probe.returned.entries())) returned.set(id, markets);
      for (const [id, credits] of Array.from(probe.creditsByCategory.entries())) creditsByCategory.set(id, credits);
      oddsCredits += probe.credits;
      oddsRequests += probe.requests;
    } catch (err) {
      limitations.push(err instanceof Error ? err.message : "The sportsbook probe failed.");
    }
  } else if (mode === "markets" || mode === "full") {
    limitations.push("Market requests were skipped because this was an estimate or dry run.");
  }

  const sources: DataSourceRecord[] = [boardSource(categories, boardFetchedAt)];
  if (sports) sources.push(oddsCatalogSource(categories.filter((category) => sportsListed.has(category.categoryId)).map((category) => category.categoryId)));
  let grokCalls = 0;
  let grokCostUsd: number | null = null;
  let grokNote = "Grok was not called.";
  if (!paidSkipped && (mode === "sources" || mode === "full")) {
    const blocked = options.maxGrokSpend == null ? "Set --max-grok-spend to allow Grok. Uncapped research is not started." : grokSpendBlocked(options.maxGrokSpend);
    if (blocked) grokNote = blocked;
    else {
      const names = probedCategories.filter((category) => category.nameResolution !== "unresolved").slice(0, options.maxCategories ?? 20);
      const input = names.map((category) => `${category.displayName}: ${category.propFamilies.slice(0, 6).map((family) => family.providerLabel).join(", ")}`).join("\n");
      try {
        const payload = deps.research
          ? await deps.research(input)
          : (await callGrokResponses({ instructions: GROK_INSTRUCTIONS, input, tools: [{ type: "web_search" }], maxTurns: 2, timeoutMs: 80_000 })).parsed;
        grokCalls = 1;
        const unit = usdPerResearch();
        grokCostUsd = unit == null ? null : unit;
        grokNote = unit == null ? "Grok ran once. Dollar cost is unknown because XAI_USD_PER_RESEARCH is unset." : `Grok ran once at $${unit}.`;
        const allowed = new Map(categories.map((category) => [category.displayName.toLowerCase(), category.categoryId]));
        sources.push(...sourcesFromGrok(payload, allowed));
      } catch (err) {
        grokNote = err instanceof Error ? err.message : "Grok research failed.";
        limitations.push(grokNote);
      }
    }
  }

  const coverage = buildCoverage(categories, sports, returned);
  const history = [...(deps.priorObservations ?? (deps.write === false ? [] : readObservations(deps.root))), ...observations];
  const longitudinal = summarizeObservations(history);
  const scorecards = categories.map((category) =>
    scoreCategory({
      category,
      sources,
      coverage: coverage.find((row) => row.categoryId === category.categoryId),
      observations: history,
      creditsForCategory: creditsByCategory.has(category.categoryId) ? creditsByCategory.get(category.categoryId)! : null,
    })
  );
  const report: AuditReport = {
    generatedAt: nowIso,
    mode,
    placesWagers: false,
    publishes: false,
    boardFetchedAt,
    boardFromCache,
    leagueCatalogStatus: catalogError ? "unavailable" : catalog.length ? "loaded" : "unavailable",
    leagueCatalogError: catalogError,
    categories,
    sources,
    coverage,
    observations,
    longitudinal,
    scorecards,
    investigateRanking: investigationOrder(categories, coverage),
    empiricalRanking: empiricalOrder(scorecards),
    matrix: opportunityMatrix({ categories, coverage, sources }),
    oddsCredits,
    oddsRequests,
    grokCalls,
    grokCostUsd,
    grokNote,
    limitations,
  };
  if (deps.write !== false && !paidSkipped) writeAudit(report, deps.root);
  return report;
}

async function loadLeagueCatalog(): Promise<{ catalog: PrizePicksLeagueCatalogEntry[]; error: string | null }> {
  try {
    return { catalog: await fetchPrizePicksLeagueCatalog(), error: null };
  } catch (err) {
    const message = (err instanceof Error ? err.message : "League catalog request failed.").slice(0, 240);
    if (!/429|rate-limit/i.test(message)) return { catalog: [], error: message };
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    try {
      return { catalog: await fetchPrizePicksLeagueCatalog(), error: null };
    } catch (retryErr) {
      return { catalog: [], error: (retryErr instanceof Error ? retryErr.message : message).slice(0, 240) };
    }
  }
}

function parseSports(json: unknown): OddsSportRow[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const key = String((row as { key?: string }).key ?? "");
    const title = String((row as { title?: string }).title ?? "");
    return key ? [{ key, title }] : [];
  });
}

function refreshReport(history: InefficiencyObservation[], nowIso: string, root?: string): AuditReport {
  const existing = readLatestReport(root);
  if (!existing) throw new Error("No audit report is stored yet. Run --mode inventory first.");
  const observations = history.length ? history : existing.observations;
  const longitudinal = summarizeObservations(observations);
  const scorecards = existing.categories.map((category) =>
    scoreCategory({
      category,
      sources: existing.sources,
      coverage: existing.coverage.find((row) => row.categoryId === category.categoryId),
      observations,
      creditsForCategory: null,
    })
  );
  const report: AuditReport = {
    ...existing,
    generatedAt: nowIso,
    mode: "report",
    observations: existing.observations,
    longitudinal,
    scorecards,
    empiricalRanking: empiricalOrder(scorecards),
    placesWagers: false,
    publishes: false,
  };
  writeAudit(report, root, { append: false });
  return report;
}

export function formatAuditSummary(report: AuditReport): string {
  const families = report.categories.reduce((sum, category) => sum + category.propFamilies.length, 0);
  const names = new Map(report.categories.map((category) => [category.categoryId, category.displayName]));
  return [
    `PrizePicks audit (${report.mode})`,
    `Categories: ${report.categories.length}`,
    `Prop families: ${families}`,
    `Unresolved names: ${report.categories.filter((category) => category.nameResolution === "unresolved").length}`,
    `Odds credits: ${report.oddsCredits}`,
    `Grok calls: ${report.grokCalls}`,
    `Grok: ${report.grokNote}`,
    `Investigate first: ${report.investigateRanking.slice(0, 5).map((id) => names.get(id) ?? id).join(", ") || "none"}`,
    `Repeated inefficiencies: ${report.empiricalRanking.length ? report.empiricalRanking.map((id) => names.get(id) ?? id).join(", ") : "none yet"}`,
    report.leagueCatalogError ? `League catalog: ${report.leagueCatalogError}` : `League catalog: ${report.leagueCatalogStatus}`,
    `Wagers: no. Publishing: no.`,
  ].join("\n");
}

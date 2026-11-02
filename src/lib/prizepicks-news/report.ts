import fs from "fs";
import path from "path";
import type { Candidate, NewsReport, ResearchFunnel } from "./types";

export function emptyFunnel(partial: Partial<ResearchFunnel> = {}): ResearchFunnel {
  return {
    eligibleGames: 0,
    newsSearchesAttempted: 0,
    newsSearchesCompleted: 0,
    newsSearchesTimedOut: 0,
    newsItemsDiscovered: 0,
    newsItemsDeduplicated: 0,
    newsItemsRetained: 0,
    affectedPlayers: 0,
    propsMatched: 0,
    halfPointProps: 0,
    integerProps: 0,
    eligibleSportsbookRequests: 0,
    cacheHits: 0,
    providerRequestsAttempted: 0,
    providerRequestsCompleted: 0,
    providerErrors: 0,
    creditsConsumed: 0,
    candidatesPriced: 0,
    candidatesUnpriced: 0,
    storiesGenerated: 0,
    supportedOpportunities: 0,
    ...partial,
  };
}

export const NEWS_ROOT = path.resolve(process.cwd(), "tmp/prizepicks-news");

const STORY_VERDICTS = new Set(["supported_opportunity", "interesting_story", "market_already_adjusted", "needs_verification"]);

export function splitCandidates(candidates: Candidate[]): { stories: Candidate[]; rejected: Candidate[] } {
  return {
    stories: candidates.filter((row) => STORY_VERDICTS.has(row.verdict)),
    rejected: candidates.filter((row) => !STORY_VERDICTS.has(row.verdict)),
  };
}

function section(title: string, rows: Candidate[]): string[] {
  if (!rows.length) return [`## ${title}`, "", "None.", ""];
  const lines = [`## ${title}`, ""];
  for (const row of rows) {
    const prop = row.line != null && row.stat ? `${row.player} ${row.line} ${row.stat}` : "No eligible PrizePicks market.";
    const price = row.marketProbability != null ? `${row.marketProbability}% ${row.pricingSide} from ${row.books} books` : "No market probability.";
    lines.push(
      `### ${row.player} — ${row.sport}`,
      "",
      `**What changed:** ${row.summary}`,
      "",
      `**Why it matters:** ${row.reason}`,
      "",
      `**PrizePicks:** ${prop}`,
      "",
      `**Sportsbooks:** ${price}`,
      "",
      `**Verdict:** ${row.tier ? `Tier ${row.tier}. ` : ""}${row.rejectionCode ? `${row.rejectionCode} — ` : ""}${row.verdict.replaceAll("_", " ")}`,
      "",
      `**Discovery:** ${row.discoveryMethod ?? "NEWS"}`,
      "",
      `**Edge:** ${row.edgeStatus ?? "UNVERIFIED_PAYOUT"}. Estimated edge and entry expected value are not shown unless a verified payout model produced them.`,
      "",
      `**Sources:** ${row.sourceUrls.length ? row.sourceUrls.join(", ") : "none"}`,
      "",
      `**Published:** ${row.publishedAt ?? "unknown"}`,
      "",
      row.risks.length ? `**Risks:** ${row.risks.join(" ")}` : "**Risks:** none recorded",
      ""
    );
  }
  return lines;
}

export function renderNewsMarkdown(report: NewsReport): string {
  const by = (sport: string) => report.stories.filter((row) => row.sport === sport);
  return [
    "# PrizePicks news-first research",
    "",
    report.live ? "This report uses live source and price responses from this run." : "This report did not call Grok or The Odds API.",
    "",
    "## Run summary",
    "",
    `- Started: ${report.startedAt}`,
    `- Ended: ${report.endedAt}`,
    `- Mode: ${report.discoveryMode ?? "news"} / ${report.mode}`,
    `- Sports checked: ${report.sportsChecked.join(", ") || "none"}`,
    `- Eligible games: ${report.eligibleGames}`,
    `- Props scanned: ${report.propsScanned ?? 0}`,
    `- Market groups considered: ${report.marketGroupsConsidered ?? 0}`,
    `- Market groups requested: ${report.marketGroupsRequested ?? 0}`,
    `- Tier A / B / C: ${report.tierA ?? 0} / ${report.tierB ?? 0} / ${report.tierC ?? 0}`,
    `- Sources queried: ${report.sourcesQueried.join(", ") || "none"}`,
    `- News events discovered: ${report.newsEventsDiscovered}`,
    `- Unique events: ${report.uniqueEvents}`,
    `- Affected players: ${report.affectedPlayers}`,
    `- PrizePicks props matched: ${report.propsMatched}`,
    `- Odds API requests: ${report.oddsRequests}`,
    `- Odds API credits: ${report.oddsCredits}`,
    `- Grok calls: ${report.grokCalls}`,
    `- Grok cost: ${report.grokCostUsd == null ? "unavailable" : `$${report.grokCostUsd}`}`,
    `- Budget: ${report.budgetNote}`,
    "",
    "## Research funnel",
    "",
    ...Object.entries(report.funnel).map(([key, value]) => `- ${key}: ${value}`),
    "",
    ...section("Shortlist", report.shortlist ?? []),
    ...section("Tier A — supported opportunities", (report.stories ?? []).filter((row) => row.tier === "A")),
    ...section("Tier B — market-supported research", (report.stories ?? []).filter((row) => row.tier === "B")),
    ...section("Tier C — watchlist", [...report.stories, ...report.rejected].filter((row) => row.tier === "C")),
    ...section("MLB pitcher strikeouts", by("MLB")),
    ...section("WNBA", by("WNBA")),
    ...section("NFL", by("NFL")),
    ...section("Rejected candidates", report.rejected),
    "Expected value is unavailable. A market-implied hit chance is not a profitable bet.",
    "",
  ].join("\n");
}

export function writeNewsReport(report: NewsReport, events: unknown[], root = NEWS_ROOT): { jsonPath: string; mdPath: string } {
  const stamp = report.startedAt.replace(/[:.]/g, "-");
  const dir = path.join(root, "reports", stamp);
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, "report.json");
  const mdPath = path.join(dir, "report.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(mdPath, renderNewsMarkdown(report));
  if (events.length) {
    const log = path.join(root, "events.jsonl");
    fs.mkdirSync(root, { recursive: true });
    fs.appendFileSync(log, events.map((event) => JSON.stringify({ runStartedAt: report.startedAt, event })).join("\n") + "\n");
  }
  return { jsonPath, mdPath };
}

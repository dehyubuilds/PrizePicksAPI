import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { awsClientConfig } from "@/lib/aws-credentials";
import { config } from "@/lib/config";
import { kalshiMarketPageUrl } from "@/lib/kalshi/config";
import { escapeHtml } from "@/lib/playlist-insights/picks-html";
import { polymarketMarketPageUrl } from "@/lib/polymarket/config";
import { prizePicksBoardUrlForPick } from "@/lib/prizepicks/board-url";
import { absolutePublicUrl } from "@/lib/public-site-url";
import { renderEdgeShareCard } from "./share-card";
import { formatDeltaLines } from "./history";
import { formatBotRunLabel, nextScheduledRun, picksScheduleChips, picksScheduleCopy } from "./schedule";
import type { EdgeOpportunity, PrizePicksEdgeReport } from "./types";

const LATEST_HTML_KEY = "picks/edge/index.html";
const LATEST_JSON_KEY = "picks/edge/latest.json";
const LATEST_CARD_KEY = "picks/edge/card.jpg";

export type PublishedEdgePage = {
  pageUrl: string;
  cdnUrl: string;
  archiveKey: string;
};

function cdnObjectUrl(key: string): string {
  const base = config.dropflow.baseUrl.replace(/\/$/, "");
  return `${base}/${key}`;
}

export function formatRawEdgePick(row: EdgeOpportunity): string {
  const pick = row.pick;
  const url = prizePicksBoardUrlForPick({
    prizepicksProjectionId: pick.prizepicksProjectionId,
    side: pick.side,
    lineScore: pick.lineScore,
    leagueId: pick.projection?.leagueId,
    sport: pick.sport,
  });
  const edge = pick.edgePercent == null ? "n/a" : `${pick.edgePercent >= 0 ? "+" : ""}${pick.edgePercent}%`;
  const lines = [
    `${row.rank}. [${row.priority.toUpperCase()}] ${pick.pickLine}`,
    url,
    `Edge ${edge} · ${pick.oddsType} · ${pick.sport}`,
    row.explanation,
  ];
  if (row.xSignal) lines.push(`News: ${row.xSignal}`);
  if (pick.kalshi) lines.push(`Kalshi: ${kalshiMarketPageUrl(pick.kalshi.ticker, pick.kalshi.market.eventTicker)}`);
  return lines.join("\n");
}

export function formatRawEdgePickList(rows: EdgeOpportunity[]): string {
  return rows.map(formatRawEdgePick).join("\n\n");
}

export function runOutcomeCounts(report: PrizePicksEdgeReport): {
  take: number;
  watch: number;
  rejected: number;
  headline: string;
  detail: string;
} {
  const take = report.opportunities.filter((row) => row.priority === "now").length;
  const watch = report.opportunities.filter((row) => row.priority === "watch").length;
  const rejected = report.rejectedCount ?? 0;
  const incomplete = report.incompleteCount ?? 0;
  const parts = [`${report.scannedCount} props scanned`];
  if (report.kalshiMarketCount) parts.push(`${report.kalshiMarketCount} Kalshi`);
  if (incomplete) parts.push(`${incomplete} games research incomplete`);
  if (rejected) parts.push(`${rejected} news rejected`);
  return {
    take,
    watch,
    rejected,
    headline: `${take} TAKE · ${watch} WATCH`,
    detail: parts.join(" · "),
  };
}

function displayPriority(priority: EdgeOpportunity["priority"]): string {
  if (priority === "now") return "TAKE";
  if (priority === "watch") return "WATCH";
  return "PASS";
}

function renderPickRow(row: EdgeOpportunity): string {
  const pick = row.pick;
  const conf = Math.max(0, Math.min(100, row.grokConfidence ?? pick.confidenceScore));
  const edge = pick.edgePercent == null ? "n/a" : `${pick.edgePercent >= 0 ? "+" : ""}${pick.edgePercent}%`;
  const label = displayPriority(row.priority);
  const url = prizePicksBoardUrlForPick({
    prizepicksProjectionId: pick.prizepicksProjectionId,
    side: pick.side,
    lineScore: pick.lineScore,
    leagueId: pick.projection?.leagueId,
    sport: pick.sport,
  });
  const kalshi = pick.kalshi
    ? `<p class="venue">Kalshi <a href="${escapeHtml(kalshiMarketPageUrl(pick.kalshi.ticker, pick.kalshi.market.eventTicker))}" target="_blank" rel="noopener noreferrer">${escapeHtml(pick.kalshi.ticker)}</a> · ${escapeHtml(pick.kalshi.pickedSide.toUpperCase())} · match ${escapeHtml(String(pick.kalshi.matchScore))}</p>`
    : "";
  const poly = pick.polymarket
    ? `<p class="venue">Polymarket <a href="${escapeHtml(polymarketMarketPageUrl(pick.polymarket.market.slug))}" target="_blank" rel="noopener noreferrer">${escapeHtml(pick.polymarket.marketTitle)}</a> · ${escapeHtml(pick.polymarket.pickedSide.toUpperCase())}</p>`
    : "";
  const news = row.xSignal ? `<p class="news">${escapeHtml(row.xSignal)}</p>` : "";
  return `<article class="pick" data-id="${escapeHtml(pick.id)}">
    <div class="rank">${escapeHtml(String(row.rank))}</div>
    <div class="body">
      <p class="game"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(pick.pickLine)}</a></p>
      <p class="detail">${escapeHtml(pick.sport)} · ${escapeHtml(pick.oddsType)} · ${escapeHtml(pick.team)}${pick.opponent ? ` vs ${escapeHtml(pick.opponent)}` : ""}</p>
      <div class="stats">
        <span class="chip pri ${escapeHtml(row.priority)}">${escapeHtml(label)}</span>
        <span class="chip conf">Edge <strong>${escapeHtml(edge)}</strong></span>
        <span class="chip">Conf <strong>${escapeHtml(String(conf))}</strong></span>
      </div>
      <p class="why">${escapeHtml(row.explanation)}</p>
      ${news}
      <div class="kalshi">
        <a class="open-prop" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open this prop</a>
        ${kalshi}
        ${poly}
      </div>
    </div>
  </article>`;
}

function renderSection(title: string, hint: string, rows: EdgeOpportunity[]): string {
  const body = rows.length
    ? rows.map(renderPickRow).join("\n")
    : `<p class="empty">None.</p>`;
  return `<section class="section">
    <h2>${escapeHtml(title)}</h2>
    <p class="section-hint">${escapeHtml(hint)}</p>
    ${body}
  </section>`;
}

export function renderEdgeReportHtml(params: {
  report: PrizePicksEdgeReport;
  generatedAtLabel: string;
  canonicalUrl: string;
  ogImageUrl: string;
}): string {
  const take = params.report.opportunities.filter((row) => row.priority === "now");
  const watch = params.report.opportunities.filter((row) => row.priority === "watch");
  const outcome = runOutcomeCounts(params.report);
  const rows = [
    renderSection("TAKE", "Enter these. New role or usage news, or a clear line vs Kalshi/Poly.", take),
    renderSection(
      "WATCH",
      "Not ready. Don’t monitor these. Run the report again — SINCE LAST RUN will say if one became a TAKE.",
      watch
    ),
  ].join("\n");
  const summary = params.report.summary
    ? `<p class="hint">${escapeHtml(params.report.summary)}</p>`
    : `<p class="hint">PrizePicks board first, then Kalshi + Polymarket pricing, then Grok news check. Entertainment only — not betting advice.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>PrizePicks edge board</title>
  <meta name="description" content="Morning PrizePicks opportunities with Kalshi, Polymarket, and Grok cross-check." />
  <meta name="robots" content="noindex" />
  <meta name="theme-color" content="#07080c" />
  <link rel="canonical" href="${escapeHtml(params.canonicalUrl)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="PrizePicks edge board" />
  <meta property="og:description" content="Priority PrizePicks tickets with venue + news context." />
  <meta property="og:url" content="${escapeHtml(params.canonicalUrl)}" />
  <meta property="og:image" content="${escapeHtml(params.ogImageUrl)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #07080c;
      color: #f4f4f5;
      font-size: 16px;
    }
    .wrap { max-width: 42rem; margin: 0 auto; padding: 1rem 1rem calc(1.5rem + env(safe-area-inset-bottom)); }
    .label { color: #a1a1aa; font-size: 0.75rem; letter-spacing: 0.12em; text-transform: uppercase; margin: 0; }
    h1 { font-size: 1.35rem; line-height: 1.25; margin: 0.4rem 0 0.65rem; }
    h2 { font-size: 0.78rem; letter-spacing: 0.12em; text-transform: uppercase; margin: 1.25rem 0 0.25rem; color: #f4f4f5; }
    .hint { color: #71717a; font-size: 0.8rem; margin: 0.45rem 0 0.75rem; }
    .key { margin: 0.85rem 0 1rem; padding: 0.75rem 0.8rem; border-radius: 0.85rem; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); }
    .key p { margin: 0.4rem 0 0; color: #d4d4d8; font-size: 0.86rem; line-height: 1.45; }
    .key p:first-child { margin-top: 0; }
    .delta { margin: 0 0 1rem; padding: 0.75rem 0.8rem; border-radius: 0.85rem; background: rgba(134,239,172,0.08); border: 1px solid rgba(134,239,172,0.22); }
    .delta h2 { margin-top: 0; color: #86efac; }
    .delta p { margin: 0.35rem 0 0; color: #d4d4d8; font-size: 0.86rem; line-height: 1.45; }
    .bot { margin: 0.75rem 0 1rem; }
    .bot-times { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.45rem 0 0; }
    .bot-meta { margin: 0.45rem 0 0; color: #a1a1aa; font-size: 0.8rem; }
    .outcome { margin: 0.85rem 0 1rem; padding: 0.85rem 0.9rem; border-radius: 0.85rem; background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.28); }
    .outcome-counts { margin: 0.35rem 0 0; font-size: 1.35rem; font-weight: 800; line-height: 1.2; }
    .section-hint { color: #a1a1aa; font-size: 0.82rem; margin: 0 0 0.35rem; }
    .empty { color: #71717a; font-size: 0.88rem; margin: 0.35rem 0 0; }
    .pick { display: flex; gap: 0.75rem; padding: 0.85rem 0; border-top: 1px solid rgba(255,255,255,0.08); }
    .rank { width: 1.4rem; flex-shrink: 0; font-weight: 700; color: #fbbf24; padding-top: 0.1rem; }
    .game { margin: 0; font-size: 1.05rem; font-weight: 700; line-height: 1.3; }
    .game a { color: inherit; text-decoration: none; }
    .game a:hover { text-decoration: underline; }
    .detail { margin: 0.2rem 0 0; color: #fbbf24; font-size: 0.88rem; font-weight: 650; }
    .why { margin: 0.45rem 0 0; color: #d4d4d8; font-size: 0.88rem; line-height: 1.45; }
    .news { margin: 0.3rem 0 0; color: #a1a1aa; font-size: 0.8rem; }
    .venue { margin: 0.35rem 0 0; font-size: 0.78rem; color: #a1a1aa; overflow-wrap: anywhere; }
    .venue a { color: #e4e4e7; }
    .kalshi { margin-top: 0.55rem; padding: 0.65rem 0.7rem; border-radius: 0.75rem; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); }
    .kalshi-label { margin: 0; font-size: 0.68rem; letter-spacing: 0.1em; text-transform: uppercase; color: #a1a1aa; }
    .open-prop { display: inline-flex; align-items: center; justify-content: center; margin-top: 0.45rem; min-height: 2.4rem; padding: 0 0.85rem; border-radius: 0.55rem; background: #fbbf24; color: #111827; font-size: 0.86rem; font-weight: 800; text-decoration: none; }
    .stats { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.45rem; }
    .chip { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.22rem 0.55rem; border-radius: 999px; background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.78); font-size: 0.78rem; }
    .chip strong { color: #f4f4f5; }
    .chip.conf { background: rgba(251,191,36,0.12); color: #fbbf24; }
    .chip.pri.now { background: rgba(134,239,172,0.16); color: #86efac; }
    .chip.pri.watch { background: rgba(253,230,138,0.14); color: #fde68a; }
  </style>
</head>
<body>
  <div class="wrap">
    <p class="label">PrizePicks · ${escapeHtml(params.report.model ?? "mechanical")}</p>
    <h1>Edge board · ${escapeHtml(outcome.headline)}</h1>
    <p class="label">${escapeHtml(params.generatedAtLabel)}</p>
    <div class="outcome">
      <p class="label">This run</p>
      <p class="outcome-counts">${escapeHtml(outcome.headline)}</p>
      <p class="bot-meta">${escapeHtml(params.generatedAtLabel)} · ${escapeHtml(outcome.detail)}</p>
      ${
        (params.report.incompleteCount ?? 0) > 0
          ? `<p class="bot-meta">News research did not finish on ${escapeHtml(String(params.report.incompleteCount))} game${params.report.incompleteCount === 1 ? "" : "s"}${
              params.report.incompleteEvents?.length ? ` (${escapeHtml(params.report.incompleteEvents.join("; "))})` : ""
            }. Not a reject — those games were never judged.</p>`
          : ""
      }
    </div>
    <div class="bot">
      <p class="label">Bot runs</p>
      <div class="bot-times">${picksScheduleChips().map((slot) => `<span class="chip">${escapeHtml(slot)}</span>`).join("")}</div>
      <p class="bot-meta">Every day at ${escapeHtml(picksScheduleCopy())}. Last run ${escapeHtml(params.generatedAtLabel)}. Next ${escapeHtml(formatBotRunLabel(params.report.nextBotRunAt ? new Date(params.report.nextBotRunAt) : nextScheduledRun()))}.</p>
    </div>
    ${summary}
    <div class="key">
      <p><span class="chip pri now">TAKE</span> Enter this. Something new changed the player’s role, or the line looks clearly off versus Kalshi/Poly.</p>
      <p><span class="chip pri watch">WATCH</span> Not ready. Don’t watch the game for it. Run this again later — SINCE LAST RUN will say if it became a TAKE, moved, or dropped.</p>
    </div>
    ${params.report.delta ? `<div class="delta">${formatDeltaLines(params.report.delta).map((line, index) => index === 0 ? `<h2>${escapeHtml(line)}</h2>` : `<p>${escapeHtml(line)}</p>`).join("")}</div>` : ""}
    ${rows}
  </div>
</body>
</html>`;
}

export async function publishPrizePicksEdgePage(report: PrizePicksEdgeReport): Promise<PublishedEdgePage> {
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const generatedAtLabel = new Date(report.generatedAt).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
  const pageUrl = `${absolutePublicUrl("/picks/edge")}?v=${encodeURIComponent(stamp)}`;
  const ogImageUrl = `${cdnObjectUrl(LATEST_CARD_KEY)}?v=${encodeURIComponent(stamp)}`;
  const card = await renderEdgeShareCard({
    opportunities: report.opportunities,
    dateLabel: generatedAtLabel,
  });
  const html = renderEdgeReportHtml({
    report,
    generatedAtLabel,
    canonicalUrl: absolutePublicUrl("/picks/edge"),
    ogImageUrl,
  });
  const payload = {
    generatedAt: report.generatedAt,
    publishedAt: now.toISOString(),
    model: report.model,
    summary: report.summary,
    boardCount: report.boardCount,
    scannedCount: report.scannedCount,
    kalshiMarketCount: report.kalshiMarketCount,
    polymarketMarketCount: report.polymarketMarketCount,
    intelCount: report.intelCount ?? 0,
    rejectedCount: report.rejectedCount ?? 0,
    incompleteCount: report.incompleteCount ?? 0,
    incompleteEvents: report.incompleteEvents ?? [],
    takeCount: report.opportunities.filter((row) => row.priority === "now").length,
    watchCount: report.opportunities.filter((row) => row.priority === "watch").length,
    opportunities: report.opportunities.map((row) => ({
      rank: row.rank,
      priority: row.priority,
      pickLine: row.pick.pickLine,
      explanation: row.explanation,
      xSignal: row.xSignal,
      edgePercent: row.pick.edgePercent,
      oddsType: row.pick.oddsType,
      sport: row.pick.sport,
      sources: row.sources,
    })),
    rawPicks: formatRawEdgePickList(report.opportunities),
    nextBotRunAt: report.nextBotRunAt,
    botRuns: ["8:30 AM CT", "12:30 PM CT", "4:30 PM CT"],
  };
  const archiveKey = `picks/edge/${dateKey}/${stamp}.html`;
  const s3 = new S3Client(awsClientConfig());
  const writes = [
    { Key: LATEST_HTML_KEY, Body: html, ContentType: "text/html; charset=utf-8", CacheControl: "no-cache" },
    { Key: archiveKey, Body: html, ContentType: "text/html; charset=utf-8", CacheControl: "public, max-age=86400" },
    { Key: LATEST_JSON_KEY, Body: JSON.stringify(payload, null, 2), ContentType: "application/json", CacheControl: "no-cache" },
    { Key: LATEST_CARD_KEY, Body: card, ContentType: "image/jpeg", CacheControl: "no-cache" },
    { Key: `picks/edge/${dateKey}/card.jpg`, Body: card, ContentType: "image/jpeg", CacheControl: "public, max-age=86400" },
  ];
  await Promise.all(
    writes.map((item) =>
      s3.send(
        new PutObjectCommand({
          Bucket: config.dropflow.bucket,
          ...item,
        })
      )
    )
  );
  return {
    pageUrl,
    cdnUrl: `${cdnObjectUrl(LATEST_HTML_KEY)}?v=${encodeURIComponent(stamp)}`,
    archiveKey,
  };
}

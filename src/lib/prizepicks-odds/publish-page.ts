import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { awsClientConfig } from "@/lib/aws-credentials";
import { config } from "@/lib/config";
import { escapeHtml } from "@/lib/playlist-insights/picks-html";
import { prizePicksBoardUrlForProjection } from "@/lib/prizepicks/board-url";
import { absolutePublicUrl } from "@/lib/public-site-url";
import type { DailyPick } from "./best-picks";
import type { DailyReport } from "./daily";
import { gapSentence, type OddsLeg } from "./select";
import { renderDailyShareCard, renderOddsShareCard } from "./share-card";

const LATEST_HTML_KEY = "picks/odds/index.html";
const LATEST_JSON_KEY = "picks/odds/latest.json";
const LATEST_CARD_KEY = "picks/odds/card.jpg";

export type OddsBoardPublish = {
  generatedAt: string;
  minEdge: number;
  creditsSpent: number;
  remaining: number | null;
  truncated: boolean;
  legs: OddsLeg[];
};

function cdnObjectUrl(key: string): string {
  const base = config.dropflow.baseUrl.replace(/\/$/, "");
  return `${base}/${key}`;
}

export function renderOddsBoardHtml(params: {
  board: OddsBoardPublish;
  generatedAtLabel: string;
  ogImageUrl?: string;
  pageUrl?: string;
}): string {
  const rows = params.board.legs.length
    ? params.board.legs
        .map((leg, index) => {
          const url = prizePicksBoardUrlForProjection({
            projectionId: leg.projectionId,
            side: leg.side,
            lineScore: leg.line,
            sport: leg.sport,
          });
          const href = url ? ` href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"` : "";
          return `<article class="pick">
            <div class="rank">${index + 1}</div>
            <div>
              <p class="game"><a${href}>${escapeHtml(leg.bookLine)}</a></p>
              <p class="detail">${escapeHtml(leg.sport)} · ${escapeHtml(leg.oddsType)} · ${escapeHtml(String(leg.books))} books</p>
              <p class="why">${escapeHtml(gapSentence(leg))}</p>
              ${url ? `<p class="open"><a class="btn"${href}>Open this prop</a></p>` : ""}
            </div>
          </article>`;
        })
        .join("\n")
    : `<p class="empty">No prop was far enough from the sportsbook number.</p>`;
  const credits =
    params.board.remaining == null
      ? `${params.board.creditsSpent} credits`
      : `${params.board.creditsSpent} credits · ${params.board.remaining} left this month`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PrizePicks sportsbook board</title>
  <meta name="robots" content="noindex" />
  <meta property="og:title" content="PrizePicks sportsbook board" />
  <meta property="og:description" content="PrizePicks props the sportsbooks price as more likely." />
  ${params.pageUrl ? `<meta property="og:url" content="${escapeHtml(params.pageUrl)}" />` : ""}
  ${params.ogImageUrl ? `<meta property="og:image" content="${escapeHtml(params.ogImageUrl)}" />` : ""}
  <meta name="twitter:card" content="summary_large_image" />
  <style>
    body { margin: 0; background: #07080c; color: #f4f4f5; font-family: ui-sans-serif, system-ui, sans-serif; }
    .wrap { max-width: 42rem; margin: 0 auto; padding: 1rem 1rem 2rem; }
    .label { color: #a1a1aa; font-size: 0.75rem; letter-spacing: 0.12em; text-transform: uppercase; }
    h1 { font-size: 1.35rem; margin: 0.35rem 0; }
    .hint, .empty { color: #a1a1aa; font-size: 0.9rem; }
    .pick { display: flex; gap: 0.75rem; padding: 0.9rem 0; border-top: 1px solid rgba(255,255,255,0.08); }
    .rank { color: #fbbf24; font-weight: 800; }
    .game { margin: 0; font-weight: 750; }
    .game a { color: inherit; text-decoration: none; }
    .detail, .why { margin: 0.25rem 0 0; color: #d4d4d8; font-size: 0.9rem; }
    .btn { display: inline-flex; margin-top: 0.55rem; padding: 0.55rem 0.8rem; border-radius: 0.55rem; background: #fbbf24; color: #111827; font-weight: 800; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrap">
    <p class="label">PrizePicks · sportsbooks</p>
    <h1>${params.board.legs.length} biggest gaps · +${escapeHtml(String(params.board.minEdge))}% floor</h1>
    <p class="label">${escapeHtml(params.generatedAtLabel)}</p>
    <p class="hint">${escapeHtml(credits)}. Largest gaps across every sport. Open a prop, then enter it on PrizePicks.</p>
    ${params.board.truncated ? `<p class="hint">This run stopped because the monthly Odds API balance ran out.</p>` : ""}
    ${rows}
  </div>
</body>
</html>`;
}

export async function publishOddsBoard(board: OddsBoardPublish): Promise<{ pageUrl: string; cdnUrl: string; cardUrl: string }> {
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const generatedAtLabel = new Date(board.generatedAt).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
  const ogImageUrl = `${cdnObjectUrl(LATEST_CARD_KEY)}?v=${encodeURIComponent(stamp)}`;
  const pageUrl = `${absolutePublicUrl("/picks/odds")}?v=${encodeURIComponent(stamp)}`;
  const card = await renderOddsShareCard({ legs: board.legs, dateLabel: generatedAtLabel });
  const html = renderOddsBoardHtml({ board, generatedAtLabel, ogImageUrl, pageUrl });
  const payload = {
    ...board,
    publishedAt: now.toISOString(),
  };
  const s3 = new S3Client(awsClientConfig());
  const writes = [
    { Key: LATEST_HTML_KEY, Body: html, ContentType: "text/html; charset=utf-8", CacheControl: "no-cache" },
    { Key: `picks/odds/${dateKey}/${stamp}.html`, Body: html, ContentType: "text/html; charset=utf-8", CacheControl: "public, max-age=86400" },
    { Key: LATEST_JSON_KEY, Body: JSON.stringify(payload, null, 2), ContentType: "application/json", CacheControl: "no-cache" },
    { Key: LATEST_CARD_KEY, Body: card, ContentType: "image/jpeg", CacheControl: "no-cache" },
    { Key: `picks/odds/${dateKey}/card.jpg`, Body: card, ContentType: "image/jpeg", CacheControl: "public, max-age=86400" },
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
    cardUrl: ogImageUrl,
  };
}

const DAILY_HTML_KEY = "picks/daily/index.html";
const DAILY_JSON_KEY = "picks/daily/latest.json";
const DAILY_CARD_KEY = "picks/daily/card.jpg";

export function renderDailyPicksHtml(params: {
  picks: DailyPick[];
  generatedAtLabel: string;
  ogImageUrl?: string;
  pageUrl?: string;
  truncated?: boolean;
}): string {
  const rows = params.picks.length
    ? params.picks
        .map((pick) => {
          const side = pick.side === "over" ? "Over" : "Under";
          const title = `${pick.player} ${side} ${pick.line} ${pick.stat}`;
          const url = prizePicksBoardUrlForProjection({
            projectionId: pick.projectionId,
            side: pick.side,
            lineScore: pick.line,
            sport: pick.league,
          });
          const href = url ? ` href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"` : "";
          const why = pick.reasons.map((reason) => escapeHtml(reason)).join(" ");
          const watch = pick.warnings.length ? pick.warnings.map((warning) => escapeHtml(warning)).join(" ") : "";
          return `<article class="pick">
            <div class="rank">${pick.rank}</div>
            <div>
              <p class="game"><a${href}>${escapeHtml(title)}</a></p>
              <p class="detail">${escapeHtml(pick.sport)} vs ${escapeHtml(pick.opponent)} · ${escapeHtml(pick.evidenceQuality.toUpperCase())} · ${escapeHtml(String(pick.sportsbookCount))} books</p>
              <p class="why">${why}</p>
              ${watch ? `<p class="why">${watch}</p>` : ""}
              ${url ? `<p class="open"><a class="btn"${href}>Open this prop</a></p>` : ""}
            </div>
            <p class="chance">${pick.marketProbability}%</p>
          </article>`;
        })
        .join("\n")
    : `<p class="empty">No qualifying picks today.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PrizePicks daily best picks</title>
  <meta name="robots" content="noindex" />
  <meta property="og:title" content="PrizePicks daily best picks" />
  <meta property="og:description" content="The strongest priced PrizePicks props today. Market chance, not a lock." />
  ${params.pageUrl ? `<meta property="og:url" content="${escapeHtml(params.pageUrl)}" />` : ""}
  ${params.ogImageUrl ? `<meta property="og:image" content="${escapeHtml(params.ogImageUrl)}" />` : ""}
  <meta name="twitter:card" content="summary_large_image" />
  <style>
    body { margin: 0; background: #07080c; color: #f4f4f5; font-family: ui-sans-serif, system-ui, sans-serif; }
    .wrap { max-width: 42rem; margin: 0 auto; padding: 1rem 1rem 2rem; }
    .label { color: #a1a1aa; font-size: 0.75rem; letter-spacing: 0.12em; text-transform: uppercase; }
    h1 { font-size: 1.35rem; margin: 0.35rem 0; }
    .hint, .empty { color: #a1a1aa; font-size: 0.9rem; }
    .pick { display: grid; grid-template-columns: 1.6rem 1fr auto; gap: 0.75rem; align-items: start; padding: 0.95rem 0; border-top: 1px solid rgba(255,255,255,0.08); }
    .rank { color: #fbbf24; font-weight: 800; padding-top: 0.1rem; }
    .game { margin: 0; font-weight: 750; font-size: 1.05rem; }
    .game a { color: inherit; text-decoration: none; }
    .detail, .why { margin: 0.25rem 0 0; color: #d4d4d8; font-size: 0.9rem; }
    .chance { margin: 0; color: #86efac; font-weight: 800; font-size: 1.15rem; }
    .btn { display: inline-flex; margin-top: 0.55rem; padding: 0.55rem 0.8rem; border-radius: 0.55rem; background: #fbbf24; color: #111827; font-weight: 800; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrap">
    <p class="label">PrizePicks · daily best picks</p>
    <h1>${params.picks.length ? `${params.picks.length} qualifying pick${params.picks.length === 1 ? "" : "s"}` : "No qualifying picks today"}</h1>
    <p class="label">${escapeHtml(params.generatedAtLabel)}</p>
    <p class="hint">Every qualifying pick is listed below. The percent is the market chance, not a guaranteed winner.</p>
    ${params.truncated ? `<p class="hint">This run stopped early because the Odds API credit budget was hit.</p>` : ""}
    ${rows}
  </div>
</body>
</html>`;
}

export async function publishDailyPicks(report: DailyReport): Promise<{ pageUrl: string; cdnUrl: string; cardUrl: string }> {
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
  const ogImageUrl = `${cdnObjectUrl(DAILY_CARD_KEY)}?v=${encodeURIComponent(stamp)}`;
  const pageUrl = `${absolutePublicUrl("/picks/daily")}?v=${encodeURIComponent(stamp)}`;
  const card = await renderDailyShareCard({ picks: report.picks, dateLabel: generatedAtLabel });
  const html = renderDailyPicksHtml({
    picks: report.picks,
    generatedAtLabel,
    ogImageUrl,
    pageUrl,
    truncated: report.scanTruncated,
  });
  const s3 = new S3Client(awsClientConfig());
  const writes = [
    { Key: DAILY_HTML_KEY, Body: html, ContentType: "text/html; charset=utf-8", CacheControl: "no-cache" },
    { Key: `picks/daily/${dateKey}/${stamp}.html`, Body: html, ContentType: "text/html; charset=utf-8", CacheControl: "public, max-age=86400" },
    { Key: DAILY_JSON_KEY, Body: JSON.stringify({ generatedAt: report.generatedAt, picks: report.picks }, null, 2), ContentType: "application/json", CacheControl: "no-cache" },
    { Key: DAILY_CARD_KEY, Body: card, ContentType: "image/jpeg", CacheControl: "no-cache" },
    { Key: `picks/daily/${dateKey}/card.jpg`, Body: card, ContentType: "image/jpeg", CacheControl: "public, max-age=86400" },
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
    cdnUrl: `${cdnObjectUrl(DAILY_HTML_KEY)}?v=${encodeURIComponent(stamp)}`,
    cardUrl: ogImageUrl,
  };
}

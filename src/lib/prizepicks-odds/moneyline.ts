import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { awsClientConfig } from "@/lib/aws-credentials";
import { config } from "@/lib/config";
import { americanToImplied, devigTwoWay } from "@/lib/edge-combos/estimators/devig";
import { escapeHtml } from "@/lib/playlist-insights/picks-html";
import { fetchOdds, oddsApiKey } from "./client";
import { resolveOddsSports, sportKeyForLeague } from "./markets";
import { renderMoneylineShareCard } from "./share-card";

export type MoneylineGame = {
  id: string;
  home: string;
  away: string;
  start: string;
  books: number;
  homeAmerican: number;
  awayAmerican: number;
  homeFair: number;
  awayFair: number;
  fairRange: number;
};

type BookPrice = { home?: number; away?: number };

export function parseMoneylineBoard(json: unknown): MoneylineGame[] {
  if (!Array.isArray(json)) return [];
  const games: MoneylineGame[] = [];
  for (const event of json) {
    if (!event || typeof event !== "object") continue;
    const row = event as {
      id?: string;
      home_team?: string;
      away_team?: string;
      commence_time?: string;
      bookmakers?: Array<{ markets?: Array<{ key?: string; outcomes?: Array<{ name?: string; price?: number }> }> }>;
    };
    const home = String(row.home_team ?? "");
    const away = String(row.away_team ?? "");
    if (!home || !away) continue;
    const fairs: number[] = [];
    const homePrices: number[] = [];
    const awayPrices: number[] = [];
    for (const book of row.bookmakers ?? []) {
      const market = (book.markets ?? []).find((item) => item.key === "h2h");
      const prices: BookPrice = {};
      for (const outcome of market?.outcomes ?? []) {
        if (!Number.isFinite(outcome.price)) continue;
        if (outcome.name === home) prices.home = outcome.price;
        if (outcome.name === away) prices.away = outcome.price;
      }
      if (prices.home == null || prices.away == null) continue;
      const homeImplied = americanToImplied(prices.home);
      const awayImplied = americanToImplied(prices.away);
      if (homeImplied == null || awayImplied == null) continue;
      const fair = devigTwoWay(homeImplied, awayImplied);
      if (!fair) continue;
      fairs.push(fair.a);
      homePrices.push(prices.home);
      awayPrices.push(prices.away);
    }
    if (fairs.length < 2) continue;
    const homeFair = median(fairs);
    games.push({
      id: String(row.id ?? `${away}@${home}`),
      home,
      away,
      start: String(row.commence_time ?? ""),
      books: fairs.length,
      homeAmerican: median(homePrices),
      awayAmerican: median(awayPrices),
      homeFair: Math.round(homeFair * 1000) / 10,
      awayFair: Math.round((1 - homeFair) * 1000) / 10,
      fairRange: Math.round((Math.max(...fairs) - Math.min(...fairs)) * 1000) / 10,
    });
  }
  return games.sort((a, b) => a.start.localeCompare(b.start) || a.away.localeCompare(b.away));
}

export function pickToWin(game: MoneylineGame): string {
  return game.homeFair >= game.awayFair ? game.home : game.away;
}

export function confidenceExplanation(game: MoneylineGame): string {
  const pick = pickToWin(game);
  const pct = Math.max(game.homeFair, game.awayFair);
  return `${howSure(pick, pct)} ${howMuchToTrust(pct, game.books, game.fairRange)}`;
}

function howSure(pick: string, pct: number): string {
  const chance = `${formatPct(pct)}%`;
  if (pct >= 85) {
    return `Sportsbooks are very sure about the ${pick}. They put the win chance at ${chance}, about ${plainRate(pct)}.`;
  }
  if (pct >= 70) {
    return `Sportsbooks clearly favor the ${pick}. They put the win chance at ${chance}, about ${plainRate(pct)}.`;
  }
  if (pct >= 60) {
    return `This is a lean, not a sure win. Sportsbooks give the ${pick} a ${chance} chance, about ${plainRate(pct)}.`;
  }
  if (pct >= 55) {
    return `This game is close. Sportsbooks only slightly favor the ${pick}, at ${chance}.`;
  }
  return `This is basically a toss-up. Sportsbooks barely side with the ${pick}, at ${chance}.`;
}

const PLAIN_RATES: Array<[number, string]> = [
  [95, "19 times out of 20"],
  [90, "9 times out of 10"],
  [85.7, "6 times out of 7"],
  [80, "4 times out of 5"],
  [75, "3 times out of 4"],
  [70, "7 times out of 10"],
  [66.7, "2 times out of 3"],
  [60, "3 times out of 5"],
];

function plainRate(pct: number): string {
  let best = PLAIN_RATES[0]!;
  for (const rate of PLAIN_RATES) {
    if (Math.abs(pct - rate[0]) < Math.abs(pct - best[0])) best = rate;
  }
  return best[1];
}

function howMuchToTrust(pct: number, books: number, range: number): string {
  const gap = `${formatPct(range)} points`;
  if (pct < 55) {
    return books >= 8
      ? `${books} sportsbooks posted this and still cannot separate the teams.`
      : `Only ${books} sportsbooks posted this, and they do not separate the teams.`;
  }
  if (books >= 8 && range <= 3) {
    return pct < 58
      ? `${books} sportsbooks posted this and they almost agree (${gap} apart), so the advantage is small but steady.`
      : `${books} sportsbooks posted this and they almost agree (${gap} apart). That is a steady read.`;
  }
  if (books < 4) {
    return `Only ${books} sportsbooks posted this, so the exact percent is a thinner read. They are ${range <= 8 ? "fairly close" : "not that close"} (${gap} apart).`;
  }
  if (range > 15) {
    return `${books} sportsbooks posted this, but they disagree a lot (${gap} apart). Trust the side more than the exact percent.`;
  }
  if (range <= 8) {
    return `${books} sportsbooks posted this and they are fairly close (${gap} apart).`;
  }
  return `${books} sportsbooks posted this, and they do not all land on the same number (${gap} apart).`;
}

function formatPct(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

export function renderMoneylineHtml(
  games: MoneylineGame[],
  sport: string,
  when: string,
  share?: { pageUrl: string; ogImageUrl: string }
): string {
  const rows = games.length
    ? games.map((game) => {
        const pick = pickToWin(game);
        const favoritePct = Math.max(game.homeFair, game.awayFair);
        const whenLabel = formatStart(game.start);
        return `<article class="pick">
          <div>
            <p class="choice">Pick ${escapeHtml(pick)} to win</p>
            <p class="plain">${escapeHtml(confidenceExplanation(game))}</p>
            <p class="game">${escapeHtml(game.away)} at ${escapeHtml(game.home)}</p>
            <p class="detail">Starts ${escapeHtml(whenLabel)} · ${game.books} books · prices differ by ${game.fairRange} points</p>
            <p class="why">${escapeHtml(game.away)} ${formatAmerican(game.awayAmerican)} · ${escapeHtml(game.home)} ${formatAmerican(game.homeAmerican)}. No-vig ${favoritePct}%.</p>
          </div>
        </article>`;
      }).join("\n")
    : `<p class="hint">No college football moneyline had two books pricing both sides.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(sport)} moneylines</title>
  <meta name="description" content="${escapeHtml(shareDescription(games.length, sport))}" />
  <meta name="robots" content="noindex" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(sport)} moneylines" />
  <meta property="og:description" content="${escapeHtml(shareDescription(games.length, sport))}" />
  ${share ? `<meta property="og:url" content="${escapeHtml(share.pageUrl)}" />
  <meta property="og:image" content="${escapeHtml(share.ogImageUrl)}" />
  <meta property="og:image:secure_url" content="${escapeHtml(share.ogImageUrl)}" />
  <meta property="og:image:type" content="image/jpeg" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(sport)} moneylines" />
  <meta name="twitter:description" content="${escapeHtml(shareDescription(games.length, sport))}" />
  <meta name="twitter:image" content="${escapeHtml(share.ogImageUrl)}" />` : `<meta name="twitter:card" content="summary" />`}
  <style>
    body { margin: 0; background: #07080c; color: #f4f4f5; font-family: ui-sans-serif, system-ui, sans-serif; }
    .wrap { max-width: 42rem; margin: 0 auto; padding: 1rem 1rem 2rem; }
    .label { color: #a1a1aa; font-size: 0.75rem; letter-spacing: 0.12em; text-transform: uppercase; }
    h1 { font-size: 1.35rem; margin: 0.35rem 0; }
    .hint, .detail, .why { color: #d4d4d8; font-size: 0.92rem; line-height: 1.45; }
    .pick { padding: 0.95rem 0; border-top: 1px solid rgba(255,255,255,0.08); }
    .choice { margin: 0; color: #fbbf24; font-weight: 800; font-size: 1.12rem; }
    .plain { margin: 0.4rem 0 0; color: #f4f4f5; font-size: 0.98rem; line-height: 1.5; }
    .game { margin: 0.45rem 0 0; font-weight: 650; font-size: 0.98rem; }
    .detail, .why { margin: 0.3rem 0 0; }
  </style>
</head>
<body>
  <div class="wrap">
    <p class="label">Odds API · ${escapeHtml(sport)} moneyline</p>
    <h1>${games.length} game${games.length === 1 ? "" : "s"}</h1>
    <p class="label">${escapeHtml(when)}</p>
    <p class="hint">Start times are Central. Each card names the team to pick. The note says how sure the sportsbooks are, and whether they agree. No-vig is the win chance after the book’s cut is removed.</p>
    ${rows}
  </div>
</body>
</html>`;
}

export async function runMoneylineScan(options: { sports?: string[]; noPublish?: boolean } = {}): Promise<{ games: MoneylineGame[]; credits: number; pageUrl: string | null }> {
  const sports = resolveOddsSports(options.sports);
  if (sports.length !== 1) throw new Error("Pass one league, for example --sports CFB --markets moneyline.");
  const sport = sports[0]!;
  const sportKey = sportKeyForLeague(sport);
  if (!sportKey) throw new Error(`No Odds API sport for ${sport}.`);
  if (!oddsApiKey()) throw new Error("Set THE_ODDS_API_KEY.");
  const response = await fetchOdds(
    `/sports/${sportKey}/odds?regions=us&oddsFormat=american&markets=h2h`,
    `moneyline_${sportKey}_h2h`
  );
  const games = parseMoneylineBoard(response.json);
  const credits = response.fromCache ? 0 : response.lastCost ?? 1;
  const when = formatStart(new Date().toISOString());
  console.log(`${sport} moneylines: ${games.length} games. Odds credits: ${credits}${response.fromCache ? " (cache)" : ""}.`);
  for (const game of games) {
    const pick = pickToWin(game);
    const pct = Math.max(game.homeFair, game.awayFair);
    console.log(`Pick ${pick} to win. ${game.away} at ${game.home}. ${pct}% no-vig from ${game.books} books. ${formatAmerican(game.awayAmerican)} / ${formatAmerican(game.homeAmerican)}.`);
    console.log(confidenceExplanation(game));
  }
  if (!games.length) console.log("No two-book moneyline was returned.");
  if (options.noPublish) return { games, credits, pageUrl: null };
  const stamp = new Date().toISOString();
  const prefix = `picks/${sport.toLowerCase()}-moneyline`;
  const key = `${prefix}/index.html`;
  const cardKey = `${prefix}/card.jpg`;
  const base = config.dropflow.baseUrl.replace(/\/$/, "");
  const pageUrl = `${base}/${key}?v=${encodeURIComponent(stamp)}`;
  const ogImageUrl = `${base}/${cardKey}?v=${encodeURIComponent(stamp)}`;
  const card = await renderMoneylineShareCard({
    sport,
    gameCount: games.length,
    dateLabel: when,
    lines: games.slice(0, 5).map((game) => ({
      pick: pickToWin(game),
      start: formatStart(game.start),
    })),
  });
  const html = renderMoneylineHtml(games, sport, when, { pageUrl, ogImageUrl });
  const s3 = new S3Client(awsClientConfig());
  await Promise.all([
    s3.send(new PutObjectCommand({
      Bucket: config.dropflow.bucket,
      Key: key,
      Body: html,
      ContentType: "text/html; charset=utf-8",
      CacheControl: "no-cache",
    })),
    s3.send(new PutObjectCommand({
      Bucket: config.dropflow.bucket,
      Key: cardKey,
      Body: card,
      ContentType: "image/jpeg",
      CacheControl: "no-cache",
    })),
  ]);
  console.log(pageUrl);
  console.log(ogImageUrl);
  return { games, credits, pageUrl };
}

function shareDescription(gameCount: number, sport: string): string {
  if (!gameCount) return `No ${sport} moneyline had two books pricing both sides.`;
  return `${gameCount} ${sport} game${gameCount === 1 ? "" : "s"}. Each line names the team to pick and the Central start time.`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function formatAmerican(price: number): string {
  const rounded = Math.round(price);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function formatStart(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "Start time unavailable";
  return new Date(time).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
    timeZoneName: "short",
  });
}

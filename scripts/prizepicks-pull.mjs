#!/usr/bin/env node
/**
 * Live PrizePicks board pull (no S3 cache). First step of the morning-demons CLI.
 *
 *   npm run prizepicks:pull
 *   npm run prizepicks:pull -- --limit 20
 */
import fs from "fs";
import path from "path";
import { loadEnvFile, root } from "./env-lib.mjs";

loadEnvFile(".env.local");
loadEnvFile("../Dropflow/.env.local", { override: false });
loadEnvFile("../Statics/.env.local", { override: false });

const BOT_COOKIE_NAMES = [
  "cf_clearance",
  "__cf_bm",
  "_cfuvid",
  "datadome",
  "_px3",
  "_pxvid",
  "pxcts",
];
const SESSION_COOKIE_NAMES = [
  "_prizepicks_session",
  "remember_user_token",
  "pp_uuid",
  "CSRF-TOKEN",
];

function cookieNames(raw) {
  if (!raw) return [];
  return raw
    .split(";")
    .map((part) => part.trim().split("=")[0]?.trim())
    .filter(Boolean);
}

function presentNames(names, wanted) {
  const set = new Set(names);
  return wanted.filter((name) => set.has(name));
}

function missingNames(names, wanted) {
  const set = new Set(names);
  return wanted.filter((name) => !set.has(name));
}

function classifyBlockBody(body) {
  const text = String(body ?? "");
  if (/datadome|captcha-delivery/i.test(text)) return "datadome";
  if (/perimeterx|px-captcha|_px/i.test(text)) return "perimeterx";
  if (/just a moment|cf-ray|cloudflare/i.test(text)) return "cloudflare";
  if (/access to this page has been denied/i.test(text)) return "access-denied";
  if (text.trim().startsWith("{")) return "json";
  if (!text.trim()) return "empty";
  return "html";
}

function parseLimit(argv) {
  const idx = argv.indexOf("--limit");
  if (idx >= 0 && argv[idx + 1]) {
    const n = Number(argv[idx + 1]);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 12;
}

function countBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item) || "(unknown)";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
}

function formatLine(p) {
  const league = p.leagueName || `league ${p.leagueId || "?"}`;
  const odds = p.oddsType && p.oddsType !== "standard" ? ` [${p.oddsType}]` : "";
  return `  ${p.playerName}  ${p.lineScore} ${p.statDisplayName}${odds}  (${league})`;
}

async function main() {
  const limit = parseLimit(process.argv.slice(2));
  const {
    fetchPrizePicksProjections,
    prizepicksApiBaseUrl,
    prizepicksIntegrationEnabled,
    prizepicksProxyConfigured,
    prizepicksProxyCount,
    PrizePicksApiError,
  } = await import("../src/lib/prizepicks/index.ts");
  const { prizepicksBrowserCookieStatus } = await import("../src/lib/prizepicks/browser-cookie.ts");

  const cookie = prizepicksBrowserCookieStatus();
  const { prizepicksBrowserCookieFromEnv } = await import("../src/lib/prizepicks/browser-cookie.ts");
  const { httpGetText } = await import("../src/lib/prizepicks/http-get.ts");
  const names = cookieNames(prizepicksBrowserCookieFromEnv());
  console.log("PrizePicks live pull");
  console.log(`  base:     ${prizepicksApiBaseUrl()}`);
  console.log(`  enabled:  ${prizepicksIntegrationEnabled() ? "yes" : "no (probe still runs)"}`);
  console.log(`  cookie:   ${cookie.source === "none" ? "none" : `env (${cookie.length} chars, ${names.length} names)`}`);
  console.log(`  session:  ${presentNames(names, SESSION_COOKIE_NAMES).join(", ") || "none"}`);
  console.log(`  bot:      ${presentNames(names, BOT_COOKIE_NAMES).join(", ") || "none"}`);
  const missingBot = missingNames(names, ["cf_clearance", "datadome", "_px3"]);
  if (missingBot.length) console.log(`  missing:  ${missingBot.join(", ")}`);
  console.log(
    `  proxy:    ${prizepicksProxyConfigured() ? `${prizepicksProxyCount()} URL(s)` : "none"}`
  );
  console.log(
    `  ua:       ${process.env.PRIZEPICKS_USER_AGENT?.trim() ? "env" : "default Chrome/120"}`
  );
  console.log("");

  const started = Date.now();
  try {
    const result = await fetchPrizePicksProjections({
      forceLive: true,
      disallowCacheFallback: true,
    });
    const ms = Date.now() - started;
    const projections = result.projections;
    const oddsCounts = countBy(projections, (p) => String(p.oddsType || "standard").toLowerCase());
    const leagueCounts = countBy(projections, (p) => p.leagueName || p.leagueId);
    const demons = projections.filter((p) => String(p.oddsType).toLowerCase() === "demon");
    const goblins = projections.filter((p) => String(p.oddsType).toLowerCase() === "goblin");

    console.log(`OK  ${projections.length} props  ${result.leagueCount} leagues  ${ms}ms`);
    console.log(`    fetchedAt ${result.fetchedAt}`);
    console.log("");
    console.log("oddsType");
    for (const [name, count] of oddsCounts) {
      console.log(`  ${String(count).padStart(5)}  ${name}`);
    }
    console.log("");
    console.log("leagues");
    for (const [name, count] of leagueCounts) {
      console.log(`  ${String(count).padStart(5)}  ${name}`);
    }

    const sample = [
      ...demons.slice(0, Math.min(6, limit)),
      ...projections.filter((p) => String(p.oddsType).toLowerCase() !== "demon").slice(0, limit),
    ].slice(0, limit);
    console.log("");
    console.log(`sample (${sample.length})`);
    for (const p of sample) console.log(formatLine(p));
    if (demons.length) {
      console.log("");
      console.log(`demons on board: ${demons.length}`);
      for (const p of demons.slice(0, 8)) console.log(formatLine(p));
    } else {
      console.log("");
      console.log("demons on board: 0  (board pull worked; no demon lines in this snapshot)");
    }
    if (goblins.length) console.log(`goblins on board: ${goblins.length}`);

    const outDir = path.join(root, "tmp", "prizepicks");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "last-pull.json");
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          fetchedAt: result.fetchedAt,
          projectionCount: projections.length,
          leagueCount: result.leagueCount,
          oddsCounts: Object.fromEntries(oddsCounts),
          leagueCounts: Object.fromEntries(leagueCounts),
          projections,
        },
        null,
        2
      )
    );
    console.log("");
    console.log(`wrote ${path.relative(root, outPath)}`);
  } catch (err) {
    const ms = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof PrizePicksApiError ? err.statusCode : undefined;
    console.error(`FAIL after ${ms}ms${status ? `  HTTP ${status}` : ""}`);
    console.error(`  ${message}`);
    try {
      const probe = await httpGetText(
        `${prizepicksApiBaseUrl()}/projections?per_page=1&single_stat=true`,
        {
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://app.prizepicks.com/",
          Origin: "https://app.prizepicks.com",
          "User-Agent":
            process.env.PRIZEPICKS_USER_AGENT?.trim() ||
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          ...(prizepicksBrowserCookieFromEnv()
            ? { Cookie: prizepicksBrowserCookieFromEnv() }
            : {}),
        }
      );
      console.error("");
      console.error("probe");
      console.error(`  status:   ${probe.status}`);
      console.error(`  block:    ${classifyBlockBody(probe.body)}`);
      console.error(`  bytes:    ${probe.body.length}`);
    } catch (probeErr) {
      console.error("");
      console.error(`probe failed: ${probeErr instanceof Error ? probeErr.message : probeErr}`);
    }
    if (cookie.source === "none") {
      console.error("");
      console.error("No PRIZEPICKS_BROWSER_COOKIE in .env.local.");
      console.error("If this is a 403/bot block: log into prizepicks.com, copy the request Cookie");
      console.error("header, paste it as PRIZEPICKS_BROWSER_COOKIE, then re-run.");
    } else {
      console.error("");
      console.error("Cookie is present (session + bot tokens). DataDome still rejected Node's TLS/HTTP stack.");
      console.error("Copy User-Agent from the same api.prizepicks.com request into PRIZEPICKS_USER_AGENT and retry.");
      console.error("If it still 403s, a cookie alone cannot pass DataDome from this CLI — we need a real Chrome pull.");
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});

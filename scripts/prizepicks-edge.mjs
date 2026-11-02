#!/usr/bin/env node
/**
 * Morning PrizePicks picks — news research + Kalshi/Poly, then a TAKE/WATCH list.
 *
 *   npm run prizepicks:picks
 *   npm run prizepicks:picks -- --sports WNBA,MLB
 *   npm run prizepicks:picks -- --no-publish
 *   npm run prizepicks:edge -- --no-intel
 */
import { loadEnvFile } from "./env-lib.mjs";

loadEnvFile(".env.local");
loadEnvFile("../Dropflow/.env.local", { override: false });
loadEnvFile("../Statics/.env.local", { override: false });

if (process.env.KALSHI_ENABLED === undefined) process.env.KALSHI_ENABLED = "true";

function parseArgs(argv) {
  const opts = {
    count: 12,
    json: false,
    slateOnly: false,
    noPublish: false,
    noGrok: false,
    noIntel: false,
    sports: ["WNBA", "MLB"],
    maxEvents: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "--slate-only") opts.slateOnly = true;
    else if (arg === "--no-publish") opts.noPublish = true;
    else if (arg === "--no-grok") opts.noGrok = true;
    else if (arg === "--no-intel") opts.noIntel = true;
    else if (arg === "--count" && argv[i + 1]) opts.count = Number(argv[++i]);
    else if (arg === "--max-events" && argv[i + 1]) opts.maxEvents = Number(argv[++i]);
    else if (arg === "--sports" && argv[i + 1]) {
      opts.sports = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: npm run prizepicks:picks -- [options]

Morning pick list. Researches WNBA/MLB news first, then fills with
PrizePicks vs Kalshi/Polymarket. TAKE = enter these; WATCH = weaker.

Options:
  --sports WNBA,MLB  Leagues (default WNBA,MLB; use all for every sport)
  --count 12         Max printed picks
  --max-events 8     Games to research for news
  --json             JSON output
  --slate-only       PrizePicks board only
  --no-intel         Skip news research; Kalshi/Poly only
  --no-grok          Skip Grok
  --no-publish       Skip the S3 page
  --help             Show help
`);
      process.exit(0);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const { runPrizePicksEdgeCli } = await import("../src/lib/prizepicks-edge/run.ts");

try {
  await runPrizePicksEdgeCli(opts);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`prizepicks-picks: ${message}`);
  process.exit(1);
}

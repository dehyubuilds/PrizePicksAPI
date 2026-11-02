#!/usr/bin/env node
/**
 * Daily PrizePicks market intelligence — event-level Grok research, local report.
 *
 * Research-only audit. For a TAKE/WATCH pick list:
 *   npm run prizepicks:picks
 *
 *   npm run prizepicks:intelligence
 *   npm run prizepicks:intelligence -- --slate-only
 *   npm run prizepicks:intelligence -- --max-events 20 --no-grok
 */
import { loadEnvFile } from "./env-lib.mjs";

loadEnvFile(".env.local");
loadEnvFile("../Dropflow/.env.local", { override: false });
loadEnvFile("../Statics/.env.local", { override: false });

function parseArgs(argv) {
  const opts = {
    slateOnly: false,
    noGrok: false,
    maxEvents: undefined,
    sports: ["WNBA", "MLB"],
    date: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--slate-only") opts.slateOnly = true;
    else if (arg === "--no-grok") opts.noGrok = true;
    else if (arg === "--max-events" && argv[i + 1]) opts.maxEvents = Number(argv[++i]);
    else if (arg === "--sports" && argv[i + 1]) {
      opts.sports = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    }
    else if (arg === "--date" && argv[i + 1]) opts.date = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: npm run prizepicks:intelligence -- [options]

Research audit only. For picks: npm run prizepicks:picks

Options:
  --slate-only       Normalize the board only
  --no-grok          Skip research; persist an empty-signal run
  --sports WNBA,MLB  Leagues to research (default WNBA,MLB; use all for every sport)
  --max-events 8     Real games to research (skips combo/quarter lines)
  --date YYYY-MM-DD  Report date key
`);
      process.exit(0);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const { runPrizePicksIntelligence } = await import("../src/lib/prizepicks-intelligence/run.ts");

try {
  await runPrizePicksIntelligence(opts);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`prizepicks-intelligence: ${message}`);
  process.exit(1);
}

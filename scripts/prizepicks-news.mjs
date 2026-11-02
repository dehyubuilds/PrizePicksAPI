#!/usr/bin/env node
/**
 * Hybrid PrizePicks research. Read only. Does not wager or publish.
 *
 *   npm run prizepicks:news -- --estimate
 *   npm run prizepicks:news -- --dry-run
 *   npm run prizepicks:news -- --sport WNBA
 */
import { loadEnvFile } from "./env-lib.mjs";
import { formatNewsSummary, parseNewsArgs, runPrizePicksNews } from "../src/lib/prizepicks-news/run.ts";

loadEnvFile(".env.local");
loadEnvFile("../Dropflow/.env.local", { override: false });
loadEnvFile("../Statics/.env.local", { override: false });

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: npm run prizepicks:news -- [--mode hybrid|news|market] [--sport MLB|WNBA|NFL|SOCCER] [--sports MLB,WNBA,NFL] [--estimate] [--dry-run] [--check-odds] [--verbose] [--target-picks 5] [--min-candidates 5] [--always-market-pass] [--max-events 10] [--max-market-events 10] [--max-market-requests 20] [--max-market-grok-checks 0] [--max-grok-spend 2] [--max-odds-credits 40]`);
  process.exit(0);
}

const options = parseNewsArgs(process.argv.slice(2));
const report = await runPrizePicksNews(options);
console.log(formatNewsSummary(report));
